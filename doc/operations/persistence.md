# Persistance

## Dossiers

- Configuration : `app_config_dir()` ; sur macOS `~/Library/Application Support/fr.spark.desktop/`.
- Cache : `app_cache_dir()` ; aperçus dans `preview/<id>.bin`, texte extrait dans `web/text/`.
- Profil du navigateur : `web/profile/` sous Windows et Linux. Sous macOS, WKWebView range cookies et stockage dans le magasin WebKit de l’application (`~/Library/WebKit/fr.spark.desktop/`) : `data_directory` y est ignoré.
- Les fichiers manquants de l’ancien dossier `fr.lab.desktop` sont repris avant de créer la base, sans recopier les fichiers SQLite ni les artefacts MCP.

## Fichiers

| Chemin | Écrit par | Contenu |
|---|---|---|
| `spark.db` | Rust | Workspace, récupération, réglages, paquets, sources, autorisations et activité. |
| `spark.db-wal`, `spark.db-shm` | SQLite | Journal WAL et mémoire partagée ; peuvent exister tant que la base est ouverte. |
| `.spark-storage.lock` | Rust | Fichier de verrouillage du profil ; le verrou est libéré à l’arrêt du processus. |
| `.spark-db-initialized` | Rust | Témoin qui évite de recréer un profil à partir de sauvegardes obsolètes si la base disparaît. |
| `extensions/<id>/<version>-<uuid>/` | Rust | Paquet extrait (`extension.json`, bundle, styles, icône, médias). Le chemin des paquets déjà installés est conservé. |
| `run/mcp.sock` | Rust | Socket MCP local. |
| `run/tools.json` | Rust | Cache d’outils pour le sidecar. |
| `preview/<id>.bin` | Rust | Fichiers téléchargés pour l’Aperçu. |
| `web/profile/` | webview | Profil du navigateur sous Windows et Linux ; macOS utilise `~/Library/WebKit/fr.spark.desktop/`. |
| `web/text/<tuile>.txt` | Rust | Texte de page extrait pour un agent. |

## `spark.db`

SQLite embarqué (`rusqlite`, fonctionnalités `bundled` et `backup`). `PRAGMA user_version = 2`. Une seule connexion Rust sérialisée par profil : `journal_mode = WAL`, `synchronous = FULL`, `secure_delete = ON`, `busy_timeout = 5000`. Le fichier est créé en `0600` sur Unix. La base reste locale et n’est pas chiffrée.

| Table | Données |
|---|---|
| `snapshots` | `workspace`, `workspace_recovery` et `settings`. Les snapshots JSON sont conservés en octets pour préserver les formats existants et permettre la récupération d’un workspace invalide. |
| `installed_packages` | Par ID de paquet : `version`, `path` relatif au dossier de configuration, `source` facultative (URL du dépôt). |
| `registry_sources` | URL, nom et position de chaque dépôt (20 au maximum). |
| `path_grants` | Chemin correspondant à un token dans un seul type d’accès : Markdown, Explorateur ou Aperçu. |
| `agent_activity`, `agent_activity_seen` | Étapes d’activité et dernière consultation par onglet. |
| `storage_migration` | Indique si le retrait de l’ancienne base d’activité doit être terminé. |

### Snapshot du workspace

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

### Activité des agents

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
- `activity_revert` marque une étape après l’exécution réussie de son inverse. Le front appelle ensuite `activity_forget` pour supprimer la ligne par identifiant. La commande ne vérifie pas le marqueur.
- `activity_load` retire d’abord les lignes marquées `reverted_at`, y compris celles d’autres onglets. Cela évite de réafficher une action si Spark s’est arrêté avant sa suppression.
- `activity_clear` supprime les étapes et les dates de dernière consultation de tous les onglets, puis fait un checkpoint WAL.
- `activity_clear` ne modifie pas les autres tables. Les instantanés Markdown/Données peuvent contenir du contenu local. Ils restent en base, ne sont jamais envoyés par MCP, et s’effacent depuis la timeline.

### Snapshot des réglages

```json
{ "dev": false, "locale": "fr" }
```

- `dev` active les commandes et surfaces de développement.
- `locale` vaut `fr`, `en`, `es`, `de`, `it`, `pt`, `ja` ou `zh` ; une valeur inconnue retombe sur la langue détectée du système, puis sur l’anglais.
- Le fichier est écrit par `settings_save` à partir du snapshot du front, avec le même debounce que le workspace.

## Écritures

- `atomic_write` reste utilisé pour les fichiers qui ne vont pas en base (par exemple les documents Markdown et le cache MCP). Il écrit dans un fichier temporaire, synchronise, puis renomme. Les nouveaux fichiers sont créés en `0600` sur Unix.
- Le workspace et les réglages passent par `createPersistence` : debounce de 180 ms, écritures sérialisées, réessai de la dernière version non écrite.
- Les commandes de stockage utilisent des workers Rust pour ne pas attendre l’accès à SQLite ou la synchronisation disque sur le thread de la fenêtre. Le panneau Activité envoie ses opérations dans l’ordre, y compris les lectures et l’effacement.
- La fermeture de la fenêtre attend le flush de l’activité, du workspace et des réglages avant `window.destroy()`.

## Migration vers `spark.db`

1. Fermer toute ancienne instance avant le premier lancement. La nouvelle version prend un verrou par profil avant d’ouvrir ou de migrer la base.
2. Si `spark.db` n’existe pas encore, Spark construit une copie temporaire. La sauvegarde SQLite de `activity.db` inclut les écritures validées encore dans le WAL. Les anciens JSON (`workspace-v1.json`, `workspace-recovery.json`, `settings-v1.json`, `extensions.json` et les trois `*-access.json`) sont importés dans une transaction.
3. Après contrôle du schéma et de l’intégrité, Spark publie la base par renommage dans le même dossier. Une interruption avant la publication peut être retentée à partir des sources intactes. Un registre d’extensions ou d’autorisations illisible arrête l’import et affiche une erreur.
4. Après publication, Spark compare les étapes et les dates de consultation sous verrou exclusif, avant d’accepter de nouvelles écritures. Si l’ancienne base a divergé, Spark affiche une erreur et conserve les deux bases sans les fusionner. Sur Unix, Spark replie le WAL dans `activity.db` avant de retirer le journal et la base ; un retrait interrompu peut reprendre au lancement suivant. Sous Windows, l’ancienne base est conservée comme sauvegarde plutôt que de la supprimer après avoir relâché le verrou.
5. Les anciens JSON restent en place comme sauvegardes, mais ne sont plus lus ni écrits. Le retour à une ancienne version de Spark n’est pas pris en charge : elle ne voit pas les écritures dans `spark.db`.

## Reprise

- Un snapshot de workspace invalide repart d’un état initial. Le runtime marque `recovery` ; la première sauvegarde conserve les octets précédents dans `workspace_recovery` si la copie n’existe pas encore.
- Si la base est indisponible ou si son schéma n’est pas pris en charge, Spark affiche une erreur au démarrage au lieu de créer un workspace vide.
- Les identifiants `lab.*` sont migrés vers `spark.*` au chargement.
- Les anciennes tuiles `openalex.pdf` et `preview.pdf` deviennent `preview.file` avec `kind: "pdf"`.

## Mémoire uniquement

- Journal (512 entrées) ; l’activité en est une projection persistée séparément.
- Surfaces des tuiles (2 000 caractères).
- Index des dépôts et erreurs de sources.
- Statut des sessions terminal.
- État d’activation des extensions.

Un redémarrage recharge le workspace, les réglages, les paquets installés et les sources, puis redemande les index de dépôts.
