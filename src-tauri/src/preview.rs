//! Aperçu de fichiers : sources locales et liens https.
//!
//! Le webview ne peut pas lire directement les fichiers choisis ni les PDF des
//! éditeurs (CORS, frames, CSP). On autorise les fichiers locaux dans la portée
//! du protocole asset et on télécharge les liens dans le cache applicatif.
//!
//! Tous les hébergeurs ne servent pas les documents aux clients non
//! navigateurs : on essaie les URL dans l'ordre et on garde la première qui
//! répond vraiment.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::explorer::ExplorerStorage;
use crate::storage::{atomic_write, message, GrantKind, PathGrants, Result, Storage};

type PreviewFileOrError<T> = std::result::Result<T, String>;

const MAX_PDF: u64 = 30 * 1024 * 1024;
const MAX_IMAGE: u64 = 50 * 1024 * 1024;
const MAX_MEDIA: u64 = 100 * 1024 * 1024;
const MAX_TEXT: u64 = 2 * 1024 * 1024;
const MAX_LOCAL_TEXT: u64 = 512 * 1024;
const TIMEOUT_SECONDS: u64 = 30;
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "avif"];
const AUDIO_EXTENSIONS: &[&str] = &["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus"];
const VIDEO_EXTENSIONS: &[&str] = &["mp4", "webm", "mov", "m4v", "ogv"];
const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "json", "jsonc", "log", "csv", "tsv", "yaml", "yml", "toml", "xml", "ini", "conf",
    "cfg", "env", "sh", "bash", "zsh", "fish", "py", "rs", "ts", "tsx", "js", "jsx", "css", "scss",
    "less", "sql", "c", "h", "cpp", "hpp", "go", "java", "kt", "swift", "rb", "php", "lua", "r",
    "pl", "ex", "exs", "erl", "hs", "clj", "vue", "svelte",
];
const HTML_EXTENSIONS: &[&str] = &["html", "htm"];

pub struct PreviewStorage(PathGrants);

impl PreviewStorage {
    pub fn new(storage: &Storage) -> Self {
        Self(PathGrants::new(storage, GrantKind::Preview))
    }
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFile {
    /// Jeton du grant local ; vide pour un fichier téléchargé dans le cache.
    token: String,
    name: String,
    path: String,
    kind: String,
    bytes: u64,
    source: String,
    text: Option<String>,
    truncated: bool,
}

fn extension_of(name: &str) -> Option<String> {
    let without_query = name.split(['?', '#']).next().unwrap_or(name);
    let base = without_query
        .split(['/', '\\'])
        .filter(|part| !part.is_empty())
        .next_back()?;
    let (stem, extension) = base.rsplit_once('.')?;
    if stem.is_empty() || extension.is_empty() {
        return None;
    }
    Some(extension.to_ascii_lowercase())
}

fn kind_from_name(name: &str) -> Option<&'static str> {
    let extension = extension_of(name)?;
    let extension = extension.as_str();
    if extension == "pdf" {
        Some("pdf")
    } else if IMAGE_EXTENSIONS.contains(&extension) {
        Some("image")
    } else if AUDIO_EXTENSIONS.contains(&extension) {
        Some("audio")
    } else if VIDEO_EXTENSIONS.contains(&extension) {
        Some("video")
    } else if HTML_EXTENSIONS.contains(&extension) {
        Some("html")
    } else if TEXT_EXTENSIONS.contains(&extension) {
        Some("text")
    } else {
        None
    }
}

fn kind_from_mime(mime: &str) -> Option<&'static str> {
    let mime = mime
        .split(';')
        .next()
        .unwrap_or(mime)
        .trim()
        .to_ascii_lowercase();
    if mime == "application/pdf" {
        Some("pdf")
    } else if mime == "image/svg+xml" {
        // Un SVG est du XML actif : il s'affiche comme source, jamais comme image.
        None
    } else if mime.starts_with("image/") {
        Some("image")
    } else if mime.starts_with("audio/") {
        Some("audio")
    } else if mime.starts_with("video/") {
        Some("video")
    } else if mime == "text/html" || mime == "application/xhtml+xml" {
        Some("html")
    } else if mime.starts_with("text/")
        || mime == "application/json"
        || mime.ends_with("+json")
        || mime == "application/xml"
        || mime.ends_with("+xml")
    {
        Some("text")
    } else {
        None
    }
}

