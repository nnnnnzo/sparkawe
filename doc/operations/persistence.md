# Persistance

## Dossiers

- Configuration : `app_config_dir()` ; sur macOS `~/Library/Application Support/fr.spark.desktop/`.
- Cache : `app_cache_dir()` ; PDF dans `pdf/<id>.pdf`, texte extrait dans `web/text/`.
- Profil du navigateur : `web/profile/` sous Windows et Linux. Sous macOS, WKWebView range cookies et stockage dans le magasin WebKit de l’application (`~/Library/WebKit/fr.spark.desktop/`) : `data_directory` y est ignoré.
- L’ancien dossier `fr.lab.desktop` est repris au premier lancement, sans écraser les fichiers existants.

## Fichiers

| Chemin | Écrit par | Contenu |
|---|---|---|
| `workspace-v1.json` | front | Onglets, tuiles, disposition, état par extension, thème. |
| `workspace-recovery.json` | front/Rust | Copie de secours lors d’une reprise. |
| `settings-v1.json` | Rust | `{ "dev": boolean, "locale": "fr" }`. |
| `extensions.json` | Rust | Paquets installés, versions, sources. |
| `extensions/<id>/<version>/` | Rust | Paquet extrait (`extension.json`, bundle, styles, icône, médias). |
| `markdown-access.json` | Rust | Tokens de fichiers Markdown autorisés. |
| `explorer-access.json` | Rust | Tokens de dossiers autorisés. |
| `run/mcp.sock` | Rust | Socket MCP local. |
| `run/tools.json` | Rust | Cache d’outils pour le sidecar. |
| `pdf/<id>.pdf` | Rust | PDF téléchargés. |
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
- Les anciennes tuiles `openalex.pdf` deviennent `preview.pdf`.

## Mémoire uniquement

- Journal (512 entrées).
- Surfaces des tuiles (2 000 caractères).
- Index des dépôts et erreurs de sources.
- Statut des sessions terminal.
- État d’activation des extensions.

Un redémarrage recharge le workspace, les réglages, les paquets installés et les sources, puis redemande les index de dépôts.
