use std::{fs, path::Path, sync::Mutex};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::storage::{atomic_write, message, GrantKind, PathGrants, Result, Storage};

pub struct MarkdownStorage(PathGrants, Mutex<()>);

impl MarkdownStorage {
    pub fn new(storage: &Storage) -> Self {
        Self(
            PathGrants::new(storage, GrantKind::Markdown),
            Mutex::new(()),
        )
    }
}

#[tauri::command]
pub async fn markdown_confirm_close(app: AppHandle, name: String) -> Result<bool> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .message(format!(
                "Fermer « {name} » et abandonner les modifications ?"
            ))
            .title("Modifications non enregistrées")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Abandonner".into(),
                "Annuler".into(),
            ))
            .blocking_show()
    })
    .await
    .map_err(message)
}

#[derive(Serialize)]
pub struct Selection {
    token: String,
    path: String,
    directory: String,
    text: String,
}

#[tauri::command]
pub async fn markdown_select(
    app: AppHandle,
    save: bool,
    name: Option<String>,
) -> Result<Option<Selection>> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app
            .dialog()
            .file()
            .add_filter("Markdown", &["md", "markdown"]);
        if let Some(name) = name {
            dialog = dialog.set_file_name(name);
        }
        let selected = if save {
            dialog.blocking_save_file()
        } else {
            dialog.blocking_pick_file()
        };
        let Some(path) = selected else {
            return Ok(None);
        };
        let mut path = path.into_path().map_err(message)?;
        if save && path.extension().is_none() {
            path.set_extension("md");
        }
        select_file(&app.state::<MarkdownStorage>(), &path, save).map(Some)
    })
    .await
    .map_err(message)?
}

pub(crate) fn open_file(storage: &MarkdownStorage, path: &Path) -> Result<Selection> {
    select_file(storage, path, false)
}

fn select_file(storage: &MarkdownStorage, path: &Path, save: bool) -> Result<Selection> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "md" | "markdown") {
        return Err("Choisis un fichier Markdown (.md ou .markdown).".into());
    }
    let parent = path.parent().ok_or("Chemin incomplet.")?;
    let directory = parent.canonicalize().map_err(message)?;
    let target = directory.join(path.file_name().ok_or("Nom de fichier manquant.")?);
    verify_path(&target, !save)?;
    let text = if save {
        String::new()
    } else {
        fs::read_to_string(&target).map_err(message)?
    };
    Ok(Selection {
        token: storage.0.grant(&target)?,
        text,
        path: target.to_string_lossy().into_owned(),
        directory: directory.to_string_lossy().into_owned(),
    })
}

fn verify_path(path: &Path, must_exist: bool) -> Result<()> {
    let parent = path.parent().ok_or("Chemin incomplet.")?;
    if parent.canonicalize().map_err(message)? != parent
        || path.is_symlink()
        || (path.exists() && !path.is_file())
        || (must_exist && !path.is_file())
    {
        return Err("Le fichier autorisé a changé d’emplacement ou de type.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn markdown_read(app: AppHandle, token: String) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = app.state::<MarkdownStorage>().0.resolve(&token)?;
        verify_path(&path, true)?;
        fs::read_to_string(path).map_err(message)
    })
    .await
    .map_err(message)?
}

#[tauri::command]
pub async fn markdown_write(
    app: AppHandle,
    token: String,
    text: String,
    expected: Option<String>,
) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let storage = app.state::<MarkdownStorage>();
        // Le contrôle de la version et son remplacement restent solidaires
        // face à d’autres sauvegardes de cette instance.
        let _write = storage.1.lock().map_err(message)?;
        let path = storage.0.resolve(&token)?;
        verify_path(&path, false)?;
        if let Some(expected) = expected {
            if fs::read_to_string(&path).map_err(message)? != expected {
                return Err("Le fichier a changé sur le disque. Utilise « Enregistrer sous » pour conserver tes modifications.".into());
            }
        }
        atomic_write(&path, text.as_bytes()).map_err(message)
    })
    .await
    .map_err(message)?
}
