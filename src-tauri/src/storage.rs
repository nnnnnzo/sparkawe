use std::{
    collections::HashMap,
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

use tauri::State;
use uuid::Uuid;

pub(crate) type Result<T> = std::result::Result<T, String>;

pub(crate) fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

type Files = HashMap<String, PathBuf>;

pub struct PathGrants {
    path: PathBuf,
    files: Mutex<Option<Files>>,
}

impl PathGrants {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            files: Mutex::new(None),
        }
    }

    fn load_files<'a>(&self, files: &'a mut Option<Files>) -> Result<&'a mut Files> {
        if files.is_none() {
            *files = Some(match fs::read(&self.path) {
                Ok(bytes) => serde_json::from_slice(&bytes).map_err(message)?,
                Err(err) if err.kind() == io::ErrorKind::NotFound => Files::new(),
                Err(err) => return Err(message(err)),
            });
        }
        Ok(files.as_mut().expect("Le registre de fichiers est chargé"))
    }

    pub(crate) fn grant(&self, path: &Path) -> Result<String> {
        let mut guard = self.files.lock().map_err(message)?;
        let files = self.load_files(&mut guard)?;
        if let Some((token, _)) = files.iter().find(|(_, value)| *value == path) {
            return Ok(token.clone());
        }
        let token = Uuid::new_v4().to_string();
        files.insert(token.clone(), path.to_owned());
        let result = serde_json::to_vec(files)
            .map_err(message)
            .and_then(|bytes| atomic_write(&self.path, &bytes).map_err(message));
        if result.is_err() {
            files.remove(&token);
        }
        result.map(|()| token)
    }

    pub(crate) fn resolve(&self, token: &str) -> Result<PathBuf> {
        let mut guard = self.files.lock().map_err(message)?;
        self.load_files(&mut guard)?
            .get(token)
            .cloned()
            .ok_or_else(|| "Accès au chemin non autorisé.".into())
    }
}

#[derive(Clone)]
pub struct Storage {
    home: PathBuf,
}

impl Storage {
    pub fn new(home: PathBuf) -> Result<Self> {
        fs::create_dir_all(&home).map_err(message)?;
        Ok(Self { home })
    }

    pub(crate) fn path(&self, name: &str) -> PathBuf {
        self.home.join(name)
    }
}

pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path.parent().ok_or(io::ErrorKind::InvalidInput)?;
    let temporary = parent.join(format!(".spark-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        if let Ok(metadata) = fs::metadata(path) {
            file.set_permissions(metadata.permissions())?;
        } else {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                file.set_permissions(fs::Permissions::from_mode(0o600))?;
            }
        }
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[tauri::command]
pub fn workspace_load(storage: State<'_, Storage>) -> Result<Option<String>> {
    match fs::read_to_string(storage.home.join("workspace-v1.json")) {
        Ok(data) => Ok(Some(data)),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(message(err)),
    }
}

#[tauri::command]
pub fn workspace_save(storage: State<'_, Storage>, snapshot: String, recovery: bool) -> Result<()> {
    let path = storage.home.join("workspace-v1.json");
    let backup = storage.home.join("workspace-recovery.json");
    if recovery && path.exists() && !backup.exists() {
        atomic_write(&backup, &fs::read(&path).map_err(message)?).map_err(message)?;
    }
    atomic_write(&path, snapshot.as_bytes()).map_err(message)
}
