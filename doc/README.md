# Documentation Spark

Spark est une application desktop Tauri : un front React/TypeScript, un noyau de domaine, un pont MCP et un backend Rust local. Cette documentation décrit l’état réel du code, y compris les limites assumées.

Le code fait foi. Quand un contrat change (SDK, manifeste, index de dépôt, commande Tauri, format de stockage), le document correspondant doit être mis à jour dans le même changement.

## Carte

### Architecture

- [Vue d’ensemble](architecture/overview.md) — couches, démarrage, flux de données.
- [Frontend](architecture/frontend.md) — SDK, core, app, UI, état et rendu.
- [Interface multilingue](architecture/i18n.md) — langues, dictionnaires, formats, ajout d’une langue.
- [Backend](architecture/backend.md) — modules Rust, commandes, stockage, MCP.
- [Espace de travail](architecture/workspace.md) — onglets, tuiles, journal, activité des agents, brief, persistance.
- [Pont MCP](architecture/mcp.md) — outils, actions, guides, surfaces, agents.

### Extensions

- [Modèle et cycle de vie](extensions/overview.md) — catalogue, niveaux, activation, import.
- [SDK](extensions/sdk.md) — `SparkAPI`, tuiles, actions, services, événements.
- [Format du paquet](extensions/package.md) — `extension.json` v2, bundle, validation, zip.
- [Extensions intégrées](extensions/builtins.md) — Terminal, Markdown, Données, Explorateur, Aperçu, OpenAlex, Navigateur web.
- [Store](extensions/store.md) — page, navigation, cartes, fiche, captures, import.
- [Dépôts et mises à jour](extensions/registry.md) — index JSON, sources, installation zip, versions.
- [Publier une extension](extensions/authoring.md) — construire, packager, tester, publier.

### Sécurité

- [Modèle de confiance](security/trust-model.md) — exécution in-process, garde-fous, limites, signature.

### Opérations

- [Commandes et vérifications](operations/commands.md) — scripts npm, cargo, tests, sidecar.
- [Persistance](operations/persistence.md) — fichiers, formats, écritures atomiques.
- [Tauri](operations/tauri.md) — commandes aux trois endroits, capabilities, CSP, assets.

### Décisions

- [0001 — Modèle de confiance](decisions/0001-trust-model.md)
- [0002 — Page Store et navigation](decisions/0002-store-navigation.md)
- [0003 — Captures d’extensions](decisions/0003-extension-captures.md)
- [0004 — Langues de l’interface](decisions/0004-interface-languages.md)
- [0005 — Navigateur dans une tuile native](decisions/0005-browser-tile.md)
- [0006 — Aperçu multi-format](decisions/0006-file-preview.md)
- [0007 — Activité des agents](decisions/0007-agent-activity.md)

## Règles de lecture

- Une extension **intégrée** est livrée avec Spark ; une extension **importée** est un paquet local ou téléchargé depuis un dépôt.
- Une extension importée s’exécute dans la fenêtre, sans sandbox. Le modèle est la confiance explicite, pas l’isolation.
- Une capture du Store est une image d’une vraie vue React, jamais une maquette promotionnelle.
- Les résumés destinés aux agents sont bornés : le journal, le brief et les surfaces ne transportent jamais un document ou une sortie de terminal.
