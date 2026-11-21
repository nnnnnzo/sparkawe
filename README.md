# Spark 0.1

Spark AWE — Agentic Workspace Environment. Spark est une application desktop Tauri qui organise les tuiles des extensions en onglets. Chaque onglet garde sa disposition Side ou Tiling.

Au premier lancement après le renommage, Spark copie l’espace de travail et les préférences de `fr.lab.desktop` vers `fr.spark.desktop`. L’ancien dossier reste en place comme sauvegarde.

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

Cmd+K (Ctrl+K sous Linux et Windows) ouvre la palette. Le rail donne accès aux tuiles des extensions épinglées. Side garde les tuiles côte à côte, Stack les empile verticalement, et Tiling permet de déplacer une tuile par son titre ou son menu. Cmd+Z et Cmd+Shift+Z (Ctrl+Z et Ctrl+Shift+Z, ou Ctrl+Y) annulent et rétablissent les déplacements et redimensionnements de tuiles, y compris ceux lancés par un agent. Les onglets partagent la barre de fenêtre avec les contrôles natifs sur macOS. Windows et Linux utilisent la barre de titre du système. Paramètres réunit le thème et le mode développeur ; ce dernier affiche les commandes de diagnostic, dont le brief de l’onglet actif. Sur macOS, le thème Transparent laisse voir le bureau à travers une vibrancy native ; comme il touche à la fenêtre, il demande de reconstruire le binaire.

## Marque

Les couleurs, la typographie et le lockup suivent les guidelines Spark AWE dans `brand/`. Le symbole et le wordmark sont rendus en SVG natif par `src/shared/brand`; les couleurs spectrales vivent dans `theme.css`. L’icône de l’application se régénère depuis `app-icon.svg` :

```sh
npx tauri icon app-icon.svg
```

## Extensions

Une nouvelle installation active les cinq extensions **intégrées** : Explorateur, Terminal, Markdown, Aperçu et Données. Les extensions **officielles**, comme OpenAlex, restent désactivées par défaut. Ouvrez le **Store** depuis le rail ou la palette pour découvrir, activer, désactiver ou épingler une extension. Une fois active, l’extension ajoute ses commandes à la palette ; ses commandes d’ouverture de tuiles sont aussi accessibles depuis le rail si elle est épinglée.

Les trois niveaux sont **Intégrées** (le socle, maintenu avec Spark et sans dépendance externe), **Officielles** (une intégration à un service nommé) et **Communautaires** (réservé). Chaque extension reçoit une teinte du spectre ; le Store affiche un sceau bleu sur les paquets signés par Spark.

Spark conserve les tuiles et leurs données à la désactivation. Réactivez l’extension pour retrouver ses vues. Terminal démarre une nouvelle session à la réactivation. Un espace créé avant le système d’extensions récupère le socle et les extensions qui ont déjà des tuiles.

Le Terminal lance le shell local dans un PTY Unix. Chaque instance a sa propre session, maintenue en mémoire au changement d’onglet ou de disposition. Après redémarrage, Spark ouvre de nouvelles sessions. Le backend PTY actuel cible macOS et Linux.

