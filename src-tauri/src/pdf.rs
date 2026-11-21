//! Téléchargement et cache des PDF affichés par Aperçu.
//!
//! Le webview ne peut pas lire directement les PDF des éditeurs (CORS, frames,
//! CSP). On les télécharge ici, on les met en cache dans le dossier applicatif,
//! et le front les affiche via le protocole asset.
//!
//! Tous les hébergeurs ne servent pas les PDF aux clients non navigateurs :
//! on essaie les URL libres dans l'ordre et on garde la première qui répond
//! vraiment par un PDF.

use std::io::Read;
use std::time::Duration;

use tauri::{AppHandle, Manager};

const MAX_BYTES: u64 = 30 * 1024 * 1024;
const TIMEOUT_SECONDS: u64 = 30;
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfFile {
    path: String,
    bytes: u64,
    source: String,
}

#[tauri::command]
pub async fn pdf_fetch(app: AppHandle, urls: Vec<String>, id: String) -> Result<PdfFile, String> {
    let id = safe_id(&id)?;
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("pdf");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(format!("{id}.pdf"));
    if let Ok(metadata) = std::fs::metadata(&path) {
        if metadata.len() > 0 {
            return Ok(PdfFile {
                path: path.to_string_lossy().into_owned(),
                bytes: metadata.len(),
                source: urls.first().cloned().unwrap_or_default(),
            });
        }
    }

    let target = path.clone();
    let (bytes, source) = tauri::async_runtime::spawn_blocking(move || download(&urls))
        .await
        .map_err(|error| error.to_string())??;
    let size = bytes.len() as u64;
    crate::storage::atomic_write(&target, &bytes).map_err(|error| error.to_string())?;
    Ok(PdfFile {
        path: target.to_string_lossy().into_owned(),
        bytes: size,
        source,
    })
}

/// Vérifie qu'au moins une URL sert un PDF, sans le télécharger en entier.
#[tauri::command]
pub async fn pdf_probe(urls: Vec<String>) -> Result<Option<String>, String> {
    let found =
        tauri::async_runtime::spawn_blocking(move || urls.into_iter().find(|url| probe(url)))
            .await
            .map_err(|error| error.to_string())?;
    Ok(found)
}

fn download(urls: &[String]) -> Result<(Vec<u8>, String), String> {
    let mut failures = Vec::new();
    for url in urls {
        if !url.starts_with("https://") {
            continue;
        }
        match fetch(url) {
            Ok(bytes) => return Ok((bytes, url.clone())),
            Err(error) => failures.push(error),
        }
    }
    if failures.is_empty() {
        Err("Aucun lien PDF libre proposé pour ce travail.".into())
    } else {
        Err(format!(
            "PDF indisponible depuis l’éditeur. {}",
            failures.first().cloned().unwrap_or_default()
        ))
    }
}

fn fetch(url: &str) -> Result<Vec<u8>, String> {
    let response = ureq::get(url)
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/pdf,*/*;q=0.8")
        .timeout(Duration::from_secs(TIMEOUT_SECONDS))
        .call()
        .map_err(|error| format!("Téléchargement impossible ({url}) : {error}"))?;
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Lecture du PDF impossible : {error}"))?;
    if bytes.is_empty() {
        return Err("PDF vide.".into());
    }
    if bytes.len() as u64 > MAX_BYTES {
        return Err("PDF trop volumineux (30 Mo maximum).".into());
    }
    if !bytes.starts_with(b"%PDF") {
        return Err(format!("Le lien ne renvoie pas un PDF ({url})."));
    }
    Ok(bytes)
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

/// Un identifiant OpenAlex (`W…`) devient un nom de fichier sûr.
fn safe_id(id: &str) -> Result<String, String> {
    let clean = id
        .strip_prefix("https://openalex.org/")
        .unwrap_or(id)
        .trim();
    if clean.is_empty()
        || clean.contains('/')
        || clean.contains('\\')
        || !clean
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
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
        assert!(safe_id("../../etc/passwd").is_err());
        assert!(safe_id("W1/../x").is_err());
        assert!(safe_id("").is_err());
    }

    #[test]
    fn ignores_non_https_urls() {
        assert!(!probe("http://example.org/x.pdf"));
        assert!(!probe("file:///etc/passwd"));
    }
}
