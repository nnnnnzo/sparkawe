use std::path::PathBuf;

/// Identifiant du bundle. Doit rester aligné sur `tauri.conf.json`.
pub const IDENTIFIER: &str = "fr.spark.desktop";

/// Chemin du socket local. Calculé sans Tauri pour que le pont `spark-mcp`,
/// qui ne dépend pas de l'application, trouve exactement le même fichier.
#[cfg(target_os = "macos")]
pub fn path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(
        PathBuf::from(home)
            .join("Library/Application Support")
            .join(IDENTIFIER)
            .join("run")
            .join("mcp.sock"),
    )
}

#[cfg(target_os = "linux")]
pub fn path() -> Option<PathBuf> {
    if let Some(runtime) = std::env::var_os("XDG_RUNTIME_DIR") {
        return Some(PathBuf::from(runtime).join("spark").join("mcp.sock"));
    }
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))?;
    Some(base.join(IDENTIFIER).join("run").join("mcp.sock"))
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn path() -> Option<PathBuf> {
    None
}

/// Dernière liste d'outils connue, servie par le pont quand Spark est fermé.
pub fn tools_path() -> Option<PathBuf> {
    path().and_then(|path| path.parent().map(|run| run.join("tools.json")))
}
