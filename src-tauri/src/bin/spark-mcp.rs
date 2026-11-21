//! Pont MCP : relaie les messages stdio d'un client (Claude Code, Cursor…)
//! vers le socket local de l'application Spark.
//!
//! Le pont ne comprend pas le protocole JSON-RPC. Il transporte les lignes et,
//! quand Spark est fermé, répond de quoi garder le serveur enregistré côté client :
//! poignée de main locale, dernière liste d'outils connue, erreur explicite.

use std::io::{self, BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::time::Duration;

use serde_json::{json, Value};
use spark_lib::mcp::socket;

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Some(reply) = handle(&line, &mut stdout) else {
            continue;
        };
        if write_line(&mut stdout, &reply).is_err() {
            break;
        }
    }
}

fn write_line(out: &mut impl Write, line: &str) -> io::Result<()> {
    out.write_all(line.as_bytes())?;
    out.write_all(b"\n")?;
    out.flush()
}

fn handle(line: &str, out: &mut impl Write) -> Option<String> {
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
    match read_reply(&mut reader, &id, out) {
        Ok(reply) => Some(reply),
        Err(failure) if failure.kind() == io::ErrorKind::UnexpectedEof => {
            Some(error(&id, -32000, "Spark a fermé la connexion MCP."))
        }
        Err(_) => Some(error(&id, -32000, "Lecture MCP impossible.")),
    }
}

/// Lit jusqu'à la réponse portant notre `id`. Les notifications du serveur
/// (par exemple `tools/list_changed`) sont relayées immédiatement : les
/// prendre pour la réponse bloquerait le client.
fn read_reply(reader: &mut impl BufRead, id: &Value, out: &mut impl Write) -> io::Result<String> {
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "Connexion fermée.",
            ));
        }
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            return Ok(trimmed.to_string());
        };
        if value.get("id") == Some(id) {
            return Ok(trimmed.to_string());
        }
        write_line(out, trimmed)?;
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
                    "serverInfo": { "name": "spark", "version": "0.1.0" },
                    "instructions": "Spark n’est pas lancé. Ouvrez l’application puis relancez la demande."
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
                "message": "Spark n’est pas lancé. Ouvrez l’application puis réessayez.",
                "data": { "code": "spark_not_running" }
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
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn forwards_notifications_before_the_reply() {
        let input = concat!(
            "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/tools/list_changed\"}\n",
            "{\"jsonrpc\":\"2.0\",\"id\":7,\"result\":{\"ok\":true}}\n",
        );
        let mut reader = BufReader::new(Cursor::new(input));
        let mut forwarded = Vec::new();
        let reply = read_reply(&mut reader, &json!(7), &mut forwarded).unwrap();
        let forwarded = String::from_utf8(forwarded).unwrap();
        assert!(forwarded.contains("tools/list_changed"));
        assert!(!forwarded.contains("\"id\":7"));
        assert!(reply.contains("\"id\":7"));
    }

    #[test]
    fn relays_a_reply_for_another_request() {
        let input = concat!(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n",
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"done\":true}}\n",
        );
        let mut reader = BufReader::new(Cursor::new(input));
        let mut forwarded = Vec::new();
        let reply = read_reply(&mut reader, &json!(2), &mut forwarded).unwrap();
        assert!(reply.contains("\"id\":2"));
        assert!(String::from_utf8(forwarded).unwrap().contains("\"id\":1"));
    }
}