fn kind_from_bytes(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"%PDF-") {
        return Some("pdf");
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        || bytes.starts_with(b"\xff\xd8\xff")
        || bytes.starts_with(b"GIF87a")
        || bytes.starts_with(b"GIF89a")
    {
        return Some("image");
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        return Some("video");
    }
    if bytes.starts_with(b"ID3") || bytes.starts_with(b"OggS") || bytes.starts_with(b"fLaC") {
        return Some("audio");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE" {
        return Some("audio");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"AVI " {
        return Some("video");
    }
    None
}

fn looks_like_text(bytes: &[u8]) -> bool {
    if bytes.is_empty() || bytes.contains(&0) {
        return false;
    }
    !String::from_utf8_lossy(bytes).contains('\u{FFFD}')
}

fn is_markdown_name(name: &str) -> bool {
    matches!(extension_of(name).as_deref(), Some("md" | "markdown"))
}

fn known_kind(kind: &str) -> Option<&'static str> {
    match kind {
        "pdf" => Some("pdf"),
        "image" => Some("image"),
        "audio" => Some("audio"),
        "video" => Some("video"),
        "text" => Some("text"),
        "html" => Some("html"),
        _ => None,
    }
}

fn cap_for(kind: Option<&str>) -> u64 {
    match kind {
        Some("pdf") => MAX_PDF,
        Some("image") => MAX_IMAGE,
        Some("audio") | Some("video") => MAX_MEDIA,
        Some("text") | Some("html") => MAX_TEXT,
        _ => MAX_MEDIA,
    }
}

fn accept_asset(app: &AppHandle, path: &Path) -> Result<()> {
    app.asset_protocol_scope().allow_file(path).map_err(message)
}

fn read_prefix(path: &Path, limit: u64) -> Result<(Vec<u8>, bool)> {
    let file = fs::File::open(path).map_err(message)?;
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(message)?;
    let truncated = bytes.len() as u64 > limit;
    if truncated {
        bytes.truncate(limit as usize);
    }
    Ok((bytes, truncated))
}

fn text_of(bytes: &[u8], truncated: bool) -> (String, bool) {
    // Une coupe au milieu d'un caractère produit au pire un caractère de
    // remplacement : la lecture reste bornée et l'aperçu reste lisible.
    (String::from_utf8_lossy(bytes).into_owned(), truncated)
}

fn local_file(app: &AppHandle, path: &Path) -> Result<PreviewFile> {
    let metadata = fs::symlink_metadata(path).map_err(message)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Seuls les fichiers sont acceptés.".into());
    }
    let path = path.canonicalize().map_err(message)?;
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .ok_or("Nom de fichier manquant.")?;
    if is_markdown_name(&name) {
        return Err("Le Markdown s’ouvre dans l’éditeur Markdown.".into());
    }
    let kind = match kind_from_name(&name) {
        Some(kind) => kind,
        None => {
            let (head, _) = read_prefix(&path, 256)?;
            kind_from_bytes(&head)
                .or_else(|| looks_like_text(&head).then_some("text"))
                .ok_or_else(|| {
                    format!("« {name} » n’est pas un format pris en charge par l’aperçu.")
                })?
        }
    };
    accept_asset(app, &path)?;
    let token = app.state::<PreviewStorage>().0.grant(&path)?;
    let (text, truncated) = if matches!(kind, "text" | "html") {
        let (bytes, truncated) = read_prefix(&path, MAX_LOCAL_TEXT)?;
        let (text, truncated) = text_of(&bytes, truncated);
        (Some(text), truncated)
    } else {
        (None, false)
    };
    Ok(PreviewFile {
        token,
        name,
        path: path.to_string_lossy().into_owned(),
        kind: kind.to_owned(),
        bytes: metadata.len(),
        source: String::new(),
        text,
        truncated,
    })
}

