use std::{
    collections::BTreeMap,
    fs,
    io::{Cursor, Read},
    path::{Component, Path, PathBuf},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::State;
use uuid::Uuid;
use zip::ZipArchive;

use crate::storage::{atomic_write, Result, Storage};

const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
const MAX_FILES: usize = 400;
const MAX_BYTES: u64 = 25 * 1024 * 1024;
const MAX_DEPTH: usize = 8;
const MAX_TILE_TYPES: usize = 20;
const MAX_SCREENSHOTS: usize = 8;
const MAX_ICON_BYTES: u64 = 32 * 1024;
const MAX_DOWNLOAD_BYTES: u64 = 30 * 1024 * 1024;
const MAX_REGISTRY_BYTES: u64 = 2 * 1024 * 1024;
const MAX_SOURCES: usize = 20;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledExtension {
    manifest: Value,
    path: String,
    source: Option<String>,
}

#[derive(Serialize, Deserialize, Default)]
struct StateFile {
    version: u32,
    extensions: BTreeMap<String, StateEntry>,
    #[serde(default)]
    sources: Vec<SourceEntry>,
}

#[derive(Serialize, Deserialize, Clone)]
struct StateEntry {
    version: String,
    /// Chemin relatif au dossier de configuration, pour rester portable.
    path: String,
    #[serde(default)]
    source: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SourceEntry {
    url: String,
    name: String,
}

fn state_path(storage: &Storage) -> PathBuf {
    storage.path("extensions.json")
}

fn read_state(storage: &Storage) -> Result<StateFile> {
    match fs::read(state_path(storage)) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(StateFile {
            version: 1,
            extensions: BTreeMap::new(),
            sources: Vec::new(),
        }),
        Err(error) => Err(error.to_string()),
    }
}

fn write_state(storage: &Storage, state: &StateFile) -> Result<()> {
    let bytes = serde_json::to_vec(state).map_err(|error| error.to_string())?;
    atomic_write(&state_path(storage), &bytes).map_err(|error| error.to_string())
}

fn valid_id(value: &str) -> bool {
    if value.is_empty() || value.len() > 64 {
        return false;
    }
    let parts: Vec<&str> = value.split('.').collect();
    if parts.len() < 2 || parts[0] == "spark" || parts[0] == "official" {
        return false;
    }
    parts.iter().enumerate().all(|(index, part)| {
        !part.is_empty()
            && part.len() <= 32
            && !part.starts_with('-')
            && !part.ends_with('-')
            && part.chars().all(|character| {
                character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
            })
            && (index > 0
                || part
                    .chars()
                    .next()
                    .is_some_and(|character| character.is_ascii_alphabetic()))
    })
}

fn valid_version(value: &str) -> bool {
    let parts: Vec<&str> = value.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|part| {
            !part.is_empty() && part.chars().all(|character| character.is_ascii_digit())
        })
}

/// Couleur d'extension : injectée dans une variable CSS, donc un hexadécimal
/// strict. Les noms CSS et les fonctions (`rgb()`) sont refusés.
fn valid_color(value: &str) -> bool {
    let Some(hex) = value.strip_prefix('#') else {
        return false;
    };
    matches!(hex.len(), 3 | 6) && hex.chars().all(|character| character.is_ascii_hexdigit())
}

fn safe_relative(value: &str) -> Result<PathBuf> {
    if value.is_empty() || value.len() > 180 || value.contains('\\') {
        return Err(format!("Chemin invalide : {value}"));
    }
    let path = Path::new(value);
    if path.is_absolute() {
        return Err(format!("Chemin absolu refusé : {value}"));
    }
    let mut relative = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => relative.push(part),
            _ => return Err(format!("Chemin invalide : {value}")),
        }
    }
    if relative.as_os_str().is_empty() {
        return Err(format!("Chemin invalide : {value}"));
    }
    Ok(relative)
}

fn relative_file(manifest: &Value, key: &str, base: &Path, extensions: &[&str]) -> Result<String> {
    let raw = manifest
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Champ « {key} » manquant."))?;
    let relative = safe_relative(raw)?;
    let extension = relative
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !extensions.contains(&extension.as_str()) {
        return Err(format!(
            "Le fichier « {raw} » doit être de type {}.",
            extensions.join(", ")
        ));
    }
    if !base.join(&relative).is_file() {
        return Err(format!("Fichier introuvable : {raw}"));
    }
    Ok(raw.to_string())
}

