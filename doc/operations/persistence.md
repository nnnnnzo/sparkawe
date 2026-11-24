# Persistance

## Dossiers

- Configuration : `app_config_dir()` ; sur macOS `~/Library/Application Support/fr.spark.desktop/`.
- Cache : `app_cache_dir()` ; aperçus dans `preview/<id>.bin`, texte extrait dans `web/text/`.
- Profil du navigateur : `web/profile/` sous Windows et Linux. Sous macOS, WKWebView range cookies et stockage dans le magasin WebKit de l’application (`~/Library/WebKit/fr.spark.desktop/`) : `data_directory` y est ignoré.
- L’ancien dossier `fr.lab.desktop` est repris au premier lancement, sans écraser les fichiers existants.

## Fichiers

| Chemin | Écrit par | Contenu |
|---|---|---|
| `workspace-v1.json` | front | Onglets, tuiles, disposition, état par extension, thème. |
| `workspace-recovery.json` | front/Rust | Copie de secours lors d’une reprise. |
| `activity.db` | Rust | Activité des agents (SQLite, 30 étapes par onglet). |
| `activity.db-wal`, `activity.db-shm` | SQLite | Journal WAL et mémoire partagée de `activity.db`. |
| `settings-v1.json` | Rust | `{ "dev": boolean, "locale": "fr" }`. |
| `extensions.json` | Rust | Paquets installés, versions, sources. |
| `extensions/<id>/<version>/` | Rust | Paquet extrait (`extension.json`, bundle, styles, icône, médias). |
| `markdown-access.json` | Rust | Tokens de fichiers Markdown autorisés. |
| `explorer-access.json` | Rust | Tokens de dossiers autorisés. |
| `preview-access.json` | Rust | Tokens de fichiers autorisés pour l’Aperçu. |
| `run/mcp.sock` | Rust | Socket MCP local. |
| `run/tools.json` | Rust | Cache d’outils pour le sidecar. |
| `preview/<id>.bin` | Rust | Fichiers téléchargés pour l’Aperçu. |
| `web/profile/` | webview | Profil du navigateur sous Windows et Linux ; macOS utilise `~/Library/WebKit/fr.spark.desktop/`. |
| `web/text/<tuile>.txt` | Rust | Texte de page extrait pour un agent. |

## `workspace-v1.json`

```json
{
  "version": 1,
  "active": "tab-uuid",
  "tabs": [{
    "id": "tab-uuid",
    "name": "Espace 1",
    "mode": "tiling",
    "tiles": [{ "id": "tile-uuid", "type": "markdown.editor", "data": {} }],
    "layouts": {}
  }],
  "pinned": null,
  "installedExtensions": ["spark.terminal", "demo.hello"],
  "seededCore": ["spark.terminal"],
  "extensions": { "demo.hello": { "counter": 1 } },
  "theme": "dark"
}
```

- `pinned: null` signifie « toutes les extensions ».
- `extensions` contient l’état sauvegardé par chaque extension.
- Les surfaces de tuiles et le journal ne sont pas persistés.

## `activity.db`

SQLite local, ouvert par `src-tauri/src/activity.rs` avec `rusqlite` (`bundled`). `PRAGMA user_version = 1`.

```sql
CREATE TABLE agent_activity (
  id          TEXT PRIMARY KEY,
  tab_id      TEXT NOT NULL,
  at          INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  agent_id    TEXT,
  agent_name  TEXT,
  size        INTEGER NOT NULL,
  payload     TEXT NOT NULL,   -- étape JSON + instantanés
  reverted_at INTEGER
);
CREATE TABLE agent_activity_seen (
  tab_id TEXT PRIMARY KEY,
  at     INTEGER NOT NULL
);
```

- `payload` contient une étape complète : session, effets, résumé et inverses. Le format est validé côté front au chargement.
- **30 étapes par onglet**, **2 Mio par étape** et **4 Mio au total** ; l’étape la plus récente est toujours conservée. Au-delà, les plus anciennes sont supprimées.
- `PRAGMA journal_mode = WAL`, `synchronous = NORMAL`, `secure_delete = ON`, `busy_timeout = 5000`.
- Le fichier est créé en `0600` sur Unix ; les fichiers WAL/SHM sont créés à côté.
- `activity_forget` supprime une étape annulée ; `activity_clear` supprime les étapes, les vues et fait un checkpoint WAL.
- `activity_load` retire d’abord les lignes marquées `reverted_at` : une étape annulée s’efface de la timeline et de la base. Le marqueur ne sert qu’à couvrir l’animation.
- Une base illisible ou trop récente ne bloque pas le démarrage : les commandes renvoient une erreur, l’interface garde l’activité en mémoire pour la session.
- Les instantanés Markdown/Données peuvent contenir du contenu local. Ils restent dans ce fichier, ne sont jamais envoyés par MCP, et s’effacent depuis la timeline.

## `settings-v1.json`

```json
{ "dev": false, "locale": "fr" }
```

- `dev` active les commandes et surfaces de développement.
- `locale` vaut `fr`, `en`, `es`, `de`, `it`, `pt`, `ja` ou `zh` ; une valeur inconnue retombe sur la langue détectée du système, puis sur l’anglais.
- Le fichier est écrit par `settings_save` à partir du snapshot du front, avec le même debounce que le workspace.

## `extensions.json`

```json
{
  "version": 1,
  "extensions": {
    "demo.hello": {
      "version": "0.3.0",
      "path": "extensions/demo.hello/0.3.0",
      "source": "http://127.0.0.1:1420/examples/registry.json"
    }
  },
  "sources": [
    {
      "url": "http://127.0.0.1:1420/examples/registry.json",
      "name": "Dépôt de démonstration"
    }
  ]
}
```

- `path` est relatif au dossier de configuration.
- `source` est absent pour un import local.
- Les versions précédentes peuvent rester sur disque ; l’état pointe la version courante.

## Écritures

- `atomic_write` écrit dans un fichier temporaire, synchronise, puis renomme. Les fichiers créés sont en `0600` sur Unix.
- Les réglages, l’état des extensions et les sources utilisent cette écriture.
- Le workspace et les réglages passent par `createPersistence` : debounce de 180 ms, écritures sérialisées, réessai de la dernière version non écrite.
- La fermeture de la fenêtre attend le flush avant `window.destroy()`.

## Reprise

- Un workspace illisible ou invalide repart d’un état initial.
- Le runtime marque `recovery` ; la première sauvegarde copie l’ancien fichier dans `workspace-recovery.json` s’il n’existe pas.
- Les identifiants `lab.*` sont migrés vers `spark.*` au chargement.
- Les anciennes tuiles `openalex.pdf` et `preview.pdf` deviennent `preview.file` avec `kind: "pdf"`.

## Mémoire uniquement

- Journal (512 entrées) ; l’activité en est une projection persistée séparément.
- Surfaces des tuiles (2 000 caractères).
- Index des dépôts et erreurs de sources.
- Statut des sessions terminal.
- État d’activation des extensions.

Un redémarrage recharge le workspace, les réglages, les paquets installés et les sources, puis redemande les index de dépôts.
