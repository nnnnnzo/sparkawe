//! Ouverture du stockage local et reprise des anciens formats.

use std::{
    fs::{self, File, OpenOptions},
    io,
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};

use rusqlite::{
    backup::{Backup, StepResult},
    config::DbConfig,
    params, Connection, OpenFlags, Transaction, TransactionBehavior,
};

use crate::storage::{atomic_write, message, read_optional, Result};

const SCHEMA_VERSION: i32 = 2;
const DATABASE: &str = "spark.db";
const STAGING: &str = ".spark-db-migration";
const MARKER: &str = ".spark-db-initialized";
const LEGACY: &str = "activity.db";
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone)]
pub(crate) struct Database(Arc<Inner>);

struct Inner {
    conn: Mutex<Connection>,
    // Empêche une seconde instance Spark de migrer ou de modifier les mêmes paquets.
    _profile_lock: Option<File>,
}

impl Database {
    pub(crate) fn open(home: &Path) -> Result<Self> {
        fs::create_dir_all(home).map_err(message)?;
        let lock = private_file(&home.join(".spark-storage.lock"), false).map_err(message)?;
        lock.try_lock().map_err(|error| {
            format!("Impossible de verrouiller le profil Spark (une autre instance est peut-être ouverte) : {error}")
        })?;

        let target = home.join(DATABASE);
        let marker = home.join(MARKER);
        if !target.try_exists().map_err(message)? {
            if marker.try_exists().map_err(message)? || has_sidecars(home, DATABASE)? {
                return Err(format!(
                    "{DATABASE} est introuvable. Les sauvegardes n’ont pas été réimportées."
                ));
            }
            crate::migrate_legacy_config(home).map_err(message)?;
            migrate(home, &target)?;
        }
        let conn = Connection::open_with_flags(&target, OpenFlags::SQLITE_OPEN_READ_WRITE)
            .map_err(message)?;
        conn.busy_timeout(BUSY_TIMEOUT).map_err(message)?;
        check_schema(&conn)?;
        if !marker.try_exists().map_err(message)? {
            atomic_write(&marker, b"spark.db\n").map_err(message)?;
            sync_directory(home)?;
        }
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = FULL;
             PRAGMA secure_delete = ON;",
        )
        .map_err(message)?;
        retire_activity(home, &conn)?;
        if let Err(error) = crate::extensions::cleanup_packages(home, &conn) {
            eprintln!("Nettoyage des anciens paquets Spark impossible : {error}");
        }
        Ok(Self(Arc::new(Inner {
            conn: Mutex::new(conn),
            _profile_lock: Some(lock),
        })))
    }

    pub(crate) fn with<T>(&self, run: impl FnOnce(&mut Connection) -> Result<T>) -> Result<T> {
        let mut conn = self.0.conn.lock().map_err(message)?;
        run(&mut conn)
    }

    #[cfg(test)]
    pub(crate) fn in_memory() -> Self {
        let mut conn = Connection::open_in_memory().unwrap();
        let tx = conn.transaction().unwrap();
        crate::activity::create_schema(&tx).unwrap();
        create_schema(&tx).unwrap();
        tx.commit().unwrap();
        Self(Arc::new(Inner {
            conn: Mutex::new(conn),
            _profile_lock: None,
        }))
    }
}

fn private_file(path: &Path, new: bool) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true);
    if new {
        options.create_new(true);
    } else {
        options.create(true);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

fn sync_directory(home: &Path) -> Result<()> {
    #[cfg(unix)]
    File::open(home)
        .and_then(|dir| dir.sync_all())
        .map_err(message)?;
    #[cfg(not(unix))]
    let _ = home;
    Ok(())
}

fn remove_if_present(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Impossible de retirer {} : {error}",
            path.display()
        )),
    }
}

fn clear_staging(home: &Path) -> Result<()> {
    for suffix in ["-journal", "-wal", "-shm", ""] {
        remove_if_present(&home.join(format!("{STAGING}{suffix}")))?;
    }
    Ok(())
}

