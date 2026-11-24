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
- Le sidecar garde **une connexion par processus client**, pas une par ligne : Spark voit donc la même session pendant toute la vie du sidecar. Si Spark redémarre, le sidecar se reconnecte et rejoue la dernière `initialize` pour retrouver l’identité du client.
- Aucun port réseau n’est ouvert.

## Appels directs et Code Mode

Les deux modes utilisent la même entrée MCP `stdio`. En Code Mode, le **client**
exécute le code qui orchestre les appels ; Spark reçoit les mêmes `tools/call`
qu’en mode direct. Spark n’exécute pas le code généré et ne peut pas déduire son
origine à partir d’un appel. Aucun réglage Spark ni second serveur n’est requis.

| Client | Choix et état de la vérification |
|---|---|
| [OpenCode V2](https://opencode.ai/docs/mcp-servers) | Code Mode par défaut. Pour repasser en direct, ajouter `codemode: false` dans `mcp.servers.spark`. Lecture composée vérifiée avec OpenCode 2.3.2 et la fenêtre Spark ouverte. |
| [Codex CLI](https://developers.openai.com/codex/config-file/config-reference) | Activer `features.code_mode.enabled = true` dans la configuration Codex, ou lancer `codex -c 'features.code_mode.enabled=true'` pour une session. Option expérimentale, désactivée par défaut. Appels directs et Code Mode vérifiés avec Codex 0.171.0 sur un workspace de test en mémoire utilisant le serveur Spark. |
| [Claude Code](https://code.claude.com/docs/en/code-mode) | Option expérimentale en terminal interactif, `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1`, selon les conditions du client. Connexion MCP vérifiée avec Claude Code 2.1.330 ; l’appel au modèle a été bloqué par l’authentification, donc la composition n’est pas vérifiée. |

Un client sans Code Mode continue d’utiliser les outils en direct. Après une
mise à jour du catalogue, démarrer une nouvelle session si le client garde
l’ancienne définition des outils. Ce pont local ne connecte pas ChatGPT Web
directement.

## Outils

| Outil | Rôle |
|---|---|
| `spark_brief` | Résumé court de l’onglet actif ou ciblé, avec les références de tuiles dans la sortie structurée. |
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

- **Sorties structurées** : depuis la révision 2025-06-18 du protocole, `spark_brief`, `spark_tabs`, `spark_tiles`, `spark_tile_read` et `spark_events_since` déclarent un `outputSchema` et renvoient un `structuredContent` qui y répond. Les mêmes outils continuent de renvoyer leur résultat historique sous forme de texte. Les données, surfaces et schémas d’arguments propres aux extensions restent ouverts.
- **Références de tuiles** : `spark_brief.structuredContent.tileRefs` contient jusqu’aux 32 premières paires `{ ref, type }` de l’onglet, dans l’ordre du workspace. `tileRefsTruncated` indique si la liste est partielle. Passer `ref` à `spark_tile_read` sans extraire d’identifiant du texte ; `lastSeq` permet de reprendre le journal.
- **Résultats bornés** : une action qui renvoie plus de 16 000 caractères est refusée ; elle doit renvoyer un identifiant ou un résumé. Le navigateur suit cette règle : `read_text` renvoie au plus 6 000 caractères et le chemin du texte complet.
- **Surfaces** : `api.tiles.publish` reste un résumé volatil de 2 000 caractères, jamais persisté. Le navigateur n’y met que l’adresse, le titre et l’état de chargement.
- **Guides** : le `guide` d’un type de tuile est livré au premier catalogue ou à la première lecture. Le suivi est partagé par les clients de la fenêtre et réinitialisé par une nouvelle initialisation MCP.
- **Services** : une action avec `requires` n’apparaît pas si le service est absent.
- **Mutations** : les cinq lectures annoncent `readOnlyHint: true`, à titre indicatif. `spark_tile_call` peut modifier des données : une action `mutates` est signalée et la confirmation appartient au harnais, en Code Mode comme en direct.
- **Source** : toute action passée par `spark_tile_call` est journalisée avec `source: "agent"`, la session `agent` et l’appel `op`. La fin d’un appel ne retire pas l’attribution d’un autre appel agent encore en cours ; les lectures ne changent pas cette attribution.
- **Onglets d’agent** : `spark_tab_open` crée un onglet en arrière-plan et un point discret dans la barre, sans voler le focus.
- **Sessions** : `initialize` lit `clientInfo` (`name`, `title`, `version`). La marque correspondante vient de `src/shared/agents/data.ts` ; un client inconnu reçoit un monogramme. Deux sessions vivantes du même client sont distinguées par un ordinal (`Claude Code 2`). `mcp:closed` libère l’ordinal. L’activité garde une copie de l’identité dans chaque étape.
- **Limite** : l’attribution par portée asynchrone reste approximative quand deux clients appellent en même temps ; le cas courant d’un seul agent est exact. Les effets d’un même appel partagent en revanche le même `op`.

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
