//! Branchement d'un agent détecté dans le terminal sur le pont MCP de Spark.
//!
//! Chaque client range ses serveurs MCP à sa façon : JSON pour Claude Code,
//! Cursor et Gemini, TOML pour Codex. On ne touche qu'à l'entrée `spark` et on
//! préserve le reste du fichier.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

fn home() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "Dossier personnel introuvable.".to_string())
}

/// Configure le client demandé et renvoie le message à afficher.
pub fn setup(agent: &str) -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let bridge = crate::mcp::sidecar_path(&exe);
    if !bridge.exists() {
        return Err("Le pont Spark n’est pas encore construit.".into());
    }
    let command = bridge.to_string_lossy().into_owned();
    let home = home()?;
    let (label, path) = match agent {
        "claude" => ("Claude Code", home.join(".claude.json")),
        "codex" => ("Codex", home.join(".codex/config.toml")),
        "cursor" => ("Cursor", home.join(".cursor/mcp.json")),
        "gemini" => ("Gemini CLI", home.join(".gemini/settings.json")),
        "opencode" => ("OpenCode", home.join(".config/opencode/opencode.json")),
        "vibe" => ("Mistral Vibe", home.join(".vibe/config.toml")),
        other => return Err(format!("Agent inconnu : {other}")),
    };
    match agent {
        "claude" => setup_claude(&home, &command)?,
        "codex" => merge_toml(&path, &command)?,
        "opencode" => setup_opencode(&home, &command)?,
        "vibe" => setup_vibe(&home, &command)?,
        _ => merge_json(&path, &command)?,
    }
    Ok(format!("Spark est connecté à {label}."))
}

/// Claude Code sait écrire sa propre configuration : on préfère son CLI, qui
/// gère les verrous et le format, et on retombe sur le fichier s'il est absent.
fn setup_claude(home: &Path, command: &str) -> Result<(), String> {
    let Some(binary) = find_claude(home) else {
        return merge_json(&home.join(".claude.json"), command);
    };
    let _ = std::process::Command::new(&binary)
        .args(["mcp", "remove", "--scope", "user", "spark"])
        .output();
    let output = std::process::Command::new(&binary)
        .args(["mcp", "add", "--scope", "user", "spark", "--", command])
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        return Ok(());
    }
    let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if message.is_empty() {
        "Claude Code a refusé la configuration.".into()
    } else {
        message
    })
}

fn find_claude(home: &Path) -> Option<PathBuf> {
    find_binary(home, "claude", &[".local/bin/claude", ".claude/bin/claude"])
}

/// OpenCode écrit lui aussi sa configuration : son CLI évite de deviner le
/// schéma. Le fichier reste le repli quand la commande est absente.
fn setup_opencode(home: &Path, command: &str) -> Result<(), String> {
    if let Some(binary) = find_binary(home, "opencode", &[".opencode/bin/opencode"]) {
        let output = std::process::Command::new(&binary)
            .args(["mcp", "add", "--global", "spark", "--", command])
            .output()
            .map_err(|error| error.to_string())?;
        if output.status.success() {
            return Ok(());
        }
    }
    merge_opencode_json(&home.join(".config/opencode/opencode.json"), command)
}

fn merge_opencode_json(path: &Path, command: &str) -> Result<(), String> {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let mut root: Value = if text.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(&text)
            .map_err(|error| format!("Configuration illisible ({}) : {error}", path.display()))?
    };
    let object = root
        .as_object_mut()
        .ok_or_else(|| format!("Configuration inattendue : {}", path.display()))?;
    let mcp = object.entry("mcp").or_insert_with(|| json!({}));
    let mcp = mcp
        .as_object_mut()
        .ok_or_else(|| format!("Section mcp inattendue : {}", path.display()))?;
    let servers = mcp.entry("servers").or_insert_with(|| json!({}));
    servers
        .as_object_mut()
        .ok_or_else(|| format!("Section mcp.servers inattendue : {}", path.display()))?
        .insert(
            "spark".into(),
            json!({ "type": "local", "command": [command] }),
        );
    let output = serde_json::to_string_pretty(&root).map_err(|error| error.to_string())?;
    write(path, output.as_bytes())
}

/// Vibe range ses serveurs dans un tableau `[[mcp_servers]]` : chaque bloc
/// commence par ce marqueur et va jusqu'à la table suivante.
fn setup_vibe(home: &Path, command: &str) -> Result<(), String> {
    if let Some(binary) = find_binary(home, "vibe", &[".local/bin/vibe", ".vibe/bin/vibe"]) {
        let _ = std::process::Command::new(&binary)
            .args(["mcp", "remove", "spark"])
            .output();
        let output = std::process::Command::new(&binary)
            .args([
                "mcp",
                "add",
                "spark",
                "--transport",
                "stdio",
                "--command",
                command,
            ])
            .output()
            .map_err(|error| error.to_string())?;
        if output.status.success() {
            clear_vibe_descriptors(home);
            return Ok(());
        }
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !message.is_empty() {
            return Err(message);
        }
    }
    merge_vibe_toml(&home.join(".vibe/config.toml"), command)?;
    clear_vibe_descriptors(home);
    Ok(())
}