fn has_sidecars(home: &Path, filename: &str) -> Result<bool> {
    for suffix in ["-wal", "-shm", "-journal"] {
        if home
            .join(format!("{filename}{suffix}"))
            .try_exists()
            .map_err(message)?
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn schema_version(conn: &Connection) -> Result<i32> {
    conn.pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(message)
}

fn check_schema(conn: &Connection) -> Result<()> {
    let version = schema_version(conn)?;
    if version != SCHEMA_VERSION {
        return Err(format!(
            "Schéma de {DATABASE} non pris en charge : {version} (attendu : {SCHEMA_VERSION})."
        ));
    }
    // Une base qui annonce v2 mais ne contient pas le schéma attendu ne doit pas
    // apparaître à l’interface comme un profil neuf.
    for sql in [
        "SELECT name, payload FROM snapshots LIMIT 0",
        "SELECT id, version, path, source FROM installed_packages LIMIT 0",
        "SELECT url, name, position FROM registry_sources LIMIT 0",
        "SELECT kind, token, path FROM path_grants LIMIT 0",
        "SELECT id, tab_id, at, kind, agent_id, agent_name, size, payload, reverted_at FROM agent_activity LIMIT 0",
        "SELECT tab_id, at FROM agent_activity_seen LIMIT 0",
        "SELECT id, retire_activity FROM storage_migration LIMIT 0",
    ] {
        conn.prepare(sql).map_err(message)?;
    }
    Ok(())
}

fn create_schema(tx: &Transaction<'_>) -> Result<()> {
    tx.execute_batch(
        "CREATE TABLE snapshots (
           name    TEXT PRIMARY KEY NOT NULL CHECK (name IN ('workspace', 'workspace_recovery', 'settings')),
           payload BLOB NOT NULL
         );
         CREATE TABLE installed_packages (
           id      TEXT PRIMARY KEY NOT NULL,
           version TEXT NOT NULL,
           path    TEXT NOT NULL,
           source  TEXT
         );
         CREATE TABLE registry_sources (
           url      TEXT PRIMARY KEY NOT NULL,
           name     TEXT NOT NULL,
           position INTEGER UNIQUE NOT NULL
         );
         CREATE TABLE path_grants (
           kind  TEXT NOT NULL CHECK (kind IN ('markdown', 'explorer', 'preview')),
           token TEXT NOT NULL,
           path  TEXT NOT NULL,
           PRIMARY KEY (kind, token)
         );
         CREATE INDEX path_grants_path ON path_grants(kind, path);
         CREATE TABLE storage_migration (
           id INTEGER PRIMARY KEY CHECK (id = 1),
           retire_activity INTEGER NOT NULL CHECK (retire_activity IN (0, 1))
         );",
    )
    .map_err(message)
}

fn migrate(home: &Path, target: &Path) -> Result<()> {
    clear_staging(home)?;
    let legacy = open_legacy_activity(home)?;
    if legacy.is_none() && has_sidecars(home, LEGACY)? {
        return Err(format!(
            "{LEGACY} est introuvable mais son journal est encore présent."
        ));
    }

    let stage = home.join(STAGING);
    private_file(&stage, true).map_err(message)?;
    let result = build_staged_database(home, &stage, legacy.as_ref()).and_then(|()| {
        OpenOptions::new()
            .write(true)
            .open(&stage)
            .and_then(|file| file.sync_all())
            .map_err(message)?;
        // Même dossier, verrou de profil détenu et nom définitif encore absent.
        fs::rename(&stage, target).map_err(message)?;
        sync_directory(home)
    });
    if result.is_err() {
        let _ = clear_staging(home);
    }
    result
}

fn open_legacy_activity(home: &Path) -> Result<Option<Connection>> {
    let path = home.join(LEGACY);
    if !path.try_exists().map_err(message)? {
        return Ok(None);
    }
    let conn =
        Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE).map_err(message)?;
    conn.busy_timeout(BUSY_TIMEOUT).map_err(message)?;
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE, true)
        .map_err(message)?;
    // L’ancien binaire n’honore pas le verrou de profil. SQLite doit prendre
    // son verrou exclusif avant de lire le journal WAL, sans le réécrire.
    conn.pragma_update(None, "locking_mode", "EXCLUSIVE")
        .map_err(message)?;
    let version = schema_version(&conn).map_err(|error| {
        format!("Impossible de lire {LEGACY} : {error}. Fermez toute ancienne instance de Spark.")
    })?;
    if !matches!(version, 0 | 1) {
        return Err(format!(
            "Schéma de {LEGACY} non pris en charge : {version}."
        ));
    }
    Ok(Some(conn))
}

