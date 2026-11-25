use std::{
    collections::HashMap,
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use tauri::State;
use uuid::Uuid;

use crate::database::Database;

pub(crate) type Result<T> = std::result::Result<T, String>;

pub(crate) fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[derive(Clone, Copy)]
pub(crate) enum GrantKind {
    Markdown,
    Explorer,
    Preview,
}

impl GrantKind {
    fn key(self) -> &'static str {
        match self {
            Self::Markdown => "markdown",
            Self::Explorer => "explorer",
            Self::Preview => "preview",
        }
    }
}

pub struct PathGrants {
    storage: Storage,
    kind: GrantKind,
}

impl PathGrants {
    pub(crate) fn new(storage: &Storage, kind: GrantKind) -> Self {
        Self {
            storage: storage.clone(),
            kind,
        }
    }

    pub(crate) fn grant(&self, path: &Path) -> Result<String> {
        let path = path
            .to_str()
            .ok_or("Le chemin ne peut pas être enregistré.")?;
        let kind = self.kind.key();
        self.storage.db()?.with(|conn| {
            let tx = conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(message)?;
            let existing: Option<String> = tx
                .query_row(
                    "SELECT token FROM path_grants
                     WHERE kind = ?1 AND path = ?2 ORDER BY token LIMIT 1",
                    params![kind, path],
                    |row| row.get(0),
                )
                .optional()
                .map_err(message)?;
            let token = match existing {
                Some(token) => token,
                None => {
                    let token = Uuid::new_v4().to_string();
                    tx.execute(
                        "INSERT INTO path_grants (kind, token, path) VALUES (?1, ?2, ?3)",
                        params![kind, token, path],
                    )
                    .map_err(message)?;
                    token
                }
            };
            tx.commit().map_err(message)?;
            Ok(token)
        })
    }

    pub(crate) fn resolve(&self, token: &str) -> Result<PathBuf> {
        self.storage.db()?.with(|conn| {
            conn.query_row(
                "SELECT path FROM path_grants WHERE kind = ?1 AND token = ?2",
                params![self.kind.key(), token],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(message)?
            .map(PathBuf::from)
            .ok_or_else(|| "Accès au chemin non autorisé.".into())
        })
    }
}

pub(crate) fn import_grants(tx: &Transaction<'_>, home: &Path) -> Result<()> {
    for (kind, file) in [
        (GrantKind::Markdown, "markdown-access.json"),
        (GrantKind::Explorer, "explorer-access.json"),
        (GrantKind::Preview, "preview-access.json"),
    ] {
        let Some(bytes) = read_optional(&home.join(file))? else {
            continue;
        };
        let grants: HashMap<String, String> =
            serde_json::from_slice(&bytes).map_err(|error| format!("{file} : {error}"))?;
        for (token, path) in grants {
            tx.execute(
                "INSERT INTO path_grants (kind, token, path) VALUES (?1, ?2, ?3)",
                params![kind.key(), token, path],
            )
            .map_err(|error| format!("{file} : {error}"))?;
        }
    }
    Ok(())
}

#[derive(Clone)]
pub struct Storage {
    home: PathBuf,
    db: Result<Database>,
}

impl Storage {
    pub fn new(home: PathBuf) -> Self {
        let db = Database::open(&home)
            .map_err(|error| format!("Impossible d’ouvrir le stockage de Spark : {error}"));
        Self { home, db }
    }

    pub(crate) fn path(&self, name: &str) -> PathBuf {
        self.home.join(name)
    }

    pub(crate) fn db(&self) -> Result<&Database> {
        self.db.as_ref().map_err(Clone::clone)
    }

    /// Le mutex SQLite, son busy_timeout et la synchronisation disque ne
    /// doivent jamais être attendus sur le thread de la fenêtre.
    pub(crate) async fn on_worker<T: Send + 'static>(
        &self,
        run: impl FnOnce(Storage) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let storage = self.clone();
        tauri::async_runtime::spawn_blocking(move || run(storage))
            .await
            .map_err(message)?
    }
}

pub(crate) fn read_optional(path: &Path) -> Result<Option<Vec<u8>>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Impossible de lire {} : {error}", path.display())),
    }
}

pub(crate) fn load_snapshot(conn: &Connection, name: &str) -> Result<Option<Vec<u8>>> {
    conn.query_row(
        "SELECT payload FROM snapshots WHERE name = ?1",
        [name],
        |row| row.get(0),
    )
    .optional()
    .map_err(message)
}

pub(crate) fn save_snapshot(conn: &Connection, name: &str, payload: &[u8]) -> Result<()> {
    conn.execute(
        "INSERT INTO snapshots (name, payload) VALUES (?1, ?2)
         ON CONFLICT(name) DO UPDATE SET payload = excluded.payload",
        params![name, payload],
    )
    .map(|_| ())
    .map_err(message)
}

pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path.parent().ok_or(io::ErrorKind::InvalidInput)?;
    let temporary = parent.join(format!(".spark-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        if let Ok(metadata) = fs::metadata(path) {
            file.set_permissions(metadata.permissions())?;
        } else {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                file.set_permissions(fs::Permissions::from_mode(0o600))?;
            }
        }
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[tauri::command]
pub async fn workspace_load(storage: State<'_, Storage>) -> Result<Option<String>> {
    storage.on_worker(|storage| load_workspace(&storage)).await
}

fn load_workspace(storage: &Storage) -> Result<Option<String>> {
    let data = storage
        .db()?
        .with(|conn| load_snapshot(conn, "workspace"))?;
    // Une chaîne vide n’est pas du JSON : le front déclenche la récupération,
    // sans confondre les octets invalides en base avec une erreur de lecture.
    Ok(data.map(|bytes| String::from_utf8(bytes).unwrap_or_default()))
}

#[tauri::command]
pub async fn workspace_save(
    storage: State<'_, Storage>,
    snapshot: String,
    recovery: bool,
) -> Result<()> {
    storage
        .on_worker(move |storage| save_workspace(&storage, &snapshot, recovery))
        .await
}

fn save_workspace(storage: &Storage, snapshot: &str, recovery: bool) -> Result<()> {
    storage.db()?.with(|conn| {
        let tx = conn.transaction().map_err(message)?;
        if recovery {
            tx.execute(
                "INSERT OR IGNORE INTO snapshots (name, payload)
                 SELECT 'workspace_recovery', payload FROM snapshots WHERE name = 'workspace'",
                [],
            )
            .map_err(message)?;
        }
        save_snapshot(&tx, "workspace", snapshot.as_bytes())?;
        tx.commit().map_err(message)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_write_waits_for_a_second_writer_on_a_blocking_worker() {
        let home = std::env::temp_dir().join(format!("spark-worker-{}", Uuid::new_v4()));
        let storage = Storage::new(home.clone());
        let competitor = Connection::open(home.join("spark.db")).unwrap();
        competitor.execute_batch("BEGIN IMMEDIATE").unwrap();
        let (notify, started) = std::sync::mpsc::channel();
        let writer = tauri::async_runtime::spawn(async move {
            let dispatcher = std::thread::current().id();
            storage
                .on_worker(move |storage| {
                    notify
                        .send(std::thread::current().id() != dispatcher)
                        .unwrap();
                    save_workspace(&storage, "snapshot", false)
                })
                .await
        });
        assert!(started
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap());
        let before: i64 = competitor
            .query_row("SELECT COUNT(*) FROM snapshots", [], |row| row.get(0))
            .unwrap();
        assert_eq!(before, 0);
        competitor.execute_batch("ROLLBACK").unwrap();
        tauri::async_runtime::block_on(writer).unwrap().unwrap();
        assert_eq!(
            load_snapshot(&competitor, "workspace").unwrap(),
            Some(b"snapshot".to_vec())
        );
        drop(competitor);
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn recovery_preserves_original_bytes_once_and_saves_atomically() {
        let db = Database::in_memory();
        let storage = Storage {
            home: PathBuf::new(),
            db: Ok(db.clone()),
        };
        let malformed = b"\xffworkspace";
        db.with(|conn| {
            save_snapshot(conn, "workspace", malformed)?;
            conn.execute_batch(
                "CREATE TRIGGER fail_workspace BEFORE UPDATE ON snapshots
                 WHEN NEW.name = 'workspace'
                 BEGIN SELECT RAISE(ABORT, 'snapshot rejected'); END;",
            )
            .map_err(message)
        })
        .unwrap();
        assert_eq!(load_workspace(&storage).unwrap().as_deref(), Some(""));
        assert!(save_workspace(&storage, "first", true).is_err());
        db.with(|conn| {
            assert!(load_snapshot(conn, "workspace_recovery")?.is_none());
            assert_eq!(
                load_snapshot(conn, "workspace")?.as_deref(),
                Some(malformed.as_slice())
            );
            conn.execute_batch("DROP TRIGGER fail_workspace")
                .map_err(message)
        })
        .unwrap();

        save_workspace(&storage, "first", true).unwrap();
        save_workspace(&storage, "second", true).unwrap();
        assert_eq!(load_workspace(&storage).unwrap().as_deref(), Some("second"));
        db.with(|conn| {
            assert_eq!(
                load_snapshot(conn, "workspace_recovery")?.as_deref(),
                Some(malformed.as_slice())
            );
            Ok(())
        })
        .unwrap();
    }
}
