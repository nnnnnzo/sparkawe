use std::{
    collections::HashMap,
    io::{self, BufRead, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub mod socket;

/// Pont livré à côté de l'exécutable : Tauri y copie l'`externalBin` déclaré
/// dans `tauri.conf.json`, en développement comme dans le bundle.
pub fn sidecar_path(exe: &std::path::Path) -> std::path::PathBuf {
    let name = if cfg!(windows) {
        "spark-mcp.exe"
    } else {
        "spark-mcp"
    };
    exe.parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join(name)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Delivery {
    connection: u64,
    line: String,
}

#[derive(Clone, Serialize)]
struct Closed {
    connection: u64,
}

#[cfg(unix)]
struct Inner {
    clients: Mutex<HashMap<u64, std::os::unix::net::UnixStream>>,
    next: AtomicU64,
    path: PathBuf,
}

/// Transport MCP : le serveur ne comprend pas JSON-RPC, il relaie les lignes
/// entre le socket local et la fenêtre, qui détient l'état et les outils.
#[cfg(unix)]
pub struct McpServer {
    inner: Arc<Inner>,
}

#[cfg(not(unix))]
pub struct McpServer;

#[cfg(unix)]
impl McpServer {
    pub fn start(app: AppHandle) -> io::Result<Self> {
        let path = socket::path().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::Unsupported,
                "Socket MCP indisponible sur cette plateforme.",
            )
        })?;
        let run = path.parent().ok_or(io::ErrorKind::InvalidInput)?;
        prepare_run_directory(run)?;
        let _ = std::fs::remove_file(&path);
        let listener = std::os::unix::net::UnixListener::bind(&path)?;
        set_mode(&path, 0o600)?;

        let inner = Arc::new(Inner {
            clients: Mutex::new(HashMap::new()),
            next: AtomicU64::new(1),
            path,
        });
        let server = Self {
            inner: inner.clone(),
        };

        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { continue };
                let Ok(writer) = stream.try_clone() else {
                    continue;
                };
                let id = inner.next.fetch_add(1, Ordering::Relaxed);
                if let Ok(mut clients) = inner.clients.lock() {
                    clients.insert(id, writer);
                }
                let app = app.clone();
                let inner = inner.clone();
                std::thread::spawn(move || {
                    let reader = io::BufReader::new(stream);
                    for line in reader.lines() {
                        let Ok(line) = line else { break };
                        if line.trim().is_empty() {
                            continue;
                        }
                        let _ = app.emit(
                            "mcp:message",
                            Delivery {
                                connection: id,
                                line,
                            },
                        );
                    }
                    let _ = app.emit("mcp:closed", Closed { connection: id });
                    if let Ok(mut clients) = inner.clients.lock() {
                        clients.remove(&id);
                    }
                });
            }
        });

        Ok(server)
    }

    pub fn reply(&self, connection: u64, line: &str) -> io::Result<()> {
        let mut clients = self
            .inner
            .clients
            .lock()
            .map_err(|_| io::Error::other("Verrou MCP indisponible."))?;
        let writer = clients
            .get_mut(&connection)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Connexion MCP inconnue."))?;
        writer.write_all(line.as_bytes())?;
        writer.write_all(b"\n")?;
        writer.flush()
    }

    /// Envoie une notification à tous les clients connectés. Les connexions
    /// fermées sont retirées au passage.
    pub fn broadcast(&self, line: &str) -> io::Result<()> {
        let mut clients = self
            .inner
            .clients
            .lock()
            .map_err(|_| io::Error::other("Verrou MCP indisponible."))?;
        let mut closed = Vec::new();
        for (id, writer) in clients.iter_mut() {
            let sent = writer
                .write_all(line.as_bytes())
                .and_then(|()| writer.write_all(b"\n"))
                .and_then(|()| writer.flush());
            if sent.is_err() {
                closed.push(*id);
            }
        }
        for id in closed {
            clients.remove(&id);
        }
        Ok(())
    }

    pub fn shutdown(&self) {
        let _ = std::fs::remove_file(&self.inner.path);
    }
}

#[cfg(not(unix))]
impl McpServer {
    pub fn start(_app: AppHandle) -> io::Result<Self> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Le pont MCP cible macOS et Linux.",
        ))
    }

    pub fn reply(&self, _connection: u64, _line: &str) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "MCP indisponible.",
        ))
    }

    pub fn broadcast(&self, _line: &str) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "MCP indisponible.",
        ))
    }

    pub fn shutdown(&self) {}
}

#[cfg(unix)]
fn prepare_run_directory(run: &std::path::Path) -> io::Result<()> {
    std::fs::create_dir_all(run)?;
    set_mode(run, 0o700)
}

#[cfg(unix)]
fn set_mode(path: &std::path::Path, mode: u32) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn sidecar_lives_next_to_the_executable() {
        let exe = std::path::Path::new("/Applications/Spark.app/Contents/MacOS/Spark");
        assert_eq!(
            sidecar_path(exe),
            std::path::PathBuf::from("/Applications/Spark.app/Contents/MacOS/spark-mcp")
        );
    }

    #[test]
    fn broadcast_reaches_every_client() {
        let (first, mut first_peer) = std::os::unix::net::UnixStream::pair().unwrap();
        let (second, mut second_peer) = std::os::unix::net::UnixStream::pair().unwrap();
        let server = McpServer {
            inner: Arc::new(Inner {
                clients: Mutex::new(HashMap::from([(1, first), (2, second)])),
                next: AtomicU64::new(3),
                path: PathBuf::from("/tmp/spark-test.sock"),
            }),
        };
        server
            .broadcast("notifications/tools/list_changed")
            .unwrap();
        let expected = b"notifications/tools/list_changed\n";
        let mut buffer = vec![0_u8; expected.len()];
        first_peer.read_exact(&mut buffer).unwrap();
        assert_eq!(buffer, expected);
        second_peer.read_exact(&mut buffer).unwrap();
        assert_eq!(buffer, expected);
    }
}
