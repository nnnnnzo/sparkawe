# Travailler sur Spark

## Lire la documentation

- Commencer par `doc/README.md` pour l’architecture, les extensions, le Store, les dépôts et les décisions.
- Mettre à jour le document concerné dans le même changement qu’un contrat : SDK, manifeste, index de dépôt, commande Tauri, format de stockage, navigation du Store.
- Ne pas créer de document hors de l’index `doc/README.md`.
- Les documents sont en français, factuels, et distinguent toujours ce qui est vérifié de ce qui est prévu.

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
- Docs : vérifier les liens relatifs et que tout nouveau document est indexé dans `doc/README.md`.

## Dépôts et paquets

- Un dépôt est un index JSON statique ; les sources sont persistées dans `extensions.json` et limitées à 20.
- Les zips sont vérifiés par SHA-256 avant extraction. En release, seules les URL HTTPS sont acceptées ; localhost est toléré en debug.
- L’installation est atomique et validée côté Rust. Une mise à jour réinstalle le paquet puis réactive l’extension ; aucune installation automatique.
- Modifier `examples/hello-extension*.zip` impose de recalculer le SHA-256 dans `examples/registry.json`.
- Aucune signature n’est vérifiée aujourd’hui. Ne pas afficher un sceau certifié pour un paquet communautaire.
- La galerie d’un dépôt s’ouvre au clic sur le dépôt et après l’ajout ; elle montre les extensions sans installation préalable.
- Voir `doc/extensions/registry.md`, `doc/extensions/package.md` et `doc/security/trust-model.md`.

## Ajouter une commande Tauri

Une commande doit être déclarée à trois endroits, sinon l’invoke est refusé à l’exécution :
1. `src-tauri/src/lib.rs`, dans `generate_handler!`.
2. `src-tauri/build.rs`, dans `AppManifest::commands`.
3. `src-tauri/capabilities/main.json`, en `allow-<nom-en-kebab-case>`.

Après l’ajout, mettre à jour `doc/operations/tauri.md` et la liste du backend.

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
- Une extension importée s’exécute dans la fenêtre principale, sans sandbox. Ne jamais la présenter comme sûre ; le modèle est la confiance explicite.
- Le manifeste d’un paquet importé est validé côté Rust. Ne pas faire confiance à une validation uniquement côté front.
- Les paquets importés se chargent par un script classique enregistré dans `window.SparkExtensions[id]` et reçoivent React par `window.SparkRuntime`.
- Les captures ne vont ni dans les cartes ni dans le hero : seulement dans la galerie de la fiche. Elles sont générées depuis les vraies vues React, en 16:9, avec des données neutres.
- Le retour d’une fiche revient à la vue d’origine (Découvrir, Installées, Sources). Une galerie de dépôt revient à Sources.
- Ne pas forcer `cursor: default` sur un élément cliquable du Store ; les flèches désactivées gardent le curseur normal.
- Toute évolution du SDK, du manifeste, du format de paquet ou de l’index doit être répercutée dans `doc/extensions/`.

## Adapter la validation à la demande

- Pour une petite retouche visuelle, modifier le code et laisser Enzo juger le rendu dans la fenêtre ouverte. Faire un contrôle visuel si Enzo le demande ou si le changement est plus important. Utiliser alors la fenêtre existante.
- Si Enzo signale qu’une retouche n’a rien changé, chercher quel élément et quelle règle produisent réellement le rendu, puis corriger à cet endroit.
- Dans le compte rendu, distinguer ce qui a été modifié dans le code, ce qui est visible à chaud et ce qui attend une relance. Ne déclarer une vérification que si elle a été faite.

## Respecter les choix d’interface

- Sur macOS, aligner les feux natifs sur les onglets de Spark. Sur Windows et Linux, utiliser la barre de titre et les contrôles système.
- Séparer les tuiles par un espace qui reprend le fond de la fenêtre. Garder les tuiles sans contour extérieur et utiliser les couleurs du thème clair ou sombre pour leurs barres de défilement.
- Privilégier le geste direct : glisser un onglet vers un bord divise, vers le centre regroupe, les séparateurs se redimensionnent au glisser. Ne pas remplacer ces manipulations par des boutons ou des presets.
- Le Store est une page overlay pleine largeur, avec une sidebar flottante, pas un dialog. Il ne démonte jamais le workspace.
- Les cartes et le hero du Store n’affichent pas de capture ; la galerie de la fiche est le seul endroit.
- Les cartes d’étagère prennent une fraction entière de la largeur (4, 3, 2 puis 1) ; ne pas laisser une carte coupée.
- Tout élément cliquable du Store doit avoir `cursor: pointer` ; les flèches désactivées gardent le curseur normal.
