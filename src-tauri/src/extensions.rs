use std::{
    collections::BTreeMap,
    fs,
    path::{Component, Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;
use uuid::Uuid;

use crate::storage::{atomic_write, Result, Storage};

const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
const MAX_FILES: usize = 400;
const MAX_BYTES: u64 = 25 * 1024 * 1024;
const MAX_DEPTH: usize = 8;
const MAX_TILE_TYPES: usize = 20;
const MAX_SCREENSHOTS: usize = 8;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledExtension {
    manifest: Value,
    path: String,
}

#[derive(Serialize, Deserialize, Default)]
struct StateFile {
    version: u32,
    extensions: BTreeMap<String, StateEntry>,
}

#[derive(Serialize, Deserialize, Clone)]
struct StateEntry {
    version: String,
    /// Chemin relatif au dossier de configuration, pour rester portable.
    path: String,
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
    let id = validate_manifest(&manifest, &source)?;
    let version = manifest
        .get("version")
        .and_then(Value::as_str)
        .ok_or("Version manquante.")?
        .to_string();

    let root = storage.path("extensions");
    if source.starts_with(&root) {
        return Err("Le dossier source se trouve déjà dans les extensions installées.".into());
    }
    let target = root.join(&id).join(&version);
    let staging = root.join(".staging").join(Uuid::new_v4().to_string());

    let result = (|| -> Result<()> {
        let mut budget = Budget { files: 0, bytes: 0 };
        copy_dir(&source, &staging, &mut budget, 0)?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        if target.exists() {
            fs::remove_dir_all(&target).map_err(|error| error.to_string())?;
        }
        fs::rename(&staging, &target).map_err(|error| error.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
        return result.map(|_| unreachable!());
    }

    let mut state = read_state(storage)?;
    state.version = 1;
    let relative = format!("extensions/{id}/{version}");
    state.extensions.insert(
        id.clone(),
        StateEntry {
            version: version.clone(),
            path: relative,
        },
    );
    write_state(storage, &state)?;
    Ok(InstalledExtension {
        manifest,
        path: target.to_string_lossy().into_owned(),
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

#[cfg(test)]
mod tests {
    use super::*;

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
