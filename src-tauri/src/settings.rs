use std::{fs, io};

use tauri::State;

use crate::storage::{atomic_write, message, Result, Storage};

const FILE: &str = "settings-v1.json";

#[tauri::command]
pub fn settings_load(storage: State<'_, Storage>) -> Result<Option<String>> {
    match fs::read_to_string(storage.path(FILE)) {
        Ok(data) => Ok(Some(data)),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(message(err)),
    }
}

#[tauri::command]
pub fn settings_save(storage: State<'_, Storage>, snapshot: String) -> Result<()> {
    atomic_write(&storage.path(FILE), snapshot.as_bytes()).map_err(message)
}