fn build_staged_database(home: &Path, stage: &Path, legacy: Option<&Connection>) -> Result<()> {
    let mut conn =
        Connection::open_with_flags(stage, OpenFlags::SQLITE_OPEN_READ_WRITE).map_err(message)?;
    if let Some(source) = legacy {
        let backup = Backup::new(source, &mut conn).map_err(message)?;
        if backup.step(-1).map_err(message)? != StepResult::Done {
            return Err(format!("{LEGACY} est occupée."));
        }
    }
    // Publier un seul fichier : pas de WAL côté destination avant la bascule.
    let journal: String = conn
        .query_row("PRAGMA journal_mode = DELETE", [], |row| row.get(0))
        .map_err(message)?;
    if journal != "delete" {
        return Err("Impossible de préparer une copie SQLite autonome.".into());
    }
    conn.execute_batch("PRAGMA synchronous = FULL;")
        .map_err(message)?;

    let version = schema_version(&conn)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(message)?;
    if version == 0 {
        let empty: bool = tx
            .query_row(
                "SELECT NOT EXISTS (SELECT 1 FROM sqlite_schema)",
                [],
                |row| row.get(0),
            )
            .map_err(message)?;
        if !empty {
            return Err(format!("{LEGACY} contient un schéma non reconnu."));
        }
        crate::activity::create_schema(&tx)?;
    }
    create_schema(&tx)?;
    for (name, file) in [
        ("workspace", "workspace-v1.json"),
        ("workspace_recovery", "workspace-recovery.json"),
        ("settings", "settings-v1.json"),
    ] {
        if let Some(bytes) = read_optional(&home.join(file))? {
            tx.execute(
                "INSERT INTO snapshots (name, payload) VALUES (?1, ?2)",
                params![name, bytes],
            )
            .map_err(message)?;
        }
    }
    crate::extensions::import_legacy(&tx, home)?;
    crate::storage::import_grants(&tx, home)?;
    tx.execute(
        "INSERT INTO storage_migration (id, retire_activity) VALUES (1, ?1)",
        [legacy.is_some()],
    )
    .map_err(message)?;
    tx.pragma_update(None, "user_version", SCHEMA_VERSION)
        .map_err(message)?;
    check_schema(&tx)?;
    let integrity: String = tx
        .query_row("PRAGMA quick_check(1)", [], |row| row.get(0))
        .map_err(message)?;
    if integrity != "ok" {
        return Err(format!("Copie SQLite invalide : {integrity}"));
    }
    tx.commit().map_err(message)?;
    conn.close().map_err(|(_, error)| message(error))
}