fn validate_manifest(manifest: &Value, base: &Path) -> Result<String> {
    if manifest.get("schema").and_then(Value::as_u64) != Some(2) {
        return Err("Le manifeste doit déclarer schema 2.".into());
    }
    if manifest.get("certification").is_some() {
        return Err("Un paquet importé ne peut pas se déclarer certifié.".into());
    }
    let id = manifest
        .get("id")
        .and_then(Value::as_str)
        .ok_or("Champ « id » manquant.")?;
    if !valid_id(id) {
        return Err(format!("Identifiant d’extension invalide : {id}"));
    }
    let version = manifest
        .get("version")
        .and_then(Value::as_str)
        .ok_or("Champ « version » manquant.")?;
    if !valid_version(version) {
        return Err(format!("Version invalide : {version}"));
    }
    let name = manifest
        .get("name")
        .and_then(Value::as_str)
        .ok_or("Champ « name » manquant.")?;
    if name.trim().is_empty() || name.len() > 80 {
        return Err("Le nom doit contenir entre 1 et 80 caractères.".into());
    }
    for key in ["subtitle", "summary", "description", "category"] {
        if let Some(value) = manifest.get(key) {
            if !value.is_string() {
                return Err(format!("Le champ « {key} » doit être une chaîne."));
            }
        }
    }
    if manifest
        .get("summary")
        .and_then(Value::as_str)
        .is_some_and(|value| value.len() > 400)
        || manifest
            .get("description")
            .and_then(Value::as_str)
            .is_some_and(|value| value.len() > 4000)
    {
        return Err("Résumé ou description trop long.".into());
    }
    relative_file(manifest, "entry", base, &["js", "mjs"])?;
    if manifest.get("style").is_some() {
        relative_file(manifest, "style", base, &["css"])?;
    }
    if let Some(color) = manifest.get("color") {
        let value = color
            .as_str()
            .ok_or("Le champ « color » doit être une chaîne.")?;
        if !valid_color(value) {
            return Err(format!(
                "Couleur invalide : {value}. Attendu #rrggbb ou #rgb."
            ));
        }
    }
    if let Some(icon) = manifest.get("icon") {
        if !icon.is_string() {
            return Err("Le champ « icon » doit être une chaîne.".into());
        }
        let raw = relative_file(manifest, "icon", base, &["svg"])?;
        let size = fs::metadata(base.join(&raw))
            .map_err(|error| error.to_string())?
            .len();
        if size > MAX_ICON_BYTES {
            return Err(format!(
                "Icône trop volumineuse : {raw} ({} Kio max).",
                MAX_ICON_BYTES / 1024
            ));
        }
    }
    let tile_types = manifest
        .get("tileTypes")
        .and_then(Value::as_array)
        .ok_or("Champ « tileTypes » manquant.")?;
    if tile_types.is_empty() || tile_types.len() > MAX_TILE_TYPES {
        return Err(format!(
            "Le manifeste doit déclarer entre 1 et {MAX_TILE_TYPES} types de tuiles."
        ));
    }
    let prefix = format!("{id}.");
    let mut seen = std::collections::BTreeSet::new();
    for value in tile_types {
        let tile_type = value
            .as_str()
            .ok_or("Chaque type de tuile doit être une chaîne.")?;
        if !tile_type.starts_with(&prefix) || tile_type.len() > 120 || !seen.insert(tile_type) {
            return Err(format!(
                "Type de tuile invalide : {tile_type}. Il doit commencer par {prefix} et être unique."
            ));
        }
    }
    if let Some(screenshots) = manifest.get("screenshots") {
        let list = screenshots
            .as_array()
            .ok_or("Champ « screenshots » invalide.")?;
        if list.len() > MAX_SCREENSHOTS {
            return Err(format!(
                "Le manifeste accepte au plus {MAX_SCREENSHOTS} captures."
            ));
        }
        for value in list {
            let raw = value
                .as_str()
                .ok_or("Chaque capture doit être un chemin.")?;
            let relative = safe_relative(raw)?;
            let extension = relative
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if !["webp", "png", "jpg", "jpeg"].contains(&extension.as_str()) {
                return Err(format!("Capture invalide : {raw}"));
            }
            if !base.join(&relative).is_file() {
                return Err(format!("Capture introuvable : {raw}"));
            }
        }
    }
    Ok(id.to_string())
}

struct Budget {
    files: usize,
    bytes: u64,
}

