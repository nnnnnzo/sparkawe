fn main() {
    let manifest = tauri_build::AppManifest::new().commands(&[
        "workspace_load",
        "workspace_save",
        "set_window_material",
        "settings_load",
        "settings_save",
        "markdown_select",
        "markdown_confirm_close",
        "markdown_write",
        "markdown_read",
        "explorer_select",
        "explorer_list",
        "explorer_open_markdown",
        "explorer_directory",
        "terminal_start",
        "terminal_input",
        "terminal_resize",
        "terminal_close",
        "set_window_material",
        "mcp_reply",
        "mcp_cache_tools",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("configuration Tauri invalide");
}