fn retire_activity(home: &Path, conn: &Connection) -> Result<()> {
    let pending: bool = conn
        .query_row(
            "SELECT retire_activity FROM storage_migration WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .map_err(message)?;
    if pending {
        let legacy = open_legacy_activity(home)?;
        if let Some(legacy) = &legacy {
            // Une ancienne version peut avoir repris les écritures après la
            // publication de spark.db. Comparer sous verrou avant tout retrait.
            legacy.execute_batch("BEGIN EXCLUSIVE").map_err(message)?;
            if !activity_matches(legacy, conn)? {
                return Err(format!(
                    "{LEGACY} a changé après la migration. Les deux bases ont été conservées ; aucune fusion n’a été effectuée."
                ));
            }
            legacy.execute_batch("COMMIT").map_err(message)?;
        }
        #[cfg(unix)]
        {
            if let Some(legacy) = &legacy {
                // Mettre les lignes validées dans le fichier principal. Une
                // interruption après le retrait du WAL laisse ainsi une base
                // encore comparable et récupérable. Garder le handle exclusif
                // jusqu’au retrait du fichier principal.
                let busy: i64 = legacy
                    .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| row.get(0))
                    .map_err(message)?;
                if busy != 0 {
                    return Err(format!("Impossible de finaliser le journal de {LEGACY}."));
                }
            }
            for suffix in ["-wal", "-shm", "-journal", ""] {
                remove_if_present(&home.join(format!("{LEGACY}{suffix}")))?;
            }
            sync_directory(home)?;
        }
        // Windows ne permet pas de retirer un fichier SQLite verrouillé.
        // Conserver la sauvegarde plutôt que de relâcher le verrou et risquer
        // une écriture entre la comparaison et la suppression.
        conn.execute(
            "UPDATE storage_migration SET retire_activity = 0 WHERE id = 1",
            [],
        )
        .map_err(message)?;
    }
    Ok(())
}

