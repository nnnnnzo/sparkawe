# Frontend

## Rôles

- `src/sdk` : contrats stables, sans dépendance à React au-delà des types de composants.
- `src/core` : logique testable sans navigateur ni Tauri.
- `src/app` : assemblage du runtime, appels natifs, marketplace et pont MCP.
- `src/ui` : rendu de la fenêtre et des surfaces.
- `src/extensions` : extensions intégrées, chacune avec son manifeste et son module.

## État et abonnements

| Source | Consommateur | Mécanisme |
|---|---|---|
| Workspace | Shell, palette, layout | `useSyncExternalStore(workspace.subscribe, workspace.get)` |
| Registre des extensions | Store, rail, palette | `registry.getExtensions()` + `registry.subscribeTools` |
| Catalogue | Store, rail | `extensions.catalog` + `extensions.subscribeCatalog` |
| Dépôts | Store | `marketplace.subscribe` / `marketplace.version` |
| Réglages | Shell, Store | `useSyncExternalStore(settings.subscribe, settings.get)` |
| Activité des agents | Barre, popover | `useSyncExternalStore(activity.subscribe, activity.version)` |
| Langue | Tous les composants | `useI18n()` + `src/i18n/index.ts` |

Le Store écoute à la fois le catalogue et la marketplace. Après une installation, une désinstallation ou une mise à jour, il est donc rafraîchi sans redémarrage.

La langue vit dans les réglages (`locale`), pas dans le workspace. Un changement de langue réabonne les composants via `useI18n()` et met à jour `document.documentElement.lang` ; il ne remonte pas les vues et ne coupe pas les sessions terminal. Voir [l’interface multilingue](i18n.md).

## Rendu

`SparkShell` garde la barre de fenêtre et les onglets. Sous elle :

- `spark-surface` contient le rail et le `WorkspaceLayout`.
- Quand le Store est ouvert, il est rendu en overlay au-dessus de `spark-surface`.
- `spark-surface` devient `inert` et `aria-hidden` ; le workspace reste monté, donc les sessions terminal survivent.
- Le Store peut être fermé par le bouton « Retour à l’espace », `Échap` à l’accueil, ou en activant un onglet.

Le layout monte les vues d’extension dans des nœuds détachés puis les porte dans les panneaux dockview. Une `TileBoundary` entoure chaque vue : une erreur de rendu affiche un fallback avec « Réessayer » et « Désactiver l’extension ».

Une tuile peut aussi déléguer son contenu à une vue native : le navigateur web pose une vue web enfant de la fenêtre sur le rectangle qu’il mesure. `src/ui/layoutSignal.ts` transporte le début et la fin d’un glissement, `src/ui/layoutPlacement.ts` la demande d’ouverture en onglet d’un groupe. Voir [l’espace de travail](workspace.md#contenus-natifs).

## Workspace et persistance

- Le workspace est sérialisé en `workspace-v1.json`.
- Les snapshots d’état des extensions vivent dans `WorkspaceState.extensions`.
- Les écritures passent par `createPersistence` : debounce de 180 ms, écritures sérialisées, récupération de la dernière version non écrite.
- Le journal est en mémoire, borné à 512 entrées ; `src/core/activity.ts` le projette en étapes persistées dans `activity.db`.
- Une étape est chargée à la demande quand on ouvre son onglet, puis fusionnée avec les actions fraîches.
- Les préférences (`dev`) sont séparées dans `settings-v1.json`.

Voir [le workspace](workspace.md) et [la persistance](../operations/persistence.md).

## Catalogue et chargement

- Les intégrées sont découvertes par `import.meta.glob` (manifeste + module).
- Les paquets importés sont listés par `extension_list` ; leur manifeste JSON est converti en `Manifest` côté front, avec `tier: "community"`, leur `color` et une icône SVG rendue en masque.
- Le bundle importé est un script classique chargé depuis le protocole `asset`. Il s’enregistre dans `window.SparkExtensions[id]` et reçoit React via `window.SparkRuntime`.
- L’icône du manifeste sert aussi de repli pour la barre d’onglet quand une tuile n’en déclare pas.

Voir [le format du paquet](../extensions/package.md).

## Store

Le Store est un écran complet, pas un dialog :

- sidebar flottante ;
- accueil avec hero, étagères, catégories et recherche ;
- cartes sans capture ;
- fiche avec galerie, description et informations ;
- sources listant les dépôts, avec une galerie d’extensions par dépôt ;
- mises à jour, installées, sources et import développeur.

Voir [le Store](../extensions/store.md).

## Marketplace

`src/app/marketplace.ts` :

- lit les sources persistées ;
- télécharge les index via `registry_fetch` ;
- normalise et garde les index en mémoire ;
- expose les entrées distantes et les mises à jour ;
- délègue l’installation au runtime, qui appelle `extension_install_zip` puis `ExtensionManager.addEntry`.

Aucun index n’est mis en cache sur disque : une session sans réseau garde l’état précédent en mémoire, mais un redémarrage redemande les index.

## Tests

Les tests Node couvrent le domaine sans navigateur : workspace, registre, extensions, brief, données, OpenAlex, versions et Store. Les erreurs de rendu React ne sont pas couvertes par une suite DOM.
