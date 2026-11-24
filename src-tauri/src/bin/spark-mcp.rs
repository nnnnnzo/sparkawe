//! Pont MCP : relaie les messages stdio d'un client (Claude Code, Cursor…) vers
//! le socket local de l'application Spark.
//!
//! Le pont ne comprend pas le protocole JSON-RPC, mais il garde **une seule
//! connexion par processus client**. C'est ce qui permet à Spark de conserver
//! l'identité envoyée dans `initialize` pour les appels suivants. Si Spark
//! redémarre, le pont se reconnecte et rejoue la dernière initialisation pour
//! que la session garde son nom et sa marque.

use std::io::{self, BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::time::Duration;

use serde_json::{json, Value};
use spark_lib::mcp::socket;

struct Bridge {
    reader: BufReader<UnixStream>,
    writer: UnixStream,
}

impl Bridge {
    /// Connexion courte : 2 s au total, uniquement si l'application démarre.
    fn connect() -> Option<Self> {
        let path = socket::path()?;
        let delays = [40_u64, 80, 160, 320, 640, 760];
        for (index, delay) in delays.iter().enumerate() {
            match UnixStream::connect(&path) {
                Ok(stream) => {
                    let writer = stream.try_clone().ok()?;
                    return Some(Self {
                        reader: BufReader::new(stream),
                        writer,
                    });
                }
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

    /// Écrit une ligne et, pour une requête, attend sa réponse.
    fn handle(&mut self, line: &str, out: &mut impl Write) -> io::Result<Option<String>> {
        self.writer.write_all(line.as_bytes())?;
        self.writer.write_all(b"\n")?;
        self.writer.flush()?;
        let value: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(_) => return Ok(None),
        };
        let Some(id) = value.get("id") else {
            return Ok(None);
        };
        read_reply(&mut self.reader, id, out).map(Some)
    }

    /// Rejoue la dernière `initialize` après une reconnexion, sans réponse.
    fn replay_initialize(&mut self, line: &str) -> io::Result<()> {
        self.writer.write_all(line.as_bytes())?;
        self.writer.write_all(b"\n")?;
        self.writer.flush()?;
        let value: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(_) => return Ok(()),
        };
        let Some(id) = value.get("id") else {
            return Ok(());
        };
        let mut discarded = io::sink();
        read_reply(&mut self.reader, id, &mut discarded).map(|_| ())
    }
}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let mut bridge = Bridge::connect();
    let mut initialized: Option<String> = None;

    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let is_initialize = serde_json::from_str::<Value>(&line)
            .ok()
            .and_then(|value| {
                value
                    .get("method")
                    .and_then(Value::as_str)
                    .map(String::from)
            })
            .is_some_and(|method| method == "initialize");

        if bridge.is_none() {
            bridge = Bridge::connect();
            if let (Some(active), Some(previous)) = (bridge.as_mut(), initialized.as_deref()) {
                if !is_initialize {
                    let _ = active.replay_initialize(previous);
                }
            }
        }

        let Some(active) = bridge.as_mut() else {
            if let Some(reply) = offline_for(&line) {
                if write_line(&mut stdout, &reply).is_err() {
                    break;
                }
            }
            continue;
        };

        match active.handle(&line, &mut stdout) {
            Ok(Some(reply)) => {
                if write_line(&mut stdout, &reply).is_err() {
                    break;
                }
            }
            Ok(None) => {}
            Err(_) => {
                // Ne jamais rejouer une requête qui a peut-être déjà été
                // exécutée : le client décide de réessayer. La prochaine ligne
                // rouvrira la connexion et rejouera l'initialisation.
                bridge = None;
                if let Some(reply) = transport_error(&line) {
                    if write_line(&mut stdout, &reply).is_err() {
                        break;
                    }
                }
            }
        }

        if is_initialize {
            initialized = Some(line);
        }
    }
}

fn write_line(out: &mut impl Write, line: &str) -> io::Result<()> {
    out.write_all(line.as_bytes())?;
    out.write_all(b"\n")?;
    out.flush()
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

fn transport_error(line: &str) -> Option<String> {
    let message: Value = serde_json::from_str(line).ok()?;
    let id = message.get("id")?.clone();
    Some(
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": -32000,
                "message": "Spark a fermé la connexion MCP."
            }
        })
        .to_string(),
    )
}

fn offline_for(line: &str) -> Option<String> {
    let message: Value = serde_json::from_str(line).ok()?;
    let id = message.get("id")?.clone();
    let method = message
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    Some(offline(&id, method, &message))
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

    #[test]
    fn offline_reply_only_for_a_request_id() {
        assert!(
            offline_for("{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}").is_none()
        );
        assert!(offline_for("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}").is_some());
    }
}