fn activity_matches(legacy: &Connection, conn: &Connection) -> Result<bool> {
    if schema_version(legacy)? == 0 {
        // Une base préexistante vide est autorisée par la migration.
        let empty: bool = legacy
            .query_row(
                "SELECT NOT EXISTS (SELECT 1 FROM sqlite_schema)",
                [],
                |row| row.get(0),
            )
            .map_err(message)?;
        return if empty {
            conn.query_row(
                "SELECT NOT EXISTS (SELECT 1 FROM agent_activity)
                    AND NOT EXISTS (SELECT 1 FROM agent_activity_seen)",
                [],
                |row| row.get(0),
            )
            .map_err(message)
        } else {
            Ok(false)
        };
    }
    for sql in [
        // rowid départage les étapes au même horodatage.
        "SELECT rowid, id, tab_id, at, kind, agent_id, agent_name, size, payload, reverted_at
           FROM agent_activity ORDER BY rowid",
        "SELECT tab_id, at FROM agent_activity_seen ORDER BY tab_id",
    ] {
        let mut old = legacy.prepare(sql).map_err(message)?;
        let mut new = conn.prepare(sql).map_err(message)?;
        let columns = old.column_count();
        let mut old_rows = old.query([]).map_err(message)?;
        let mut new_rows = new.query([]).map_err(message)?;
        loop {
            match (
                old_rows.next().map_err(message)?,
                new_rows.next().map_err(message)?,
            ) {
                (Some(old), Some(new)) => {
                    for index in 0..columns {
                        if old.get_ref(index).map_err(message)?
                            != new.get_ref(index).map_err(message)?
                        {
                            return Ok(false);
                        }
                    }
                }
                (None, None) => break,
                _ => return Ok(false),
            }
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    use uuid::Uuid;

    use crate::storage::{load_snapshot, save_snapshot, GrantKind, PathGrants, Storage};

    struct Profile(PathBuf);

    impl Profile {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("spark-db-{}", Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }

        fn write(&self, name: &str, bytes: impl AsRef<[u8]>) {
            fs::write(self.0.join(name), bytes).unwrap();
        }
    }

    impl Drop for Profile {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn write_legacy_wal(home: &Path) {
        let conn = Connection::open(home.join(LEGACY)).unwrap();
        crate::activity::create_schema(&conn).unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA wal_autocheckpoint = 0;",
        )
        .unwrap();
        conn.set_db_config(DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE, true)
            .unwrap();
        conn.execute_batch(
            "INSERT INTO agent_activity (id, tab_id, at, kind, size, payload, reverted_at)
               VALUES ('first', 'tab', 10, 'action', 4, 'null', NULL),
                      ('second', 'tab', 10, 'action', 4, 'null', NULL),
                      ('reverted', 'tab', 11, 'action', 4, 'null', 12);
             INSERT INTO agent_activity_seen (tab_id, at) VALUES ('tab', 10);",
        )
        .unwrap();
        conn.close().unwrap();
        assert!(fs::metadata(home.join("activity.db-wal")).unwrap().len() > 32);
    }

    #[test]
    fn fresh_profile_has_an_empty_schema_and_only_one_writer_instance() {
        let profile = Profile::new();
        let db = Database::open(&profile.0).unwrap();
        db.with(|conn| {
            assert_eq!(schema_version(conn)?, SCHEMA_VERSION);
            assert!(load_snapshot(conn, "workspace")?.is_none());
            Ok(())
        })
        .unwrap();
        assert!(Database::open(&profile.0).is_err());
        drop(db);
        assert!(Database::open(&profile.0).is_ok());
        assert!(!profile.0.join(LEGACY).exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(profile.0.join(DATABASE))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600,
            );
        }
    }

    #[test]
    fn imports_all_domains_and_committed_wal_frames_only_once() {
        let profile = Profile::new();
        write_legacy_wal(&profile.0);
        // Sans le WAL, les lignes validées n’existent pas dans le fichier principal.
        let copy = profile.0.join("main-only");
        fs::copy(profile.0.join(LEGACY), &copy).unwrap();
        let main_only = Connection::open(&copy).unwrap();
        let count: i64 = main_only
            .query_row("SELECT COUNT(*) FROM agent_activity", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
        drop(main_only);

        let workspace = br#"{
            "version":1,"active":"tab","pinned":null,"theme":"dark",
            "tabs":[{"id":"tab","name":"Workspace","mode":"tiling","layouts":{},
                "tiles":[{"id":"tile","type":"markdown.editor","data":{"token":"document"}}]}]
        }"#;
        let settings = br#"{"dev":true,"locale":"fr"}"#;
        let updated_settings = br#"{"dev":false,"locale":"en"}"#;
        profile.write("workspace-v1.json", workspace);
        profile.write("workspace-recovery.json", b"\xffrecovery");
        profile.write("settings-v1.json", settings);
        profile.write(
            "extensions.json",
            br#"{
                "version": 1,
                "extensions": {"demo.a":{"version":"1.2.3","path":"extensions/demo.a/1.2.3","source":"https://b.example"}},
                "sources": [{"url":"https://b.example","name":"B"},{"url":"https://a.example","name":"A"}]
            }"#,
        );
        profile.write("markdown-access.json", br#"{"document":"/note.md"}"#);
        profile.write("explorer-access.json", br#"{"document":"/project"}"#);
        profile.write("preview-access.json", br#"{"image":"/image.png"}"#);

        {
            let storage = Storage::new(profile.0.clone());
            storage
                .db()
                .unwrap()
                .with(|conn| {
                    for (key, payload) in [
                        ("workspace", workspace.as_slice()),
                        ("workspace_recovery", b"\xffrecovery".as_slice()),
                        ("settings", settings.as_slice()),
                    ] {
                        assert_eq!(load_snapshot(conn, key)?.as_deref(), Some(payload));
                    }
                    let steps: String = conn
                        .query_row(
                            "SELECT group_concat(id, ',') FROM
                           (SELECT id FROM agent_activity
                            WHERE reverted_at IS NULL ORDER BY at DESC, rowid DESC)",
                            [],
                            |row| row.get(0),
                        )
                        .unwrap();
                    assert_eq!(steps, "second,first");
                    let reverted: i64 = conn
                        .query_row(
                            "SELECT reverted_at FROM agent_activity WHERE id = 'reverted'",
                            [],
                            |row| row.get(0),
                        )
                        .unwrap();
                    assert_eq!(reverted, 12);
                    let seen: i64 = conn
                        .query_row(
                            "SELECT at FROM agent_activity_seen WHERE tab_id = 'tab'",
                            [],
                            |row| row.get(0),
                        )
                        .unwrap();
                    assert_eq!(seen, 10);
                    let package: (String, String, String) = conn
                        .query_row(
                            "SELECT version, path, source FROM installed_packages WHERE id = 'demo.a'",
                            [],
                            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                        )
                        .unwrap();
                    assert_eq!(
                        package,
                        (
                            "1.2.3".into(),
                            "extensions/demo.a/1.2.3".into(),
                            "https://b.example".into(),
                        ),
                    );
                    let first: String = conn
                        .query_row(
                            "SELECT name FROM registry_sources ORDER BY position LIMIT 1",
                            [],
                            |row| row.get(0),
                        )
                        .unwrap();
                    assert_eq!(first, "B");
                    save_snapshot(conn, "settings", updated_settings)
                })
                .unwrap();

            let markdown = PathGrants::new(&storage, GrantKind::Markdown);
            let explorer = PathGrants::new(&storage, GrantKind::Explorer);
            let preview = PathGrants::new(&storage, GrantKind::Preview);
            assert_eq!(
                markdown.resolve("document").unwrap(),
                PathBuf::from("/note.md")
            );
            assert_eq!(
                explorer.resolve("document").unwrap(),
                PathBuf::from("/project")
            );
            assert_eq!(
                preview.resolve("image").unwrap(),
                PathBuf::from("/image.png")
            );
            assert!(preview.resolve("document").is_err());
            assert!(markdown.resolve("image").is_err());
            assert_eq!(markdown.grant(Path::new("/note.md")).unwrap(), "document");
        }
        #[cfg(unix)]
        for name in [LEGACY, "activity.db-wal", "activity.db-shm"] {
            assert!(!profile.0.join(name).exists(), "{name}");
        }
        #[cfg(not(unix))]
        assert!(profile.0.join(LEGACY).is_file());
        assert!(!profile.0.join(STAGING).exists());
        assert_eq!(
            fs::read(profile.0.join("workspace-v1.json")).unwrap(),
            workspace
        );
        profile.write("extensions.json", "désormais ignoré");
        let db = Database::open(&profile.0).unwrap();
        db.with(|conn| {
            assert_eq!(
                load_snapshot(conn, "settings")?.as_deref(),
                Some(updated_settings.as_slice()),
            );
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn a_failed_import_never_retires_the_sources_and_can_be_retried() {
        let profile = Profile::new();
        write_legacy_wal(&profile.0);
        profile.write("preview-access.json", b"{");
        profile.write(STAGING, "copie interrompue");
        let error = Database::open(&profile.0).err().unwrap();
        assert!(error.contains("preview-access.json"), "{error}");
        assert!(!profile.0.join(DATABASE).exists());
        assert!(!profile.0.join(STAGING).exists());
        assert!(profile.0.join(LEGACY).is_file());
        assert!(profile.0.join("activity.db-wal").is_file());
        assert_eq!(
            fs::read(profile.0.join("preview-access.json")).unwrap(),
            b"{"
        );
        profile.write("preview-access.json", b"{}");
        assert!(Database::open(&profile.0).is_ok());
    }

    #[test]
    fn waits_for_an_open_legacy_connection_instead_of_retiring_it() {
        let profile = Profile::new();
        write_legacy_wal(&profile.0);
        let legacy = Connection::open(profile.0.join(LEGACY)).unwrap();
        assert_eq!(schema_version(&legacy).unwrap(), 1);
        let error = Database::open(&profile.0).err().unwrap();
        assert!(error.contains("Fermez"), "{error}");
        assert!(!profile.0.join(DATABASE).exists());
        assert!(profile.0.join(LEGACY).is_file());
        legacy.close().unwrap();
        assert!(Database::open(&profile.0).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn published_copy_resumes_interrupted_activity_cleanup() {
        let profile = Profile::new();
        write_legacy_wal(&profile.0);
        migrate(&profile.0, &profile.0.join(DATABASE)).unwrap();
        // Coupure après publication et suppression du fichier principal,
        // mais avant le retrait des journaux.
        fs::remove_file(profile.0.join(LEGACY)).unwrap();
        assert!(profile.0.join("activity.db-wal").is_file());
        profile.write("extensions.json", b"no reimport");
        let db = Database::open(&profile.0).unwrap();
        assert!(!profile.0.join("activity.db-wal").exists());
        assert!(!profile.0.join("activity.db-shm").exists());
        db.with(|conn| {
            let count: i64 = conn
                .query_row("SELECT COUNT(*) FROM agent_activity", [], |row| row.get(0))
                .map_err(message)?;
            assert_eq!(count, 3);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn resumed_migration_keeps_legacy_commits_made_after_publication() {
        let profile = Profile::new();
        write_legacy_wal(&profile.0);
        migrate(&profile.0, &profile.0.join(DATABASE)).unwrap();

        let legacy = Connection::open(profile.0.join(LEGACY)).unwrap();
        legacy
            .set_db_config(DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE, true)
            .unwrap();
        legacy
            .execute(
                "INSERT INTO agent_activity (id, tab_id, at, kind, size, payload)
                   VALUES ('after', 'tab', 99, 'action', 4, 'null')",
                [],
            )
            .unwrap();
        legacy.close().unwrap();

        let error = Database::open(&profile.0).err().unwrap();
        assert!(
            error.contains("Les deux bases ont été conservées"),
            "{error}"
        );
        assert!(profile.0.join("activity.db-wal").is_file());
        for (file, expected) in [(LEGACY, true), (DATABASE, false)] {
            let conn = Connection::open(profile.0.join(file)).unwrap();
            let after: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM agent_activity WHERE id = 'after')",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(after, expected, "{file}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn resumes_cleanup_after_the_checkpoint_and_wal_removal() {
        let profile = Profile::new();
        write_legacy_wal(&profile.0);
        migrate(&profile.0, &profile.0.join(DATABASE)).unwrap();
        let legacy = open_legacy_activity(&profile.0).unwrap().unwrap();
        let busy: i64 = legacy
            .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| row.get(0))
            .unwrap();
        assert_eq!(busy, 0);
        fs::remove_file(profile.0.join("activity.db-wal")).unwrap();
        drop(legacy);
        let db = Database::open(&profile.0).unwrap();
        assert!(!profile.0.join(LEGACY).exists());
        db.with(|conn| {
            let count: i64 = conn
                .query_row("SELECT COUNT(*) FROM agent_activity", [], |row| row.get(0))
                .map_err(message)?;
            assert_eq!(count, 3);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn a_completed_migration_does_not_remove_a_recreated_legacy_database() {
        let profile = Profile::new();
        drop(Database::open(&profile.0).unwrap());
        write_legacy_wal(&profile.0);
        assert!(Database::open(&profile.0).is_ok());
        assert!(profile.0.join(LEGACY).is_file());
    }

    #[test]
    fn missing_corrupt_and_future_databases_do_not_reimport_backups() {
        let profile = Profile::new();
        profile.write("workspace-v1.json", b"backup");
        drop(Database::open(&profile.0).unwrap());

        let path = profile.0.join(DATABASE);
        let raw = Connection::open(&path).unwrap();
        raw.pragma_update(None, "user_version", SCHEMA_VERSION + 1)
            .unwrap();
        raw.close().unwrap();
        assert!(Database::open(&profile.0)
            .err()
            .unwrap()
            .contains("non pris en charge"));
        assert_eq!(
            schema_version(&Connection::open(&path).unwrap()).unwrap(),
            SCHEMA_VERSION + 1
        );

        profile.write(DATABASE, b"This is not a database");
        assert!(Database::open(&profile.0).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"This is not a database");

        fs::remove_file(&path).unwrap();
        assert!(Database::open(&profile.0)
            .err()
            .unwrap()
            .contains("introuvable"));
        assert!(!path.exists());
    }
}
