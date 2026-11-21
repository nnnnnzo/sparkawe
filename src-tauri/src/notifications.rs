use tauri::{AppHandle, Runtime};
use tauri_plugin_notification::NotificationExt;

/// Notification système. Sur le bureau, la permission est accordée par défaut ;
/// l’appel échoue seulement si l’OS refuse, et l’extension retombe alors sur
/// son propre signal.
#[tauri::command]
pub fn notify_desktop<R: Runtime>(
    app: AppHandle<R>,
    title: String,
    body: Option<String>,
) -> Result<(), String> {
    let mut builder = app.notification().builder().title(title);
    if let Some(body) = body {
        builder = builder.body(body);
    }
    builder.show().map_err(|error| error.to_string())
}
