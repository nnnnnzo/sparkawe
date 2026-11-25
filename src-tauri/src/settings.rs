use tauri::State;

use crate::storage::{load_snapshot, message, save_snapshot, Result, Storage};

#[tauri::command]
pub async fn settings_load(storage: State<'_, Storage>) -> Result<Option<String>> {
    storage
        .on_worker(|storage| {
            storage.db()?.with(|conn| {
                load_snapshot(conn, "settings")?
                    .map(String::from_utf8)
                    .transpose()
                    .map_err(message)
            })
        })
        .await
}

#[tauri::command]
pub async fn settings_save(storage: State<'_, Storage>, snapshot: String) -> Result<()> {
    storage
        .on_worker(move |storage| {
            storage
                .db()?
                .with(|conn| save_snapshot(conn, "settings", snapshot.as_bytes()))
        })
        .await
}
