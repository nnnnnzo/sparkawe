//! Historique des actions d'agents.
//!
//! SQLite local, connexion partagée avec le reste de Spark. Le payload est une étape JSON
//! complète (avec ses instantanés) ; les colonnes ne servent qu'aux requêtes,
//! aux bornes et à la reprise.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::{
    database::Database,
    storage::{message, Result, Storage},
};

const PER_TAB: i64 = 30;
const MAX_STEP_BYTES: usize = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES: i64 = 4 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLoad {
    steps: Vec<Value>,
    last_seen_at: i64,
}

impl Database {
    fn load(&self, tab: &str, limit: i64) -> Result<ActivityLoad> {
        let limit = limit.clamp(1, PER_TAB);
        self.with(|conn| {
            // Une étape annulée s’efface : si Spark s’est arrêté avant la fin
            // de l’animation, on la retire au prochain chargement.
            conn.execute(
                "DELETE FROM agent_activity WHERE reverted_at IS NOT NULL",
                [],
            )
            .map_err(message)?;
            let rows = {
                let mut statement = conn
                    .prepare(
                        "SELECT payload, reverted_at FROM agent_activity
                         WHERE tab_id = ?1 ORDER BY at DESC, rowid DESC LIMIT ?2",
                    )
                    .map_err(message)?;
                let rows = statement
                    .query_map(params![tab, limit], |row| {
                        let payload: String = row.get(0)?;
                        let reverted: Option<i64> = row.get(1)?;
                        Ok((payload, reverted))
                    })
                    .map_err(message)?
                    .collect::<std::result::Result<Vec<_>, _>>()
                    .map_err(message)?;
                rows
            };
            let mut steps = Vec::with_capacity(rows.len());
            for (payload, reverted) in rows {
                // Une ligne illisible ne doit pas emporter tout l’historique.
                let Ok(mut value) = serde_json::from_str::<Value>(&payload) else {
                    continue;
                };
                if let (Some(at), Some(object)) = (reverted, value.as_object_mut()) {
                    object.insert("revertedAt".into(), Value::from(at));
                }
                steps.push(value);
            }
            let seen: Option<i64> = conn
                .query_row(
                    "SELECT at FROM agent_activity_seen WHERE tab_id = ?1",
                    params![tab],
                    |row| row.get(0),
                )
                .optional()
                .map_err(message)?;
            Ok(ActivityLoad {
                steps,
                last_seen_at: seen.unwrap_or(0),
            })
        })
    }

    fn append(&self, payload: &str) -> Result<()> {
        if payload.len() > MAX_STEP_BYTES {
            return Err("Étape d’activité trop volumineuse.".into());
        }
        let value: Value = serde_json::from_str(payload).map_err(message)?;
        let id = value
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| "Étape sans identifiant.".to_string())?;
        let tab = value
            .get("tabId")
            .and_then(Value::as_str)
            .ok_or_else(|| "Étape sans onglet.".to_string())?;
        let at = value
            .get("at")
            .and_then(Value::as_i64)
            .ok_or_else(|| "Étape sans date.".to_string())?;
        let kind = value
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("action");
        let agent = value.get("agent");
        let agent_id = agent
            .and_then(|value| value.get("id"))
            .and_then(Value::as_str);
        let agent_name = agent
            .and_then(|value| value.get("label"))
            .and_then(Value::as_str);
        let size = payload.len() as i64;

