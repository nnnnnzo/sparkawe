use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::{
    markdown::{self, MarkdownStorage},
    storage::{message, PathGrants, Result},
};

pub struct ExplorerStorage(PathGrants);

impl ExplorerStorage {
    pub fn new(home: &Path) -> Self {
        Self(PathGrants::new(home.join("explorer-access.json")))
    }

    pub(crate) fn resolve_path(&self, token: &str, segments: &[String]) -> Result<PathBuf> {
        let root = self.0.resolve(token)?;
        if root.canonicalize().map_err(message)? != root || !root.is_dir() {
            return Err("Le dossier sélectionné a changé d’emplacement.".into());
        }
        let mut target = root;
        for segment in segments {
            let mut components = Path::new(segment).components();
            match (components.next(), components.next()) {
                (Some(Component::Normal(name)), None) if name == segment.as_str() => {
                    target.push(name);
                }
                _ => return Err("Chemin invalide.".into()),
            }
            if target.symlink_metadata().map_err(message)?.is_symlink() {
                return Err("Les liens symboliques ne sont pas suivis.".into());
            }
        }
        if target.canonicalize().map_err(message)? != target {
            return Err("Le chemin a changé d’emplacement.".into());
        }
        Ok(target)
    }
}

#[derive(Serialize)]
pub struct ProjectFolder {
    token: String,
    name: String,
    path: String,
}

#[tauri::command]
pub async fn explorer_select(app: AppHandle) -> Result<Option<ProjectFolder>> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(folder) = app.dialog().file().blocking_pick_folder() else {
            return Ok(None);
        };
        let root = folder
            .into_path()
            .map_err(message)?
            .canonicalize()
            .map_err(message)?;
        if !root.is_dir() {
            return Err("Le dossier sélectionné est indisponible.".into());
        }
        let path = display_path(&root)?;
        let name = root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(&path)
            .to_owned();
        let token = app.state::<ExplorerStorage>().0.grant(&root)?;
        Ok(Some(ProjectFolder { token, name, path }))
    })
    .await
    .map_err(message)?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
enum Kind {
    Folder,
    File,
    Link,
}

#[derive(Serialize)]
pub struct Entry {
    name: String,
    kind: Kind,
}

fn read_directory(folder: &Path) -> Result<Vec<Entry>> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(folder).map_err(message)? {
        let entry = entry.map_err(message)?;
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        let kind = entry.file_type().map_err(message)?;
        let kind = if kind.is_dir() {
            Kind::Folder
        } else if kind.is_file() {
            Kind::File
        } else if kind.is_symlink() {
            Kind::Link
        } else {
            continue;
        };
        entries.push(Entry { name, kind });
    }
    Ok(entries)
}

#[tauri::command]
pub async fn explorer_list(
    app: AppHandle,
    token: String,
    segments: Vec<String>,
) -> Result<Vec<Entry>> {
    tauri::async_runtime::spawn_blocking(move || {
        let folder = app
            .state::<ExplorerStorage>()
            .resolve_path(&token, &segments)?;
        read_directory(&folder)
    })
    .await
    .map_err(message)?
}

#[tauri::command]
pub async fn explorer_open_markdown(
    app: AppHandle,
    token: String,
    segments: Vec<String>,
) -> Result<markdown::Selection> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = app
            .state::<ExplorerStorage>()
            .resolve_path(&token, &segments)?;
        markdown::open_file(&app.state::<MarkdownStorage>(), &file)
    })
    .await
    .map_err(message)?
}

#[tauri::command]
pub async fn explorer_directory(
    app: AppHandle,
    token: String,
    segments: Vec<String>,
) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let folder = app
            .state::<ExplorerStorage>()
            .resolve_path(&token, &segments)?;
        if !folder.is_dir() {
            return Err("Ce dossier est indisponible.".into());
        }
        display_path(&folder)
    })
    .await
    .map_err(message)?
}

fn display_path(path: &Path) -> Result<String> {
    // Windows canonical paths use UNC prefixes; keep the actual path for the PTY.
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| "Ce chemin ne peut pas être affiché.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restores_a_project_grant_and_opens_markdown_only_inside_the_project() {
        struct Fixture(PathBuf);
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
        let path = std::env::temp_dir().join(format!("spark-explorer-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        let fixture = Fixture(path);
        let project = fixture.0.join("project");
        fs::create_dir(&project).unwrap();
        let project = project.canonicalize().unwrap();
        fs::create_dir(project.join("docs")).unwrap();
        fs::write(project.join("docs/Guide.MD"), "# Guide").unwrap();
        fs::write(fixture.0.join("outside.md"), "# Outside").unwrap();

        let token = ExplorerStorage::new(&fixture.0).0.grant(&project).unwrap();
        let storage = ExplorerStorage::new(&fixture.0);
        let folder = storage.resolve_path(&token, &["docs".into()]).unwrap();
        assert_eq!(read_directory(&folder).unwrap()[0].name, "Guide.MD");
        assert!(storage
            .resolve_path(&token, &["..".into(), "outside.md".into()])
            .is_err());
        assert!(storage
            .resolve_path(&token, &["docs/Guide.MD".into()])
            .is_err());
        assert!(storage.resolve_path("unknown token", &[]).is_err());

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(fixture.0.join("outside.md"), project.join("link.md"))
                .unwrap();
            assert!(storage.resolve_path(&token, &["link.md".into()]).is_err());
        }

        let source = storage
            .resolve_path(&token, &["docs".into(), "Guide.MD".into()])
            .unwrap();
        let markdown = MarkdownStorage::new(&fixture.0);
        let file = markdown::open_file(&markdown, &source).unwrap();
        let payload = serde_json::to_value(file).unwrap();
        assert_eq!(payload["text"], "# Guide");
        assert!(payload["token"].is_string());
    }
}
