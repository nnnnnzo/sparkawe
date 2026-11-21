//! Pont MCP : relaie les messages stdio d'un client (Claude Code, Cursor…)
//! vers le socket local de l'application Lab.
//!
//! Le pont ne comprend pas le protocole JSON-RPC. Il transporte les lignes et,
//! quand Lab est fermé, répond de quoi garder le serveur enregistré côté client :
//! poignée de main locale, dernière liste d'outils connue, erreur explicite.

use std::io::{self, BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::time::Duration;

use lab_lib::mcp::socket;
use serde_json::{json, Value};

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Some(reply) = handle(&line) else {
            continue;
        };
        if stdout
            .write_all(reply.as_bytes())
            .and_then(|()| stdout.write_all(b"\n"))
            .and_then(|()| stdout.flush())
            .is_err()
        {
            break;
        }
    }
}

fn handle(line: &str) -> Option<String> {
    let message: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(_) => return Some(error(&Value::Null, -32700, "JSON invalide.")),
    };
    let id = message.get("id").cloned();
    let method = message
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();

    let Some(mut stream) = connect() else {
        return Some(offline(&id?, method, &message));
    };
    if stream.write_all(line.as_bytes()).is_err() || stream.write_all(b"\n").is_err() {
        return id.map(|id| error(&id, -32000, "Écriture MCP impossible."));
    }
    // Une notification n'attend pas de réponse.
    let id = id?;
    let mut reader = BufReader::new(stream);
    let mut response = String::new();
    match reader.read_line(&mut response) {
        Ok(0) => Some(error(&id, -32000, "Lab a fermé la connexion MCP.")),
        Ok(_) => Some(response.trim_end().to_string()),
        Err(_) => Some(error(&id, -32000, "Lecture MCP impossible.")),
    }
}

/// Reconnexion courte : 2 s au total, uniquement si l'application démarre.
fn connect() -> Option<UnixStream> {
    let path = socket::path()?;
    let delays = [40_u64, 80, 160, 320, 640, 760];
    for (index, delay) in delays.iter().enumerate() {
        match UnixStream::connect(&path) {
            Ok(stream) => return Some(stream),
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::NotFound
                        | io::ErrorKind::ConnectionRefused
                        | io::ErrorKind::WouldBlock
                ) =>
            {
                if index + 1 < delays.len() {
                    std::thread::sleep(Duration::from_millis(*delay));
                }
            }
            Err(_) => return None,
        }
    }
    None
}

fn offline(id: &Value, method: &str, message: &Value) -> String {
    match method {
        "initialize" => {
            let version = message
                .pointer("/params/protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or("2025-06-18");
            result(
                id,
                json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "lab", "version": "0.1.0" },
                    "instructions": "Lab n’est pas lancé. Ouvrez l’application puis relancez la demande."
                }),
            )
        }
        "ping" => result(id, json!({})),
        "tools/list" => result(id, json!({ "tools": cached_tools() })),
        _ => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": -32000,
                "message": "Lab n’est pas lancé. Ouvrez l’application puis réessayez.",
                "data": { "code": "lab_not_running" }
            }
        })
        .to_string(),
    }
}

fn cached_tools() -> Value {
    socket::tools_path()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .filter(Value::is_array)
        .unwrap_or_else(|| json!([]))
}

fn result(id: &Value, value: Value) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "result": value }).to_string()
}

fn error(id: &Value, code: i64, message: &str) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
        .to_string()
}