fn cached_file(
    path: &Path,
    name: String,
    source: String,
    hint: Option<&str>,
) -> Result<PreviewFile> {
    let metadata = fs::metadata(path).map_err(message)?;
    if !metadata.is_file() {
        return Err("Le fichier mis en cache est introuvable.".into());
    }
    let (head, _) = read_prefix(path, 256)?;
    let kind = hint
        .and_then(known_kind)
        .or_else(|| kind_from_name(&name))
        .or_else(|| kind_from_bytes(&head))
        .or_else(|| looks_like_text(&head).then_some("text"))
        .ok_or("Format non pris en charge.")?;
    let (text, truncated) = if matches!(kind, "text" | "html") {
        let (bytes, truncated) = read_prefix(path, MAX_TEXT)?;
        let (text, truncated) = text_of(&bytes, truncated);
        (Some(text), truncated)
    } else {
        (None, false)
    };
    Ok(PreviewFile {
        token: String::new(),
        name,
        path: path.to_string_lossy().into_owned(),
        kind: kind.to_owned(),
        bytes: metadata.len(),
        source,
        text,
        truncated,
    })
}

fn filters(filter: Option<&str>) -> Vec<(&'static str, Vec<&'static str>)> {
    match filter {
        Some("pdf") => vec![("PDF", vec!["pdf"])],
        Some("image") => vec![("Images", IMAGE_EXTENSIONS.to_vec())],
        Some("audio") => vec![("Audio", AUDIO_EXTENSIONS.to_vec())],
        Some("video") => vec![("Vidéo", VIDEO_EXTENSIONS.to_vec())],
        Some("text") => vec![("Texte", TEXT_EXTENSIONS.to_vec())],
        Some("html") => vec![("HTML", HTML_EXTENSIONS.to_vec())],
        // « Tous les fichiers » : aucun filtre, sinon macOS n'affiche que les
        // extensions listées.
        _ => Vec::new(),
    }
}

#[tauri::command]
pub async fn preview_select(app: AppHandle, filter: Option<String>) -> Result<Option<PreviewFile>> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file();
        for (name, extensions) in filters(filter.as_deref()) {
            dialog = dialog.add_filter(name, &extensions);
        }
        let Some(path) = dialog.blocking_pick_file() else {
            return Ok(None);
        };
        local_file(&app, &path.into_path().map_err(message)?).map(Some)
    })
    .await
    .map_err(message)?
}

/// Revalide un grant local après un redémarrage et le réautorise dans la portée
/// du protocole asset, qui n'est pas persistée.
#[tauri::command]
pub async fn preview_source(app: AppHandle, token: String) -> Result<PreviewFile> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = app.state::<PreviewStorage>().0.resolve(&token)?;
        let mut file = local_file(&app, &path)?;
        file.token = token;
        Ok(file)
    })
    .await
    .map_err(message)?
}

#[tauri::command]
pub async fn preview_from_explorer(
    app: AppHandle,
    token: String,
    segments: Vec<String>,
) -> Result<PreviewFile> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = app
            .state::<ExplorerStorage>()
            .resolve_path(&token, &segments)?;
        if !path.is_file() {
            return Err("Ce n’est pas un fichier.".into());
        }
        local_file(&app, &path)
    })
    .await
    .map_err(message)?
}

#[tauri::command]
pub async fn preview_drop(app: AppHandle, paths: Vec<String>) -> Result<Vec<PreviewFile>> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut files = Vec::new();
        for raw in paths.into_iter().take(8) {
            if let Ok(file) = local_file(&app, &PathBuf::from(raw)) {
                files.push(file);
            }
        }
        if files.is_empty() {
            return Err("Aucun fichier déposé n’est pris en charge.".into());
        }
        Ok(files)
    })
    .await
    .map_err(message)?
}

