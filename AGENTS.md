# Travailler sur Spark

## Garder la fenêtre de développement ouverte

- Réutiliser la fenêtre Spark déjà ouverte et son serveur Vite. Vérifier qu’aucune instance de développement ne tourne avant d’en lancer une.
- Appliquer les changements d’interface par rechargement à chaud. Utiliser la même fenêtre pour les contrôles visuels et la laisser ouverte à la fin.
- Demander l’accord d’Enzo avant de fermer ou de relancer cette fenêtre pour un changement natif. Si la relance est autorisée, fermer proprement l’instance existante, préserver le travail en cours et rouvrir une seule instance.
- Un changement Rust déclenche un rebuild et un redémarrage de la fenêtre par le watcher. Le socket MCP et les listes d’outils en cache repartent alors de zéro.

## Vérifier avant de rendre

- Front : `npm run typecheck`, `npm run lint`, `npm test`.
- Rust : `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, `cargo test --manifest-path src-tauri/Cargo.toml --lib`, et `cargo build --manifest-path src-tauri/Cargo.toml --no-default-features`.
- Après un changement du pont MCP (`src-tauri/src/bin/spark-mcp.rs`, protocole, outils), relancer `npm run sidecar` : les clients utilisent ce binaire.
- `npm test` tourne avec `node --experimental-strip-types` : éviter les énumérations, les propriétés de paramètres et les décorateurs dans les fichiers importés par les tests.

## Ajouter une commande Tauri

Une commande doit être déclarée à trois endroits, sinon l’invoke est refusé à l’exécution :
1. `src-tauri/src/lib.rs`, dans `generate_handler!`.
2. `src-tauri/build.rs`, dans `AppManifest::commands`.
3. `src-tauri/capabilities/main.json`, en `allow-<nom-en-kebab-case>`.

## Ne pas casser une session terminal

- Pour réorganiser, utiliser le glisser-déposer ou les primitives `spark_tile_move` / `spark_tile_resize` ; jamais recréer un onglet ni fermer des tuiles. Une session terminal meurt quand sa tuile est démontée ou son onglet recréé.
- Cmd+Z / Cmd+Shift+Z (Ctrl+Z / Ctrl+Shift+Z, Ctrl+Y) annulent la disposition, pas le contenu. L’historique est propre à l’onglet et au mode.

## MCP et agents

- Spark détient la vérité ; les outils renvoient des références et des résumés, jamais de contenu lourd. Une action marquée `mutates` est signalée comme telle ; la confirmation appartient au harnais qui appelle l’outil.
- Un onglet créé par un agent s’ouvre en arrière-plan, avec un point discret ; ne pas voler le focus.
- Ajouter un outil noyau change la liste d’outils : un client déjà connecté garde son cache et doit démarrer une nouvelle session.
- Les outils de disposition (`spark_tile_move`, `spark_tile_resize`, `spark_undo`, `spark_redo`) opèrent sur l’onglet actif uniquement.

## Extensions

- Chaque extension déclare ses tuiles, actions, `dataKeys` et son `guide`. Le guide est livré une fois par session, au premier catalogue ou à la première lecture.
- Une action qui dépend d’un service absent est marquée indisponible avec `requires` ; l’interface n’affiche pas les actions indisponibles.
- Une action qui modifie des données le déclare avec `mutates` (booléen ou fonction selon la tuile).

## Adapter la validation à la demande

- Pour une petite retouche visuelle, modifier le code et laisser Enzo juger le rendu dans la fenêtre ouverte. Faire un contrôle visuel si Enzo le demande ou si le changement est plus important. Utiliser alors la fenêtre existante.
- Si Enzo signale qu’une retouche n’a rien changé, chercher quel élément et quelle règle produisent réellement le rendu, puis corriger à cet endroit.
- Dans le compte rendu, distinguer ce qui a été modifié dans le code, ce qui est visible à chaud et ce qui attend une relance. Ne déclarer une vérification que si elle a été faite.

## Respecter les choix d’interface

- Sur macOS, aligner les feux natifs sur les onglets de Spark. Sur Windows et Linux, utiliser la barre de titre et les contrôles système.
- Séparer les tuiles par un espace qui reprend le fond de la fenêtre. Garder les tuiles sans contour extérieur et utiliser les couleurs du thème clair ou sombre pour leurs barres de défilement.
- Privilégier le geste direct : glisser un onglet vers un bord divise, vers le centre regroupe, les séparateurs se redimensionnent au glisser. Ne pas remplacer ces manipulations par des boutons ou des presets.
