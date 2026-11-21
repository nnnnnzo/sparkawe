# Vue d’ensemble

## Pile

- **Tauri 2** : fenêtre native, IPC, protocole `asset`, plugin dialogue, binaire sidecar MCP.
- **React 19 + TypeScript + Vite** : interface, rendu des tuiles, Store.
- **Rust** : stockage local, extensions, fichiers, terminal PTY, PDF, MCP, agents.
- **Node** : tests du domaine et outillage de développement.

## Couches

| Couche | Dossier | Rôle |
|---|---|---|
| Contrats | `src/sdk` | `Manifest`, `SparkAPI`, `TileDefinition`, actions, services, événements, contrat React. |
| Domaine | `src/core` | Workspace, journal, brief, registre des contributions, gestion des extensions, persistance, réglages, versions. |
| Application | `src/app` | Démarrage, découverte, chargement des paquets, marketplace, pont MCP, thème global. |
| Interface | `src/ui` | Fenêtre, onglets, dockview, rail, Store, splash, erreurs. |
| Extensions | `src/extensions` | Extensions intégrées : manifeste, module React, styles, API de coopération, médias. |
| Natif | `src-tauri` | Stockage disque, extensions importées, fichiers, terminal, PDF, MCP, agents. |
| Composants | `src/shared` | Design system, marque, agents, utilitaires. |

## Démarrage

```text
main.tsx
  └─ createRuntime()
       ├─ workspace_load / settings_load
       ├─ new TileViews()
       ├─ discoverExtensions(views)
       │    ├─ manifestes + modules intégrés via import.meta.glob
       │    └─ extension_list → paquets importés
       ├─ seedCoreExtensions()
       ├─ Workspace + persistance
       ├─ Registry
       ├─ ExtensionManager.restore()
       ├─ Marketplace.restore() (en arrière-plan)
       └─ attachMcp()
  └─ SparkShell
```

Le splash reste affiché au moins 1,2 s. Le pont MCP est branché avant le rendu de la fenêtre principale.

## Flux de données

```text
Interface ──► Runtime ──► Workspace / Registry / ExtensionManager
                   │                    │
                   │                    ├─ contributions (tuiles, actions, commandes)
                   │                    └─ état par extension
                   ▼
              invoke Tauri ──► Rust ──► fichiers, sockets, PTY, réseau
                   ▲
Agent MCP ──► attachMcp ──► Runtime ──► mêmes primitives, source « agent »
```

- L’interface et les agents passent par les mêmes primitives ; seule la source du journal change.
- Le workspace est la vérité des onglets, tuiles, disposition et état actif.
- Le registre est la vérité des contributions chargées à un instant donné.
- Le catalogue des extensions est la vérité de ce qui peut être installé/activé ; le gestionnaire décide de ce qui est actif.
- Les paquets importés sont stockés hors du dépôt, dans le dossier de configuration de l’application.

## Invariants

- Une session terminal meurt si sa tuile est démontée. Le Store est donc un overlay, jamais un remplacement du workspace.
- Un onglet créé par un agent s’ouvre en arrière-plan et ne vole pas le focus.
- Les tuiles gardent leur identifiant et leurs données quand une extension est désactivée ; la vue peut devenir indisponible.
- Un résultat d’action, une surface et un brief sont bornés. Le contenu lourd reste dans la tuile.
- Une extension importée s’exécute avec les accès de la fenêtre. Voir [le modèle de confiance](../security/trust-model.md).

## Arborescence utile

```text
src/
  sdk/            contrats publics
  core/           domaine, sans React ni Tauri
  app/            câblage runtime, marketplace, MCP
  ui/             coque, layout, Store
  extensions/     extensions intégrées
  shared/         design system et marque
src-tauri/src/
  storage.rs      workspace, réglages, écritures atomiques
  extensions.rs   paquets importés, dépôts, zip
  mcp/            socket et pont local
  terminal/       PTY
  markdown.rs     accès fichiers Markdown
  explorer.rs     accès dossiers
  pdf.rs          téléchargement et cache PDF
doc/              cette documentation
examples/         paquets et dépôt de démonstration
```