/// Vibe garde une copie des outils découverts : après un changement de la
/// liste, on l'efface pour que la prochaine session redécouvre le serveur.
pub(crate) fn clear_vibe_descriptors(home: &Path) {
    let directory = home.join(".vibe/logs/mcp-descriptors/unified");
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        if text.contains("\"sourceName\":\"spark\"") {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn merge_vibe_toml(path: &Path, command: &str) -> Result<(), String> {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    let mut kept: Vec<&str> = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        if lines[index].trim() == "[[mcp_servers]]" {
            let start = index;
            index += 1;
            while index < lines.len() && !lines[index].trim_start().starts_with('[') {
                index += 1;
            }
            let block = &lines[start..index];
            if block_value(block, "name").as_deref() != Some("spark") {
                kept.extend_from_slice(block);
            }
        } else {
            kept.push(lines[index]);
            index += 1;
        }
    }
    while kept.last().is_some_and(|line| line.trim().is_empty()) {
        kept.pop();
    }
    let quoted = serde_json::to_string(command).map_err(|error| error.to_string())?;
    let mut output = kept.join("\n");
    if !output.is_empty() {
        output.push_str("\n\n");
    }
    output.push_str(&format!(
        "[[mcp_servers]]\nname = \"spark\"\ntransport = \"stdio\"\ncommand = {quoted}\nargs = []\n"
    ));
    write(path, output.as_bytes())
}

fn vibe_command(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    vibe_spark_command(&text)
}

fn vibe_spark_command(text: &str) -> Option<String> {
    let lines: Vec<&str> = text.lines().collect();
    let mut index = 0;
    while index < lines.len() {
        if lines[index].trim() == "[[mcp_servers]]" {
            let start = index;
            index += 1;
            while index < lines.len() && !lines[index].trim_start().starts_with('[') {
                index += 1;
            }
            let block = &lines[start..index];
            if block_value(block, "name").as_deref() == Some("spark") {
                return block_value(block, "command");
            }
        } else {
            index += 1;
        }
    }
    None
}

fn block_value(block: &[&str], key: &str) -> Option<String> {
    for line in block {
        let Some(rest) = line.trim().strip_prefix(key) else {
            continue;
        };
        let Some(rest) = rest.trim_start().strip_prefix('=') else {
            continue;
        };
        return serde_json::from_str::<String>(rest.trim()).ok();
    }
    None
}

fn find_binary(home: &Path, name: &str, paths: &[&str]) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = paths.iter().map(|path| home.join(path)).collect();
    candidates.push(PathBuf::from(format!("/opt/homebrew/bin/{name}")));
    candidates.push(PathBuf::from(format!("/usr/local/bin/{name}")));
    candidates.into_iter().find(|path| path.is_file())
}

/// Vrai si le client est déjà branché sur ce pont précis. Un chemin différent
/// (application déplacée, pont reconstruit ailleurs) mérite une nouvelle
/// proposition.
pub fn connected(agent: &str) -> bool {
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    let bridge = crate::mcp::sidecar_path(&exe)
        .to_string_lossy()
        .into_owned();
    let Ok(home) = home() else {
        return false;
    };
    let found = match agent {
        "claude" => json_string(&home.join(".claude.json"), "/mcpServers/spark/command"),
        "cursor" => json_string(&home.join(".cursor/mcp.json"), "/mcpServers/spark/command"),
        "gemini" => json_string(
            &home.join(".gemini/settings.json"),
            "/mcpServers/spark/command",
        ),
        "opencode" => json_string(
            &home.join(".config/opencode/opencode.json"),
            "/mcp/servers/spark/command/0",
        ),
        "codex" => toml_command(&home.join(".codex/config.toml")),
        "vibe" => vibe_command(&home.join(".vibe/config.toml")),
        _ => None,
    };
    found.as_deref() == Some(bridge.as_str())
}

fn json_string(path: &Path, pointer: &str) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let root: Value = serde_json::from_str(&text).ok()?;
    let value = root.pointer(pointer)?;
    value.as_str().map(str::to_owned)
}

fn toml_command(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let mut in_block = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_block = trimmed == "[mcp_servers.spark]";
            continue;
        }
        if !in_block {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("command") {
            let value = rest.trim().strip_prefix('=')?.trim();
            return serde_json::from_str::<String>(value).ok();
        }
    }
    None
}

fn merge_json(path: &Path, command: &str) -> Result<(), String> {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let mut root: Value = if text.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(&text)
            .map_err(|error| format!("Configuration illisible ({}) : {error}", path.display()))?
    };
    let object = root
        .as_object_mut()
        .ok_or_else(|| format!("Configuration inattendue : {}", path.display()))?;
    let servers = object.entry("mcpServers").or_insert_with(|| json!({}));
    servers
        .as_object_mut()
        .ok_or_else(|| format!("Section mcpServers inattendue : {}", path.display()))?
        .insert("spark".into(), json!({ "command": command }));
    let output = serde_json::to_string_pretty(&root).map_err(|error| error.to_string())?;
    write(path, output.as_bytes())
}