#[tauri::command]
pub async fn preview_fetch(
    app: AppHandle,
    urls: Vec<String>,
    id: String,
    kind: Option<String>,
) -> Result<PreviewFile> {
    let id = safe_id(&id)?;
    let hint = kind.as_deref().and_then(known_kind);
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("preview");
    fs::create_dir_all(&directory).map_err(message)?;
    let target = directory.join(format!("{id}.bin"));
    let name = urls
        .first()
        .map(|url| file_name(url))
        .unwrap_or_else(|| "document".into());
    if let Ok(metadata) = fs::metadata(&target) {
        if metadata.len() > 0 {
            return cached_file(
                &target,
                name,
                urls.first().cloned().unwrap_or_default(),
                hint,
            );
        }
    }

    let request_target = target.clone();
    let (bytes, source, kind) = tauri::async_runtime::spawn_blocking(move || download(&urls))
        .await
        .map_err(message)??;
    atomic_write(&request_target, &bytes).map_err(message)?;
    let (text, truncated) = if matches!(kind, "text" | "html") {
        let limit = (MAX_TEXT as usize).min(bytes.len());
        let (text, truncated) = text_of(&bytes[..limit], bytes.len() as u64 > MAX_TEXT);
        (Some(text), truncated)
    } else {
        (None, false)
    };
    Ok(PreviewFile {
        token: String::new(),
        name,
        path: target.to_string_lossy().into_owned(),
        kind: kind.to_owned(),
        bytes: bytes.len() as u64,
        source,
        text,
        truncated,
    })
}

/// Vérifie qu'au moins une URL sert un PDF, sans le télécharger en entier.
#[tauri::command]
pub async fn preview_probe(urls: Vec<String>) -> PreviewFileOrError<Option<String>> {
    let found =
        tauri::async_runtime::spawn_blocking(move || urls.into_iter().find(|url| probe(url)))
            .await
            .map_err(|error| error.to_string())?;
    Ok(found)
}

fn download(urls: &[String]) -> PreviewFileOrError<(Vec<u8>, String, &'static str)> {
    let mut failures = Vec::new();
    for url in urls {
        if !url.starts_with("https://") {
            continue;
        }
        match fetch(url) {
            Ok(result) => return Ok(result),
            Err(error) => failures.push(error),
        }
    }
    if failures.is_empty() {
        Err("Aucun lien https proposé pour cet aperçu.".into())
    } else {
        Err(format!(
            "Téléchargement impossible. {}",
            failures.first().cloned().unwrap_or_default()
        ))
    }
}

