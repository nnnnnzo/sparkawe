mod activity;
mod agents;
mod database;
mod explorer;
mod extensions;
mod markdown;
pub mod mcp;
mod menu;
mod notifications;
mod preview;
mod settings;
mod storage;
mod terminal;
mod web;
mod window;

use std::path::Path;

use tauri::Manager;

/// Reprend les données laissées par l'ancien identifiant `fr.lab.desktop`.
/// Les fichiers déjà présents ne sont jamais écrasés et l'ancien dossier reste
/// en place comme sauvegarde. Le socket obsolète n'est pas copié.
fn migrate_legacy_config(path: &Path) -> std::io::Result<()> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    let marker = path.join(".migrated-from-lab");
    let legacy = parent.join("fr.lab.desktop");
    if marker.try_exists()? || legacy == path || !legacy.try_exists()? {
        return Ok(());
    }
    copy_missing(&legacy, path, true)?;
    storage::atomic_write(&marker, b"spark 0.1\n")
}

fn copy_missing(from: &Path, to: &Path, root: bool) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        let name_str = name.to_str().unwrap_or_default();
        if root
            && (name_str.starts_with(".spark-")
                || matches!(name_str, "run" | "mcp.sock")
                || ["activity.db", "spark.db"].iter().any(|db| {
                    name_str == *db
                        || name_str
                            .strip_prefix(db)
                            .is_some_and(|tail| tail.starts_with('-'))
                }))
        {
            continue;
        }
        let target = to.join(&name);
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_missing(&entry.path(), &target, false)?;
        } else if file_type.is_file() && !target.try_exists()? {
            storage::atomic_write(&target, &std::fs::read(entry.path())?)?;
        }
    }
    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .on_menu_event(|app, event| {
            use tauri::Emitter;
            let id = event.id().0.as_str();
            if let Some(rest) = id.strip_prefix("spark.tile.move.") {
                if let Some((tile, side)) = rest.rsplit_once('.') {
                    let _ = app.emit(
                        "tile-move",
                        serde_json::json!({ "tile": tile, "side": side }),
                    );
                }
            }
        })
        .manage(terminal::Sessions::default())
        .manage(web::Pages::default())
        .setup(|app| {
            let path = app.path().app_config_dir()?;
            let storage = storage::Storage::new(path);
            app.manage(markdown::MarkdownStorage::new(&storage));
            app.manage(explorer::ExplorerStorage::new(&storage));
            app.manage(preview::PreviewStorage::new(&storage));
            let ready = storage.db().map(|_| ());
            app.manage(storage);
            if let Err(error) = ready {
                // workspace_load transmettra la même erreur à l’écran de démarrage.
                eprintln!("{error}");
                return Ok(());
            }
            // Vibe met ses outils en cache : on le vide pour que la prochaine
            // session voie la liste courante, même après une mise à jour.
            if let Some(home) = std::env::var_os("HOME").map(std::path::PathBuf::from) {
                agents::clear_vibe_descriptors(&home);
            }
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
            activity::activity_load,
            activity::activity_append,
            activity::activity_revert,
            activity::activity_forget,
            activity::activity_seen,
            activity::activity_clear,
            extensions::extension_list,
            extensions::extension_install,
            extensions::extension_remove,
            extensions::extension_install_zip,
            extensions::registry_fetch,
            extensions::extension_sources,
            extensions::extension_source_add,
            extensions::extension_source_remove,
            window::set_window_material,
            window::set_window_theme,
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
            mcp_notify,
            mcp_cache_tools,
            mcp_link,
            agent_setup,
            agent_connected,
            preview::preview_select,
            preview::preview_source,
            preview::preview_from_explorer,
            preview::preview_drop,
            preview::preview_fetch,
            preview::preview_probe,
            notifications::notify_desktop,
            menu::popup_tile_menu,
            web::web_open,
            web::web_bounds,
            web::web_snapshot,
            web::web_appearance,
            web::web_show,
            web::web_navigate,
            web::web_history,
            web::web_reload,
            web::web_close,
            web::web_read_text,
        ])
        .build(tauri::generate_context!())
        .expect("Démarrage de Spark impossible");
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
fn mcp_notify(
    server: tauri::State<'_, mcp::McpServer>,
    line: String,
) -> std::result::Result<(), String> {
    server.broadcast(&line).map_err(|error| error.to_string())
}

#[tauri::command]
fn mcp_cache_tools(snapshot: String) -> std::result::Result<(), String> {
    let path = mcp::socket::tools_path().ok_or("Chemin MCP indisponible.")?;
    if let Some(run) = path.parent() {
        std::fs::create_dir_all(run).map_err(|error| error.to_string())?;
    }
    storage::atomic_write(&path, snapshot.as_bytes()).map_err(|error| error.to_string())
}

/// Ce qu'un client MCP doit déclarer pour joindre cette application.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentLink {
    command: String,
    available: bool,
    config: String,
}

#[tauri::command]
fn mcp_link() -> std::result::Result<AgentLink, String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let path = mcp::sidecar_path(&exe);
    let command = path.to_string_lossy().into_owned();
    let available = path.exists();
    let config = serde_json::json!({
        "mcpServers": { "spark": { "command": &command } }
    })
    .to_string();
    Ok(AgentLink {
        command,
        available,
        config,
    })
}

/// Branche le client détecté dans le terminal sur le pont de cette application.
#[tauri::command]
fn agent_setup(agent: String) -> std::result::Result<String, String> {
    agents::setup(&agent)
}

/// Demande à la personne d'autoriser une action qui modifie des données.
/// Évite de reproposer la connexion d'un agent déjà branché sur ce pont.
#[tauri::command]
fn agent_connected(agent: String) -> bool {
    agents::connected(&agent)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_reprise_reprend_les_fichiers_manquants_sans_ecraser() {
        let root = std::env::temp_dir().join(format!("spark-migration-{}", uuid::Uuid::new_v4()));
        let legacy = root.join("fr.lab.desktop");
        let current = root.join("fr.spark.desktop");
        std::fs::create_dir_all(legacy.join("run")).unwrap();
        std::fs::write(legacy.join("workspace-v1.json"), "ancien").unwrap();
        std::fs::write(legacy.join("settings.json"), "reglages").unwrap();
        std::fs::write(legacy.join("run/mcp.sock"), "socket").unwrap();
        std::fs::write(legacy.join("run/tools.json"), "outils").unwrap();
        std::fs::create_dir_all(&current).unwrap();
        std::fs::write(current.join("workspace-v1.json"), "actuel").unwrap();

        migrate_legacy_config(&current).unwrap();

        assert_eq!(
            std::fs::read_to_string(current.join("workspace-v1.json")).unwrap(),
            "actuel"
        );
        assert_eq!(
            std::fs::read_to_string(current.join("settings.json")).unwrap(),
            "reglages"
        );
        assert!(!current.join("run/tools.json").exists());
        assert!(!current.join("run/mcp.sock").exists());
        assert!(legacy.join("workspace-v1.json").exists());

        assert!(current.join(".migrated-from-lab").exists());
        std::fs::remove_file(current.join("settings.json")).unwrap();
        migrate_legacy_config(&current).unwrap();
        assert!(!current.join("settings.json").exists());

        std::fs::remove_dir_all(root).unwrap();
    }
}