fn copy_dir(from: &Path, to: &Path, budget: &mut Budget, depth: usize) -> Result<()> {
    if depth > MAX_DEPTH {
        return Err("Le paquet contient trop de niveaux de dossiers.".into());
    }
    fs::create_dir_all(to).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(from).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == ".git" || name == "node_modules" {
            continue;
        }
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() {
            return Err(format!("Les liens symboliques sont refusés : {name}"));
        }
        let target = to.join(name.as_ref());
        if file_type.is_dir() {
            copy_dir(&entry.path(), &target, budget, depth + 1)?;
        } else if file_type.is_file() {
            budget.files += 1;
            budget.bytes += entry.metadata().map_err(|error| error.to_string())?.len();
            if budget.files > MAX_FILES {
                return Err(format!("Le paquet contient plus de {MAX_FILES} fichiers."));
            }
            if budget.bytes > MAX_BYTES {
                return Err(format!("Le paquet dépasse {} Mo.", MAX_BYTES / 1_000_000));
            }
            fs::copy(entry.path(), &target).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn list_from(storage: &Storage) -> Result<Vec<InstalledExtension>> {
    let state = read_state(storage)?;
    let mut installed = Vec::new();
    for (id, entry) in state.extensions {
        let directory = storage.path(&entry.path);
        let bytes = match fs::read(directory.join("extension.json")) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        let manifest: Value = match serde_json::from_slice(&bytes) {
            Ok(manifest) => manifest,
            Err(_) => continue,
        };
        if manifest.get("schema").and_then(Value::as_u64) != Some(2)
            || manifest.get("id").and_then(Value::as_str) != Some(id.as_str())
            || manifest.get("version").and_then(Value::as_str) != Some(entry.version.as_str())
        {
            continue;
        }
        installed.push(InstalledExtension {
            manifest,
            path: directory.to_string_lossy().into_owned(),
            source: entry.source,
        });
    }
    Ok(installed)
}

fn install_from(storage: &Storage, source: &str) -> Result<InstalledExtension> {
    let source = Path::new(source)
        .canonicalize()
        .map_err(|error| format!("Dossier d’extension introuvable : {error}"))?;
    if !source.is_dir() {
        return Err("Le chemin source doit être un dossier.".into());
    }
    let manifest_path = source.join("extension.json");
    let metadata =
        fs::metadata(&manifest_path).map_err(|_| "extension.json est introuvable.".to_string())?;
    if metadata.len() > MAX_MANIFEST_BYTES {
        return Err("extension.json est trop volumineux.".into());
    }
    let bytes = fs::read(&manifest_path).map_err(|error| error.to_string())?;
    let manifest: Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("extension.json invalide : {error}"))?;
    validate_manifest(&manifest, &source)?;

    let root = storage.path("extensions");
    if source.starts_with(&root) {
        return Err("Le dossier source se trouve déjà dans les extensions installées.".into());
    }
    let staging = root.join(".staging").join(Uuid::new_v4().to_string());
    let copied = (|| -> Result<()> {
        let mut budget = Budget { files: 0, bytes: 0 };
        copy_dir(&source, &staging, &mut budget, 0)
    })();
    if let Err(error) = copied {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    let result = finalize_install(storage, manifest, &staging, None);
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn finalize_install(
    storage: &Storage,
    manifest: Value,
    staging: &Path,
    source: Option<String>,
) -> Result<InstalledExtension> {
    let id = validate_manifest(&manifest, staging)?;
    let version = manifest
        .get("version")
        .and_then(Value::as_str)
        .ok_or("Version manquante.")?
        .to_string();
    let root = storage.path("extensions");
    let target = root.join(&id).join(&version);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|error| error.to_string())?;
    }
    fs::rename(staging, &target).map_err(|error| error.to_string())?;

    let relative = format!("extensions/{id}/{version}");
    let mut state = read_state(storage)?;
    state.version = 1;
    state.extensions.insert(
        id,
        StateEntry {
            version,
            path: relative,
            source: source.clone(),
        },
    );
    write_state(storage, &state)?;
    Ok(InstalledExtension {
        manifest,
        path: target.to_string_lossy().into_owned(),
        source,
    })
}

fn remove_from(storage: &Storage, id: &str) -> Result<()> {
    if !valid_id(id) {
        return Err(format!("Identifiant d’extension invalide : {id}"));
    }
    let mut state = read_state(storage)?;
    state.extensions.remove(id);
    let directory = storage.path(&format!("extensions/{id}"));
    if directory.exists() {
        fs::remove_dir_all(&directory).map_err(|error| error.to_string())?;
    }
    write_state(storage, &state)
}

fn allowed_url(url: &str) -> bool {
    url.starts_with("https://")
        || (cfg!(debug_assertions)
            && (url.starts_with("http://127.0.0.1:") || url.starts_with("http://localhost:")))
}

fn download(url: &str, max: u64) -> Result<Vec<u8>> {
    if !allowed_url(url) {
        return Err("URL refusée : HTTPS requis.".into());
    }
    let response = ureq::get(url)
        .set("User-Agent", "Spark/0.1 extension")
        .timeout(Duration::from_secs(20))
        .call()
        .map_err(|error| format!("Téléchargement impossible ({url}) : {error}"))?;
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Lecture impossible ({url}) : {error}"))?;
    if bytes.is_empty() {
        return Err(format!("Réponse vide : {url}"));
    }
    if bytes.len() as u64 > max {
        return Err(format!("Réponse trop volumineuse : {url}"));
    }
    Ok(bytes)
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn extract_zip(bytes: &[u8], to: &Path, budget: &mut Budget) -> Result<()> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| format!("Archive invalide : {error}"))?;
    if archive.len() > MAX_FILES {
        return Err(format!("L’archive contient plus de {MAX_FILES} fichiers."));
    }
    fs::create_dir_all(to).map_err(|error| error.to_string())?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Archive illisible : {error}"))?;
        let name = entry.name().to_string();
        if name == ".git"
            || name.starts_with(".git/")
            || name == "node_modules"
            || name.starts_with("node_modules/")
        {
            continue;
        }
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(format!("Les liens symboliques sont refusés : {name}"));
        }
        let relative = safe_relative(&name)?;
        let target = to.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|error| error.to_string())?;
            continue;
        }
        budget.files += 1;
        budget.bytes += entry.size();
        if budget.files > MAX_FILES {
            return Err(format!("L’archive contient plus de {MAX_FILES} fichiers."));
        }
        if budget.bytes > MAX_BYTES {
            return Err(format!("Le paquet dépasse {} Mo.", MAX_BYTES / 1_000_000));
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut file = fs::File::create(&target).map_err(|error| error.to_string())?;
        std::io::copy(&mut entry, &mut file).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn install_zip_from(
    storage: &Storage,
    url: &str,
    sha256: &str,
    source: &str,
) -> Result<InstalledExtension> {
    let expected = sha256.trim().to_ascii_lowercase();
    if expected.len() != 64
        || !expected
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("Empreinte SHA-256 invalide.".into());
    }
    let bytes = download(url, MAX_DOWNLOAD_BYTES)?;
    let actual = sha256_hex(&bytes);
    if actual != expected {
        return Err(format!(
            "Empreinte SHA-256 incorrecte. Attendu {expected}, reçu {actual}."
        ));
    }
    let root = storage.path("extensions");
    let staging = root.join(".staging").join(Uuid::new_v4().to_string());
    let result = (|| -> Result<InstalledExtension> {
        let mut budget = Budget { files: 0, bytes: 0 };
        extract_zip(&bytes, &staging, &mut budget)?;
        let manifest_path = staging.join("extension.json");
        let metadata = fs::metadata(&manifest_path)
            .map_err(|_| "extension.json est introuvable dans l’archive.".to_string())?;
        if metadata.len() > MAX_MANIFEST_BYTES {
            return Err("extension.json est trop volumineux.".into());
        }
        let manifest: Value =
            serde_json::from_slice(&fs::read(&manifest_path).map_err(|error| error.to_string())?)
                .map_err(|error| format!("extension.json invalide : {error}"))?;
        validate_manifest(&manifest, &staging)?;
        finalize_install(
            storage,
            manifest,
            &staging,
            (!source.is_empty()).then(|| source.to_string()),
        )
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn registry_from(url: &str) -> Result<Value> {
    let bytes = download(url, MAX_REGISTRY_BYTES)?;
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|error| format!("Index invalide : {error}"))?;
    if value.get("schema").and_then(Value::as_u64) != Some(1)
        || !value.get("extensions").is_some_and(Value::is_array)
    {
        return Err("Format d’index inconnu.".into());
    }
    Ok(value)
}

fn sources_from(storage: &Storage) -> Result<Vec<SourceEntry>> {
    Ok(read_state(storage)?.sources)
}

fn add_source(storage: &Storage, url: &str, name: &str) -> Result<Vec<SourceEntry>> {
    let url = url.trim();
    if !allowed_url(url) {
        return Err("URL refusée : HTTPS requis.".into());
    }
    let name = name.trim();
    if name.is_empty() || name.len() > 80 {
        return Err("Le nom du dépôt doit contenir entre 1 et 80 caractères.".into());
    }
    let mut state = read_state(storage)?;
    if state.sources.iter().any(|source| source.url == url) {
        return Ok(state.sources);
    }
    if state.sources.len() >= MAX_SOURCES {
        return Err(format!("Limite de {MAX_SOURCES} dépôts atteinte."));
    }
    state.sources.push(SourceEntry {
        url: url.to_string(),
        name: name.to_string(),
    });
    write_state(storage, &state)?;
    Ok(state.sources)
}

fn remove_source(storage: &Storage, url: &str) -> Result<Vec<SourceEntry>> {
    let mut state = read_state(storage)?;
    state.sources.retain(|source| source.url != url);
    write_state(storage, &state)?;
    Ok(state.sources)
}

#[tauri::command]
pub fn extension_list(storage: State<'_, Storage>) -> Result<Vec<InstalledExtension>> {
    list_from(&storage)
}

#[tauri::command]
pub fn extension_install(
    storage: State<'_, Storage>,
    source: String,
) -> Result<InstalledExtension> {
    install_from(&storage, &source)
}

#[tauri::command]
pub fn extension_remove(storage: State<'_, Storage>, id: String) -> Result<()> {
    remove_from(&storage, &id)
}

#[tauri::command]
pub async fn extension_install_zip(
    storage: State<'_, Storage>,
    url: String,
    sha256: String,
    source: String,
) -> Result<InstalledExtension> {
    let storage = (*storage).clone();
    tauri::async_runtime::spawn_blocking(move || install_zip_from(&storage, &url, &sha256, &source))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn registry_fetch(url: String) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || registry_from(&url))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn extension_sources(storage: State<'_, Storage>) -> Result<Vec<SourceEntry>> {
    sources_from(&storage)
}

#[tauri::command]
pub fn extension_source_add(
    storage: State<'_, Storage>,
    url: String,
    name: String,
) -> Result<Vec<SourceEntry>> {
    add_source(&storage, &url, &name)
}

#[tauri::command]
pub fn extension_source_remove(
    storage: State<'_, Storage>,
    url: String,
) -> Result<Vec<SourceEntry>> {
    remove_source(&storage, &url)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
    };

    fn serve_once(body: Vec<u8>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0_u8; 2048];
            let _ = stream.read(&mut buffer);
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream.write_all(header.as_bytes()).unwrap();
            stream.write_all(&body).unwrap();
        });
        format!("http://127.0.0.1:{port}/package")
    }

    fn temporary_storage() -> (Storage, PathBuf) {
        let home = std::env::temp_dir().join(format!("spark-extensions-{}", Uuid::new_v4()));
        let storage = Storage::new(home.clone()).unwrap();
        (storage, home)
    }

    fn write_package(root: &Path, manifest: Value) {
        fs::create_dir_all(root.join("media")).unwrap();
        fs::write(
            root.join("extension.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        fs::write(root.join("index.js"), "window.SparkExtensions = {};").unwrap();
        fs::write(root.join("style.css"), ".hello {}").unwrap();
    }

    fn manifest() -> Value {
        serde_json::json!({
            "schema": 2,
            "id": "demo.hello",
            "name": "Hello",
            "version": "0.1.0",
            "entry": "index.js",
            "style": "style.css",
            "tileTypes": ["demo.hello.tile"]
        })
    }

    #[test]
    fn refuse_les_chemins_qui_sortent_du_paquet() {
        assert!(safe_relative("index.js").is_ok());
        assert!(safe_relative("media/photo.webp").is_ok());
        assert!(safe_relative("../index.js").is_err());
        assert!(safe_relative("/etc/passwd").is_err());
        assert!(safe_relative("media\\photo.webp").is_err());
        assert!(safe_relative("./index.js").is_err());
    }

    #[test]
    fn valide_un_manifeste_et_refuse_les_identifiants_reserves() {
        let (_, home) = temporary_storage();
        let root = home.join("source");
        write_package(&root, manifest());
        assert_eq!(validate_manifest(&manifest(), &root).unwrap(), "demo.hello");

        let mut reserved = manifest();
        reserved["id"] = "spark.hello".into();
        reserved["tileTypes"] = serde_json::json!(["spark.hello.tile"]);
        assert!(validate_manifest(&reserved, &root).is_err());

        let mut traversal = manifest();
        traversal["entry"] = "../index.js".into();
        assert!(validate_manifest(&traversal, &root).is_err());
    }

    #[test]
    fn valide_l_icone_et_la_couleur_d_un_paquet() {
        let (_, home) = temporary_storage();
        let root = home.join("source");
        write_package(&root, manifest());
        fs::write(root.join("icon.svg"), "<svg></svg>").unwrap();

        let mut decorated = manifest();
        decorated["icon"] = "icon.svg".into();
        decorated["color"] = "#769ac8".into();
        assert!(validate_manifest(&decorated, &root).is_ok());

        let mut short = manifest();
        short["color"] = "#abc".into();
        assert!(validate_manifest(&short, &root).is_ok());

        let mut named = manifest();
        named["color"] = "blue".into();
        assert!(validate_manifest(&named, &root).is_err());

        let mut broken = manifest();
        broken["color"] = "#12".into();
        assert!(validate_manifest(&broken, &root).is_err());

        let mut missing = manifest();
        missing["icon"] = "logo.svg".into();
        assert!(validate_manifest(&missing, &root).is_err());

        let mut wrong_kind = manifest();
        wrong_kind["icon"] = "style.css".into();
        assert!(validate_manifest(&wrong_kind, &root).is_err());

        let mut heavy = manifest();
        heavy["icon"] = "heavy.svg".into();
        fs::write(
            root.join("heavy.svg"),
            vec![b'x'; (MAX_ICON_BYTES + 1) as usize],
        )
        .unwrap();
        assert!(validate_manifest(&heavy, &root).is_err());
    }

    #[test]
    fn valide_le_paquet_de_demonstration_journee() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples/sparklab-day");
        let bytes = fs::read(root.join("extension.json")).unwrap();
        let manifest: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(validate_manifest(&manifest, &root).unwrap(), "sparklab.day");
    }

    #[test]
    fn calcule_une_empreinte_sha256_stable() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn installe_un_paquet_zip_verifie_par_empreinte() {
        let (storage, _) = temporary_storage();
        let bytes =
            fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples/hello-extension.zip"))
                .unwrap();
        let url = serve_once(bytes.clone());
        let installed = install_zip_from(
            &storage,
            &url,
            &sha256_hex(&bytes),
            "https://example.org/registry.json",
        )
        .unwrap();
        assert_eq!(
            installed.source.as_deref(),
            Some("https://example.org/registry.json")
        );
        assert!(Path::new(&installed.path).join("index.js").is_file());
        assert_eq!(list_from(&storage).unwrap().len(), 1);
    }

    #[test]
    fn refuse_une_empreinte_incorrecte() {
        let (storage, _) = temporary_storage();
        let bytes =
            fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples/hello-extension.zip"))
                .unwrap();
        let url = serve_once(bytes);
        assert!(install_zip_from(&storage, &url, &"0".repeat(64), "").is_err());
    }

    #[test]
    fn lit_un_index_de_depot() {
        let url = serve_once(br#"{"schema":1,"name":"Test","extensions":[]}"#.to_vec());
        let value = registry_from(&url).unwrap();
        assert_eq!(value["name"], "Test");
    }

    #[test]
    fn ajoute_et_retire_une_source() {
        let (storage, _) = temporary_storage();
        let sources =
            add_source(&storage, "https://example.org/spark-index.json", "Exemple").unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].name, "Exemple");
        assert_eq!(sources_from(&storage).unwrap().len(), 1);
        assert!(
            remove_source(&storage, "https://example.org/spark-index.json")
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn installe_liste_et_retire_un_paquet() {
        let (storage, home) = temporary_storage();
        let source = home.join("source");
        write_package(&source, manifest());

        let installed = install_from(&storage, source.to_str().unwrap()).unwrap();
        assert!(Path::new(&installed.path).join("index.js").is_file());
        assert_eq!(list_from(&storage).unwrap().len(), 1);

        remove_from(&storage, "demo.hello").unwrap();
        assert!(list_from(&storage).unwrap().is_empty());
        assert!(!home.join("extensions/demo.hello").exists());
    }
}
