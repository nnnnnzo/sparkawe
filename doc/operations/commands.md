# Commandes et vérifications

## Développement

```bash
npm run dev          # Vite sur 127.0.0.1:1420
npm run tauri        # CLI Tauri
npm run sidecar      # reconstruit spark-mcp (debug)
npm run sidecar:release
```

La fenêtre de développement existante est réutilisée. Un changement Rust déclenche un rebuild/redémarrage ; demander l’accord avant de fermer ou relancer la fenêtre, puis laisser une seule instance.

## Vérifications avant de rendre

```bash
npm run typecheck
npm run lint
npm test
npm run build

cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo build --manifest-path src-tauri/Cargo.toml --no-default-features
```

- `npm test` tourne avec `node --experimental-strip-types` : éviter les énumérations, les propriétés de paramètres et les décorateurs dans les fichiers importés par les tests.
- Les tests Node couvrent workspace, registre, extensions, brief, données, OpenAlex, versions et navigation du Store.
- Les tests Rust couvrent le stockage, les extensions (dossier, zip, empreinte, source), le terminal, les agents, l’explorateur, le PDF et la migration.

## Après un changement MCP

Si `src-tauri/src/bin/spark-mcp.rs`, le protocole ou la liste d’outils change :

```bash
npm run sidecar
```

Le client déjà connecté peut garder son cache ; une nouvelle session peut être nécessaire pour voir un nouvel outil noyau.

## Formatage

```bash
npm run format
cargo fmt --manifest-path src-tauri/Cargo.toml
```

## Documentation

Avant de modifier l’architecture, les extensions, le Store ou les dépôts, lire [l’index](../README.md). Toute évolution d’un contrat doit mettre à jour le document correspondant :

- SDK, manifeste, package : `doc/extensions/`;
- commandes Tauri, stockage, CSP : `doc/operations/` et `doc/architecture/backend.md`;
- confiance, signature, limites : `doc/security/trust-model.md`;
- décision structurante : ajouter une entrée dans `doc/decisions/`.