fn merge_toml(path: &Path, command: &str) -> Result<(), String> {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let mut kept: Vec<&str> = Vec::new();
    let mut skipping = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            skipping =
                trimmed == "[mcp_servers.spark]" || trimmed.starts_with("[mcp_servers.spark.");
        }
        if !skipping {
            kept.push(line);
        }
    }
    while kept.last().is_some_and(|line| line.trim().is_empty()) {
        kept.pop();
    }
    let quoted = serde_json::to_string(command).map_err(|error| error.to_string())?;
    let mut output = kept.join("\n");
    if !output.is_empty() {
        output.push_str("\n\n");
    }
    output.push_str(&format!("[mcp_servers.spark]\ncommand = {quoted}\n"));
    write(path, output.as_bytes())
}

fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    crate::storage::atomic_write(path, bytes).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary() -> PathBuf {
        let path = std::env::temp_dir().join(format!("spark-agents-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn json_config_keeps_other_servers() {
        let root = temporary();
        let path = root.join("config.json");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            &path,
            r#"{"theme":"dark","mcpServers":{"other":{"command":"x"}}}"#,
        )
        .unwrap();

        merge_json(&path, "/pont/spark-mcp").unwrap();
        merge_json(&path, "/pont/spark-mcp").unwrap();

        let value: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["theme"], "dark");
        assert_eq!(value["mcpServers"]["other"]["command"], "x");
        assert_eq!(value["mcpServers"]["spark"]["command"], "/pont/spark-mcp");
        assert_eq!(
            value["mcpServers"]
                .as_object()
                .unwrap()
                .keys()
                .filter(|key| *key == "spark")
                .count(),
            1
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn detects_an_existing_connection() {
        let root = temporary();
        let path = root.join("config.json");
        std::fs::write(
            &path,
            r#"{"mcpServers":{"spark":{"command":"/pont/spark-mcp"}}}"#,
        )
        .unwrap();
        assert_eq!(
            json_string(&path, "/mcpServers/spark/command").as_deref(),
            Some("/pont/spark-mcp")
        );
        assert_eq!(json_string(&path, "/mcpServers/spark/absent"), None);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reads_the_codex_command() {
        let root = temporary();
        let path = root.join("config.toml");
        std::fs::write(
            &path,
            "[mcp_servers.other]\ncommand = \"x\"\n\n[mcp_servers.spark]\ncommand = \"/pont\"\n",
        )
        .unwrap();
        assert_eq!(toml_command(&path).as_deref(), Some("/pont"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn opencode_config_uses_the_mcp_servers_shape() {
        let root = temporary();
        let path = root.join("opencode.json");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&path, r##"{"$schema":"x","provider":{"a":1}}"##).unwrap();

        merge_opencode_json(&path, "/pont/spark-mcp").unwrap();

        let value: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["$schema"], "x");
        assert_eq!(value["provider"]["a"], 1);
        assert_eq!(value["mcp"]["servers"]["spark"]["type"], "local");
        assert_eq!(
            value["mcp"]["servers"]["spark"]["command"][0],
            "/pont/spark-mcp"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn vibe_config_replaces_only_the_spark_block() {
        let root = temporary();
        let path = root.join("config.toml");
        std::fs::write(
            &path,
            "active_model = \"x\"\n\n[[mcp_servers]]\nname = \"other\"\ntransport = \"stdio\"\ncommand = \"y\"\n\n[[mcp_servers]]\nname = \"spark\"\ntransport = \"stdio\"\ncommand = \"/vieux\"\n\n[tools.bash]\npermission = \"ask\"\n",
        )
        .unwrap();

        merge_vibe_toml(&path, "/nouveau").unwrap();

        let output = std::fs::read_to_string(&path).unwrap();
        assert!(output.contains("name = \"other\""));
        assert!(!output.contains("/vieux"));
        assert!(output.contains("name = \"spark\""));
        assert!(output.contains("command = \"/nouveau\""));
        assert!(output.contains("[tools.bash]"));
        assert_eq!(vibe_spark_command(&output).as_deref(), Some("/nouveau"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn toml_config_replaces_only_the_spark_block() {
        let root = temporary();
        let path = root.join("config.toml");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            &path,
            "model = \"x\"\n\n[mcp_servers.other]\ncommand = \"y\"\n\n[mcp_servers.spark]\ncommand = \"/vieux\"\n\n[mcp_servers.spark.env]\nA = \"1\"\n\n[projects.\"/tmp\"]\ntrust_level = \"trusted\"\n",
        )
        .unwrap();

        merge_toml(&path, "/pont/spark-mcp").unwrap();

        let output = std::fs::read_to_string(&path).unwrap();
        assert!(output.contains("model = \"x\""));
        assert!(output.contains("[mcp_servers.other]\ncommand = \"y\""));
        assert!(output.contains("[mcp_servers.spark]\ncommand = \"/pont/spark-mcp\""));
        assert!(!output.contains("/vieux"));
        assert!(!output.contains("[mcp_servers.spark.env]"));
        assert!(output.contains("[projects.\"/tmp\"]"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