Le terminal adapte sa palette ANSI au thème de Spark. Pour Zsh, Spark charge [zsh-syntax-highlighting](https://github.com/zsh-users/zsh-syntax-highlighting/tree/0.8.0) après la configuration personnelle si celle-ci ne fournit pas déjà un moteur de coloration pris en charge. La coloration s’applique à la ligne de commande pendant la frappe.

L’éditeur Markdown et son aperçu partagent le document actif. Les brouillons sont stockés dans l’état local de Spark et sont restaurés au redémarrage. Cmd+S enregistre le document depuis l’éditeur. Les changements sur le disque sont détectés lors de l’enregistrement d’un document déjà ouvert.

Explorateur conserve le dossier choisi dans la tuile de chaque onglet. L’arborescence charge les sous-dossiers à leur ouverture. Lorsque Terminal ou Markdown est actif, sélectionnez un dossier pour y lancer un terminal ou un fichier Markdown pour l’ouvrir dans l’éditeur du même onglet.

Aperçu lit les PDF dans Spark. Une tuile accepte un lien `https://` vers un PDF, le télécharge dans le cache de l’application et rend les pages avec pdf.js, avec zoom et chargement paresseux. OpenAlex garde la découverte des PDF libres et ouvre Aperçu ; si l’extension est inactive, l’action « Lire le PDF » est annoncée indisponible.

Données regroupe un **Tableau** et un **Graphique**. Le tableau est un tableau de données typées, pas un tableur : colonnes texte, nombre ou date, tri, filtre, collage TSV depuis Excel ou Sheets, sans formules. Les graphiques (barres, lignes, aires, points) lisent les colonnes du tableau, se mettent à jour avec lui et s’exportent en SVG. Plafonds : 2 000 lignes et 32 colonnes par tableau, 1 Mo par tableau et 2 Mo pour l’ensemble.

OpenAlex expose deux tuiles : **Recherche** (par sujet, auteur ou DOI, avec filtres dans un panneau) et **Travail** (fiche complète). Les PDF libres sont repérés par OpenAlex (plusieurs URL candidates, CDN statique `mdpi-res.com` pour les articles MDPI) puis ouverts dans Aperçu, qui plafonne le téléchargement à 30 Mo. Si aucun lien ne répond, la tuile l’indique et renvoie au DOI. Aucun contournement de paywall. L’abstract est reconstruit depuis l’index inversé et plafonné à 4 000 caractères.

## Agents

Spark expose son état à un agent par MCP, en stdio. Le pont `spark-mcp` relaie les messages vers le socket local de l’application — `~/Library/Application Support/fr.spark.desktop/run/mcp.sock`, en `0600`. Aucun port réseau n’est ouvert et l’application reste la seule source de vérité.

Le pont est livré avec l’application. Dans Paramètres → **Connecter un agent…**, Spark affiche la commande absolue et la configuration à coller, avec un bouton pour la copier. En développement, la même boîte indique de lancer `npm run sidecar` si le binaire manque.

Quand un agent est lancé dans un terminal (`claude`, `codex`, `cursor-agent`, `gemini`, `opencode`, `copilot`, `vibe`, `pi`, `amp`, `crush`, `goose`, `qwen`), Spark le détecte et propose en bas à droite de le connecter en un clic : la configuration du client est écrite automatiquement (CLI du client quand il est présent, fichier JSON ou TOML sinon). La session en cours ne voit le serveur qu’au redémarrage suivant.

```json
{ "mcpServers": { "spark": { "command": "/Applications/Spark.app/Contents/MacOS/spark-mcp" } } }
```

Pour construire le pont seul, `npm run sidecar` (debug) ou `npm run sidecar:release`. Le script le copie sous `src-tauri/binaries/spark-mcp-<triple>`, le nom attendu par `externalBin` ; Tauri le place ensuite à côté de l’exécutable dans le bundle.

L’agent obtient `spark_brief`, `spark_tabs`, `spark_tab_open`, `spark_tab_close`, `spark_tab_focus`, `spark_tiles`, `spark_tile_open`, `spark_tile_read`, `spark_tile_call`, `spark_tile_close`, `spark_tile_move`, `spark_tile_resize`, `spark_undo`, `spark_redo` et `spark_events_since`, ainsi que la ressource `spark://tab/{id}/brief`. `spark_tile_move` place une tuile à côté d’une autre (gauche, droite, haut, bas) ou l’ajoute comme onglet dans son groupe (`center`), et `spark_tile_resize` lui donne une largeur ou une hauteur en fraction de l’onglet ; les deux opèrent sur l’onglet actif et ne ferment aucune tuile. `spark_undo` et `spark_redo` reviennent sur les déplacements et redimensionnements. À la souris, le déplacement est direct : glisser un onglet vers un bord divise, vers le centre regroupe, et les séparateurs se redimensionnent au glisser. Les réponses sont des références et des résumés : le contenu reste dans la tuile. Les actions marquées `mutates` sont annoncées comme telles et exécutées ; la confirmation, si elle est nécessaire, appartient au client MCP qui appelle l’outil. Un onglet créé par un agent s’ouvre en arrière-plan, sans voler le focus, et un point discret pulse dans la barre jusqu’à ce qu’on l’ouvre. Si Spark est fermé, le pont répond `spark_not_running` et sert la dernière liste d’outils connue, pour que le client n’ait pas à redémarrer.

La liste d’outils est volontairement stable : un client MCP la met en cache et la rafraîchit mal. Ce qui dépend des tuiles, ce sont les **actions**. `spark_tiles` décrit les types installés, leur niveau (`core` ou `official`) et leurs actions ; une fois une tuile ouverte, `spark_tile_read` renvoie ses données, sa surface volatile et les actions qu’elle accepte, puis `spark_tile_call` les exécute. Un agent qui veut autre chose ouvre donc d’abord la tuile correspondante : sa capacité apparaît à la lecture, sans changer la liste d’outils du client. Une action dont un service manque — par exemple « Lire le PDF » alors qu’Aperçu est désactivé — est annoncée `available: false` avec ses dépendances dans `requires`, et refusée à l’appel.

Chaque type de tuile peut déclarer un **guide** : un mode d’emploi court (actions, conventions de lignes, pièges) que l’extension fournit elle-même. Il est livré **une seule fois par session d’agent**, au premier catalogue ou à la première lecture de ce type, puis omis pour ne pas répéter les mêmes tokens.

Ajouter une tuile ou une extension ne demande donc **aucun redémarrage du client** : le catalogue `spark_tiles` est relu à chaque appel, et Spark pousse en plus `notifications/tools/list_changed` aux clients connectés pour rafraîchir la description de `spark_tile_open`.

Le pont vise macOS et Linux. Sur macOS et Linux, il est embarqué dans le bundle ; Windows reste à faire (le socket nommé n’est pas encore implémenté).

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
3. Importez les styles depuis le module. Pour sauvegarder des données, utilisez `api.state.read()` et `api.state.save(valeur)` avec une valeur sérialisable en JSON. Spark isole l’état par identifiant d’extension. Utilisez `deactivate()` pour libérer les ressources ouvertes par le module.

Vite inclut les extensions présentes dans les sources au moment de la construction. Leurs modules et styles se chargent à l’activation. Une extension qui ajoute des commandes natives doit aussi les déclarer dans Tauri et dans sa capability, puis reconstruire le binaire.

### Importer une extension locale

En mode développeur, ouvrez **Store › Sources** et collez le chemin d’un dossier contenant `extension.json`, un bundle `index.js` et éventuellement `style.css`. `examples/hello-extension` sert de paquet de démonstration.

Le bundle est un script classique qui enregistre une fabrique dans `window.SparkExtensions["<id>"]` et reçoit React par `window.SparkRuntime`. Spark valide le manifeste, refuse les identifiants réservés, les chemins qui sortent du paquet et les liens symboliques, puis copie le dossier dans sa configuration. L’extension apparaît dans **Communautaires** et peut être activée, désactivée ou ouverte dans une tuile.

### Dépôts et mises à jour

Un dépôt est un index JSON statique :

```json
{
  "schema": 1,
  "name": "Mon dépôt",
  "extensions": [{
    "id": "demo.hello",
    "name": "Hello",
    "versions": [{
      "version": "0.3.0",
      "url": "https://…/hello-0.3.0.zip",
      "sha256": "…"
    }]
  }]
}
```

Ajoutez l’URL de l’index dans **Store › Sources**. Spark télécharge le zip, vérifie son empreinte SHA-256, extrait le manifeste et le charge. Quand une version supérieure est publiée, elle apparaît dans **Mises à jour**. Les dépôts de développement peuvent être servis en `http://127.0.0.1` ; en release, seules les URL HTTPS sont acceptées.

`examples/registry.json`, `examples/hello-extension.zip` et `examples/hello-extension-v2.zip` forment un dépôt local de test.

Une tuile peut exposer `describe(tile, surface)` pour résumer son état en une ligne dans le brief de l’onglet, et des `actions` typées appelables par l’interface ou un agent. Une action déclare ses champs dans `input` ; Spark valide les arguments et refuse un résultat de plus de 16 000 caractères, afin qu’une action renvoie un identifiant plutôt qu’un contenu.

Une vue publie ce qui est sémantique à l’instant présent — sélection, requête, résultat affiché — avec `api.tiles.publish(id, { … })`. Cette surface n’est jamais persistée et reste bornée à 2 000 caractères : c’est un résumé, pas un contenu. `describe(tile, surface)` s’en sert pour le brief, et une lecture ciblée la rend disponible à un agent sans transporter la tuile.

Spark tient un journal des changements de l’espace : ouverture et fermeture de tuiles, changements d’onglet, événements émis par les extensions. `journal.since(seq)` reprend les entrées depuis un point, et `runtime.brief(onglet)` en tire un résumé court, borné en taille, destiné à un agent.

Les contrats de coopération vivent près de leurs extensions dans `api.ts`. Terminal fournit `terminal.sessions@1` et émet `terminal.session.closed`. Markdown fournit `markdown.documents@1` et émet `markdown.document.saved`. Données fournit `data.tables@1` et `data.charts@1` ; Aperçu fournit `preview.pdf@1`, que OpenAlex appelle pour ouvrir un PDF libre. Un service peut être absent quand son extension est inactive.