fn fetch(url: &str) -> PreviewFileOrError<(Vec<u8>, String, &'static str)> {
    if is_markdown_name(url) {
        return Err("Le Markdown s’ouvre dans l’éditeur Markdown.".into());
    }
    let response = ureq::get(url)
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/pdf,image/*,text/*,*/*;q=0.8")
        .timeout(Duration::from_secs(TIMEOUT_SECONDS))
        .call()
        .map_err(|error| format!("Téléchargement impossible ({url}) : {error}"))?;
    let mime = response
        .header("Content-Type")
        .unwrap_or_default()
        .to_owned();
    let length = response
        .header("Content-Length")
        .and_then(|value| value.parse::<u64>().ok());
    let mut kind = kind_from_mime(&mime).or_else(|| kind_from_name(url));
    let cap = cap_for(kind);
    if let Some(length) = length {
        if length > cap {
            return Err(format!(
                "Fichier trop volumineux ({} Mo maximum).",
                cap / (1024 * 1024)
            ));
        }
    }
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(cap + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Lecture impossible : {error}"))?;
    if bytes.is_empty() {
        return Err("Fichier vide.".into());
    }
    if bytes.len() as u64 > cap {
        return Err(format!(
            "Fichier trop volumineux ({} Mo maximum).",
            cap / (1024 * 1024)
        ));
    }
    if kind.is_none() {
        kind = kind_from_bytes(&bytes).or_else(|| looks_like_text(&bytes).then_some("text"));
    }
    let kind = kind.ok_or("Ce lien ne renvoie pas un format pris en charge.".to_string())?;
    if kind == "pdf" && !bytes.starts_with(b"%PDF-") {
        return Err(format!("Le lien ne renvoie pas un PDF ({url})."));
    }
    Ok((bytes, url.to_owned(), kind))
}

fn probe(url: &str) -> bool {
    if !url.starts_with("https://") {
        return false;
    }
    let Ok(response) = ureq::get(url)
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/pdf,*/*;q=0.8")
        .timeout(Duration::from_secs(12))
        .call()
    else {
        return false;
    };
    let mut head = [0_u8; 5];
    let mut reader = response.into_reader().take(5);
    reader.read_exact(&mut head).is_ok() && &head == b"%PDF-"
}

fn file_name(url: &str) -> String {
    let without_query = url.split(['?', '#']).next().unwrap_or(url);
    let name = without_query
        .split('/')
        .filter(|part| !part.is_empty())
        .next_back()
        .unwrap_or_default();
    if name.is_empty() {
        "document".into()
    } else {
        name.to_owned()
    }
}

/// Un identifiant OpenAlex (`W…`) ou une empreinte d'URL devient un nom de
/// fichier sûr.
fn safe_id(id: &str) -> Result<String> {
    let clean = id
        .strip_prefix("https://openalex.org/")
        .unwrap_or(id)
        .trim();
    if clean.is_empty()
        || clean.contains('/')
        || clean.contains('\\')
        || !clean
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(format!("Identifiant invalide : {id}"));
    }
    Ok(clean.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_openalex_identifiers() {
        assert_eq!(safe_id("W2741809807").unwrap(), "W2741809807");
        assert_eq!(
            safe_id("https://openalex.org/W2741809807").unwrap(),
            "W2741809807"
        );
        assert_eq!(safe_id("url-1a2b3c").unwrap(), "url-1a2b3c");
        assert!(safe_id("../../etc/passwd").is_err());
        assert!(safe_id("W1/../x").is_err());
        assert!(safe_id("").is_err());
    }

    #[test]
    fn classifies_extensions_and_urls() {
        assert_eq!(kind_from_name("Article.PDF"), Some("pdf"));
        assert_eq!(kind_from_name("photo.jpeg"), Some("image"));
        assert_eq!(kind_from_name("voice.m4a"), Some("audio"));
        assert_eq!(kind_from_name("clip.MOV"), Some("video"));
        assert_eq!(kind_from_name("notes.md"), None);
        assert_eq!(kind_from_name("index.html"), Some("html"));
        assert_eq!(kind_from_name("README"), None);
        assert_eq!(
            kind_from_name("https://example.org/a.pdf?download=1"),
            Some("pdf")
        );
    }

    #[test]
    fn classifies_magic_bytes() {
        assert_eq!(kind_from_bytes(b"%PDF-1.7"), Some("pdf"));
        assert_eq!(kind_from_bytes(b"\x89PNG\r\n\x1a\n"), Some("image"));
        assert_eq!(kind_from_bytes(b"\xff\xd8\xff\xe0"), Some("image"));
        assert_eq!(kind_from_bytes(b"OggS\0\0"), Some("audio"));
        assert_eq!(kind_from_bytes(b"RIFF\0\0\0\0WAVE"), Some("audio"));
        assert_eq!(kind_from_bytes(b"RIFF\0\0\0\0WEBP"), Some("image"));
        assert_eq!(kind_from_bytes(b"\0\0\0\x18ftypmp42"), Some("video"));
        assert_eq!(kind_from_bytes(b"hello"), None);
    }

    #[test]
    fn recognises_text_and_rejects_markdown() {
        assert!(looks_like_text(b"# Guide\nBonjour"));
        assert!(!looks_like_text(&[0, 1, 2]));
        assert!(is_markdown_name("notes.md"));
        assert!(is_markdown_name("NOTES.MARKDOWN"));
        assert!(!is_markdown_name("notes.txt"));
        assert_eq!(known_kind("image"), Some("image"));
        assert_eq!(known_kind("binary"), None);
    }

    #[test]
    fn reads_a_cached_text_without_an_extension() {
        let path = std::env::temp_dir().join(format!("spark-preview-{}.bin", uuid::Uuid::new_v4()));
        std::fs::write(&path, "bonjour").unwrap();
        let file = cached_file(
            &path,
            "README".into(),
            "https://example.org/README".into(),
            None,
        )
        .unwrap();
        assert_eq!(file.kind, "text");
        assert_eq!(file.text.as_deref(), Some("bonjour"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn ignores_non_https_urls() {
        assert!(!probe("http://example.org/x.pdf"));
        assert!(!probe("file:///etc/passwd"));
    }
}