        self.with(|conn| {
            let transaction = conn.transaction().map_err(message)?;
            transaction
                .execute(
                    "INSERT INTO agent_activity
                       (id, tab_id, at, kind, agent_id, agent_name, size, payload)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                     ON CONFLICT(id) DO UPDATE SET
                       payload = excluded.payload,
                       size = excluded.size,
                       kind = excluded.kind,
                       agent_id = excluded.agent_id,
                       agent_name = excluded.agent_name",
                    params![id, tab, at, kind, agent_id, agent_name, size, payload],
                )
                .map_err(message)?;
            transaction
                .execute(
                    "DELETE FROM agent_activity
                     WHERE tab_id = ?1 AND id NOT IN (
                       SELECT id FROM agent_activity
                       WHERE tab_id = ?1 ORDER BY at DESC, rowid DESC LIMIT ?2
                     )",
                    params![tab, PER_TAB],
                )
                .map_err(message)?;
            transaction
                .execute(
                    "DELETE FROM agent_activity WHERE id IN (
                       SELECT id FROM (
                         SELECT id, SUM(size) OVER (
                           ORDER BY at DESC, rowid DESC
                         ) AS running FROM agent_activity
                       )
                       WHERE running > ?1
                         AND id != (
                           SELECT id FROM agent_activity
                           ORDER BY at DESC, rowid DESC LIMIT 1
                         )
                     )",
                    params![MAX_TOTAL_BYTES],
                )
                .map_err(message)?;
            transaction.commit().map_err(message)
        })
    }

    fn revert(&self, id: &str, at: i64) -> Result<()> {
        self.with(|conn| {
            conn.execute(
                "UPDATE agent_activity SET reverted_at = ?2 WHERE id = ?1",
                params![id, at],
            )
            .map(|_| ())
            .map_err(message)
        })
    }

    fn forget(&self, id: &str) -> Result<()> {
        self.with(|conn| {
            conn.execute("DELETE FROM agent_activity WHERE id = ?1", params![id])
                .map(|_| ())
                .map_err(message)
        })
    }

    fn seen(&self, tab: &str, at: i64) -> Result<()> {
        self.with(|conn| {
            conn.execute(
                "INSERT INTO agent_activity_seen (tab_id, at) VALUES (?1, ?2)
                 ON CONFLICT(tab_id) DO UPDATE SET at = excluded.at",
                params![tab, at],
            )
            .map(|_| ())
            .map_err(message)
        })
    }

    fn clear(&self) -> Result<()> {
        self.with(|conn| {
            let transaction = conn.transaction().map_err(message)?;
            transaction
                .execute("DELETE FROM agent_activity", [])
                .map_err(message)?;
            transaction
                .execute("DELETE FROM agent_activity_seen", [])
                .map_err(message)?;
            transaction.commit().map_err(message)?;
            let _ = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()));
            Ok(())
        })
    }
}

pub(crate) fn create_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS agent_activity (
           id          TEXT PRIMARY KEY,
           tab_id      TEXT NOT NULL,
           at          INTEGER NOT NULL,
           kind        TEXT NOT NULL,
           agent_id    TEXT,
           agent_name  TEXT,
           size        INTEGER NOT NULL,
           payload     TEXT NOT NULL,
           reverted_at INTEGER
         );
         CREATE INDEX IF NOT EXISTS agent_activity_tab
           ON agent_activity(tab_id, at DESC);
         CREATE INDEX IF NOT EXISTS agent_activity_at
           ON agent_activity(at DESC);
         CREATE TABLE IF NOT EXISTS agent_activity_seen (
           tab_id TEXT PRIMARY KEY,
           at     INTEGER NOT NULL
         );",
    )
    .map_err(message)
}

#[tauri::command]
pub async fn activity_load(
    storage: State<'_, Storage>,
    tab: String,
    limit: Option<u32>,
) -> Result<ActivityLoad> {
    storage
        .on_worker(move |storage| {
            storage
                .db()?
                .load(&tab, limit.unwrap_or(PER_TAB as u32) as i64)
        })
        .await
}

#[tauri::command]
pub async fn activity_append(storage: State<'_, Storage>, payload: String) -> Result<()> {
    storage
        .on_worker(move |storage| storage.db()?.append(&payload))
        .await
}

#[tauri::command]
pub async fn activity_revert(storage: State<'_, Storage>, id: String, at: i64) -> Result<()> {
    storage
        .on_worker(move |storage| storage.db()?.revert(&id, at))
        .await
}

