mod explorer;
mod markdown;
pub mod mcp;
mod settings;
mod storage;
mod terminal;
mod window;

use tauri::Manager;

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(terminal::Sessions::default())
        .setup(|app| {
            let path = app.path().app_config_dir()?;
            app.manage(markdown::MarkdownStorage::new(&path));
            app.manage(explorer::ExplorerStorage::new(&path));
            app.manage(storage::Storage::new(path).map_err(std::io::Error::other)?);
            match mcp::McpServer::start(app.handle().clone()) {
                Ok(server) => {
                    app.manage(server);
                }
                Err(error) => eprintln!("Pont MCP indisponible : {error}"),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            storage::workspace_load,
            storage::workspace_save,
            window::set_window_material,
            settings::settings_load,
            settings::settings_save,
            markdown::markdown_select,
            markdown::markdown_confirm_close,
            markdown::markdown_read,
            markdown::markdown_write,
            explorer::explorer_select,
            explorer::explorer_list,
            explorer::explorer_open_markdown,
            explorer::explorer_directory,
            terminal::terminal_start,
            terminal::terminal_input,
            terminal::terminal_resize,
            terminal::terminal_close,
            mcp_reply,
            mcp_cache_tools,
        ])
        .build(tauri::generate_context!())
        .expect("Démarrage de Lab impossible");
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            #[cfg(unix)]
            app.state::<terminal::Sessions>().close_all();
            if let Some(server) = app.try_state::<mcp::McpServer>() {
                server.shutdown();
            }
        }
    });
}

#[tauri::command]
fn mcp_reply(
    server: tauri::State<'_, mcp::McpServer>,
    connection: u64,
    line: String,
) -> std::result::Result<(), String> {
    server
        .reply(connection, &line)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn mcp_cache_tools(
    storage: tauri::State<'_, storage::Storage>,
    snapshot: String,
) -> std::result::Result<(), String> {
    let path = mcp::socket::tools_path().ok_or("Chemin MCP indisponible.")?;
    if let Some(run) = path.parent() {
        std::fs::create_dir_all(run).map_err(|error| error.to_string())?;
    }
    storage::atomic_write(&path, snapshot.as_bytes()).map_err(|error| error.to_string())
}
