# Pont MCP

## Chaîne

```text
Client agent ──stdio JSON-RPC──► spark-mcp (sidecar)
                                      │ socket Unix
                                      ▼
                              fenêtre Spark (attachMcp)
                                      │
                                      ▼
                              runtime / registre / workspace
```

- Le sidecar `src-tauri/src/bin/spark-mcp.rs` est déclaré comme binaire externe.
- Le serveur Rust crée un socket local dans le dossier de configuration.
- `attachMcp` relaie les lignes reçues vers la fenêtre et renvoie les réponses.
- Aucun port réseau n’est ouvert.

## Outils

| Outil | Rôle |
|---|---|
| `spark_brief` | Résumé court de l’onglet actif ou ciblé. |
| `spark_tabs` | Liste des onglets et de leur disposition. |
| `spark_tiles` | Catalogue compact des types de tuiles, actions, disponibilité ; `detail: "full"` ajoute descriptions et schémas. |
| `spark_tab_open` | Crée un onglet en arrière-plan. |
| `spark_tab_close` | Ferme un onglet ; refusé si un document non enregistré s’y oppose. |
| `spark_tab_focus` | Active un onglet. |
| `spark_tile_open` | Ouvre une tuile et renvoie sa référence. |
| `spark_tile_read` | Lit la surface, les données et les actions disponibles d’une tuile. |
| `spark_tile_call` | Exécute une action déclarée. |
| `spark_tile_close` | Ferme une tuile. |
| `spark_tile_move` | Déplace une tuile dans l’onglet actif. |
| `spark_tile_resize` | Redimensionne une tuile dans l’onglet actif. |
| `spark_undo` | Annule une opération de disposition. |
| `spark_redo` | Rétablit une opération de disposition. |
| `spark_events_since` | Reprend le journal depuis une séquence. |

## Contrats

- **Résultats bornés** : une action qui renvoie plus de 16 000 caractères est refusée ; elle doit renvoyer un identifiant ou un résumé. Le navigateur suit cette règle : `read_text` renvoie au plus 6 000 caractères et le chemin du texte complet.
- **Surfaces** : `api.tiles.publish` reste un résumé volatil de 2 000 caractères, jamais persisté. Le navigateur n’y met que l’adresse, le titre et l’état de chargement.
- **Guides** : le `guide` d’un type de tuile est livré une fois par session, au premier catalogue ou à la première lecture.
- **Services** : une action avec `requires` n’apparaît pas si le service est absent.
- **Mutations** : une action `mutates` est signalée ; la confirmation appartient au harnais qui l’appelle.
- **Source** : toute action passée par `spark_tile_call` est journalisée avec `source: "agent"`.
- **Onglets d’agent** : `spark_tab_open` crée un onglet en arrière-plan et un point discret dans la barre, sans voler le focus.

## Cycle de vie

- `registry.subscribeTools` déclenche `notifications/tools/list_changed` quand une extension est activée, désactivée ou importée.
- Le catalogue `spark_tiles` est recalculé à chaque appel.
- Le sidecar met en cache la liste d’outils pour les clients ; un client déjà connecté peut conserver son cache et doit démarrer une nouvelle session pour voir un nouvel outil noyau.
- Après un changement du protocole, du sidecar ou de la liste d’outils, relancer `npm run sidecar`.

## Extension côté agent

Une extension peut :

- déclarer un `guide` court et concret ;
- publier une surface lisible ;
- exposer des actions typées et bornées ;
- fournir des services aux autres extensions lorsqu’elle est active.

Voir [le SDK](../extensions/sdk.md) et [le brief](workspace.md#brief).