#[tauri::command]
pub async fn activity_forget(storage: State<'_, Storage>, id: String) -> Result<()> {
    storage
        .on_worker(move |storage| storage.db()?.forget(&id))
        .await
}

#[tauri::command]
pub async fn activity_seen(storage: State<'_, Storage>, tab: String, at: i64) -> Result<()> {
    storage
        .on_worker(move |storage| storage.db()?.seen(&tab, at))
        .await
}

#[tauri::command]
pub async fn activity_clear(storage: State<'_, Storage>) -> Result<()> {
    storage.on_worker(|storage| storage.db()?.clear()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn step(id: &str, tab: &str, at: i64) -> String {
        serde_json::json!({
            "id": id,
            "tabId": tab,
            "at": at,
            "kind": "tile.open",
            "agent": { "id": "agent", "brand": "claude", "name": "Claude Code", "label": "Claude Code" },
            "entries": [],
            "inverse": []
        })
        .to_string()
    }

    #[test]
    fn garde_trente_etapes_par_onglet() {
        let db = Database::in_memory();
        for index in 0..31 {
            db.append(&step(&format!("step-{index}"), "tab", index))
                .unwrap();
        }
        let loaded = db.load("tab", 30).unwrap();
        assert_eq!(loaded.steps.len(), 30);
        assert_eq!(loaded.steps[0]["id"], "step-30");
        assert_eq!(loaded.steps[29]["id"], "step-1");
    }

    #[test]
    fn les_onglets_ont_chacun_leur_historique() {
        let db = Database::in_memory();
        db.append(&step("a", "left", 1)).unwrap();
        db.append(&step("b", "right", 2)).unwrap();
        assert_eq!(db.load("left", 30).unwrap().steps.len(), 1);
        assert_eq!(db.load("right", 30).unwrap().steps.len(), 1);
    }

    #[test]
    fn marque_une_etape_annulee_et_la_vue() {
        let db = Database::in_memory();
        db.append(&step("a", "tab", 10)).unwrap();
        db.revert("a", 20).unwrap();
        db.seen("tab", 30).unwrap();
        let loaded = db.load("tab", 30).unwrap();
        // Une étape annulée est effacée au chargement suivant.
        assert!(loaded.steps.is_empty());
        assert_eq!(loaded.last_seen_at, 30);
    }

    #[test]
    fn une_etape_annulee_est_effacee_au_chargement() {
        let db = Database::in_memory();
        db.append(&step("a", "tab", 10)).unwrap();
        db.revert("a", 20).unwrap();
        let loaded = db.load("tab", 30).unwrap();
        assert!(loaded.steps.is_empty());
    }

    #[test]
    fn une_etape_peut_etre_effacee_immediatement() {
        let db = Database::in_memory();
        db.append(&step("a", "tab", 10)).unwrap();
        db.forget("a").unwrap();
        assert!(db.load("tab", 30).unwrap().steps.is_empty());
    }

    #[test]
    fn refuse_un_payload_invalide_ou_sans_onglet() {
        let db = Database::in_memory();
        assert!(db.append("{}").is_err());
        assert!(db.append("pas du json").is_err());
        let missing = serde_json::json!({ "id": "a", "at": 1 }).to_string();
        assert!(db.append(&missing).is_err());
    }

    #[test]
    fn efface_tout() {
        let db = Database::in_memory();
        db.with(|conn| crate::storage::save_snapshot(conn, "workspace", b"workspace"))
            .unwrap();
        db.append(&step("a", "tab", 1)).unwrap();
        db.seen("tab", 2).unwrap();
        db.clear().unwrap();
        let loaded = db.load("tab", 30).unwrap();
        assert!(loaded.steps.is_empty());
        assert_eq!(loaded.last_seen_at, 0);
        db.with(|conn| {
            assert_eq!(
                crate::storage::load_snapshot(conn, "workspace")?.as_deref(),
                Some(b"workspace".as_slice())
            );
            Ok(())
        })
        .unwrap();
    }
}
