# Lab 0.1

Lab est une application desktop Tauri qui organise les tuiles des extensions en onglets. Chaque onglet garde sa disposition Side ou Tiling.

## Développement

Prérequis macOS : Node.js 22.18 ou ultérieur, npm, Rust et les outils en ligne de commande de Xcode.

```sh
npm ci
npm run tauri -- dev
npm test
npm run lint
npm run typecheck
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --bundles dmg
```

Cmd+K (Ctrl+K sous Linux et Windows) ouvre la palette. Le rail donne accès aux tuiles des extensions épinglées. Side maintient les tuiles côte à côte. Tiling permet de déplacer une tuile par son titre ou son menu. Les onglets partagent la barre de fenêtre avec les contrôles natifs sur macOS. Windows et Linux utilisent la barre de titre du système. Paramètres réunit le thème et le mode développeur ; ce dernier affiche les commandes de diagnostic, dont le brief de l’onglet actif. Sur macOS, le thème Transparent laisse voir le bureau à travers une vibrancy native ; comme il touche à la fenêtre, il demande de reconstruire le binaire.

## Extensions

Une nouvelle installation démarre avec toutes les extensions désactivées. Ouvrez **Extensions** dans le rail ou depuis la palette pour les activer. Une fois active, l’extension ajoute ses commandes à la palette. Ses commandes d’ouverture de tuiles sont aussi accessibles depuis le rail si elle est épinglée.

Lab conserve les tuiles et leurs données à la désactivation. Réactivez l’extension pour retrouver ses vues. Terminal démarre une nouvelle session à la réactivation. Pour un espace créé avant ce système, Lab réactive les extensions qui ont déjà des tuiles dans l’espace.

Le Terminal lance le shell local dans un PTY Unix. Chaque instance a sa propre session, maintenue en mémoire au changement d’onglet ou de disposition. Après redémarrage, Lab ouvre de nouvelles sessions. Le backend PTY actuel cible macOS et Linux.

Le terminal adapte sa palette ANSI au thème de Lab. Pour Zsh, Lab charge [zsh-syntax-highlighting](https://github.com/zsh-users/zsh-syntax-highlighting/tree/0.8.0) après la configuration personnelle si celle-ci ne fournit pas déjà un moteur de coloration pris en charge. La coloration s’applique à la ligne de commande pendant la frappe.

L’éditeur Markdown et son aperçu partagent le document actif. Les brouillons sont stockés dans l’état local de Lab et sont restaurés au redémarrage. Cmd+S enregistre le document depuis l’éditeur. Les changements sur le disque sont détectés lors de l’enregistrement d’un document déjà ouvert.

Explorateur conserve le dossier choisi dans la tuile de chaque onglet. L’arborescence charge les sous-dossiers à leur ouverture. Lorsque Terminal ou Markdown est actif, sélectionnez un dossier pour y lancer un terminal ou un fichier Markdown pour l’ouvrir dans l’éditeur du même onglet.

## Agents

Lab expose son état à un agent par MCP, en stdio. Le pont `lab-mcp` relaie les messages vers le socket local de l’application — `~/Library/Application Support/fr.lab.desktop/run/mcp.sock`, en `0600`. Aucun port réseau n’est ouvert et l’application reste la seule source de vérité.

Construisez le pont, puis déclarez-le dans le client :

```sh
cargo build --manifest-path src-tauri/Cargo.toml --bin lab-mcp
```

```json
{ "mcpServers": { "lab": { "command": "/chemin/vers/src-tauri/target/debug/lab-mcp" } } }
```

L’agent obtient `lab_brief`, `lab_tabs`, `lab_tab_focus`, `lab_tile_open`, `lab_tile_read`, `lab_tile_call`, `lab_tile_close` et `lab_events_since`, ainsi que la ressource `lab://tab/{id}/brief`. Les réponses sont des références et des résumés : le contenu reste dans la tuile. Les actions marquées `mutates` sont refusées depuis un agent, à confirmer dans l’interface. Si Lab est fermé, le pont répond `lab_not_running` et sert la dernière liste d’outils connue, pour que le client n’ait pas à redémarrer.

Le pont vise macOS et Linux. Son inclusion dans le bundle Tauri (`externalBin`) reste à faire : il faut aujourd’hui le lancer depuis `target/debug`.

## Architecture

- `src/sdk` expose le contrat d’extension, les contributions React et l’API d’état.
- `src/core` gère l’espace de travail, le cycle de vie des extensions, les contributions et la persistance.
- `src/app` découvre les manifestes avec Vite et charge les modules des extensions à l’activation.
- `src/ui` affiche le catalogue, le rail et la palette, puis monte les vues dans Dockview.
- `src/extensions/<nom>` regroupe le manifeste, le module, les styles et les éventuelles API publiques de chaque extension.
- `src-tauri` sépare le stockage de l’espace de travail, les fichiers Markdown, l’accès aux dossiers d’Explorateur et les sessions PTY de Terminal. Les permissions IPC de chaque module natif sont dans `src-tauri/capabilities`.

### Ajouter une extension

1. Créez `src/extensions/<nom>/manifest.ts` avec un export par défaut de type `Manifest`. Donnez-lui un identifiant stable et, si elle fournit des tuiles, déclarez leurs types dans `tileTypes`.
2. Dans `index.ts` ou `index.tsx`, exportez par défaut une fabrique qui retourne un `ExtensionModule`. Enregistrez les vues et les commandes dans `activate(api)`. Une commande munie de `tileType` apparaît aussi dans le rail.
3. Importez les styles depuis le module. Pour sauvegarder des données, utilisez `api.state.read()` et `api.state.save(valeur)` avec une valeur sérialisable en JSON. Lab isole l’état par identifiant d’extension. Utilisez `deactivate()` pour libérer les ressources ouvertes par le module.

Vite inclut les extensions présentes dans les sources au moment de la construction. Leurs modules et styles se chargent à l’activation. Une extension qui ajoute des commandes natives doit aussi les déclarer dans Tauri et dans sa capability, puis reconstruire le binaire.

Une tuile peut exposer `describe(tile, surface)` pour résumer son état en une ligne dans le brief de l’onglet, et des `actions` typées appelables par l’interface ou un agent. Une action déclare ses champs dans `input` ; Lab valide les arguments et refuse un résultat de plus de 16 000 caractères, afin qu’une action renvoie un identifiant plutôt qu’un contenu.

Une vue publie ce qui est sémantique à l’instant présent — sélection, requête, résultat affiché — avec `api.tiles.publish(id, { … })`. Cette surface n’est jamais persistée et reste bornée à 2 000 caractères : c’est un résumé, pas un contenu. `describe(tile, surface)` s’en sert pour le brief, et une lecture ciblée la rend disponible à un agent sans transporter la tuile.

Lab tient un journal des changements de l’espace : ouverture et fermeture de tuiles, changements d’onglet, événements émis par les extensions. `journal.since(seq)` reprend les entrées depuis un point, et `runtime.brief(onglet)` en tire un résumé court, borné en taille, destiné à un agent.

Les contrats de coopération vivent près de leurs extensions dans `api.ts`. Terminal fournit `terminal.sessions@1` et émet `terminal.session.closed`. Markdown fournit `markdown.documents@1` et émet `markdown.document.saved`. Un service peut être absent quand son extension est inactive.
