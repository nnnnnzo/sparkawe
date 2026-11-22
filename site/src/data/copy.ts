export type Lang = "en" | "fr";

export interface AgentCardText {
  auto: string;
  manual: string;
}

export interface Copy {
  lang: Lang;
  htmlLang: string;
  switchLabel: string;
  switchHref: string;
  switchCode: string;
  meta: {
    title: string;
    description: string;
  };
  nav: {
    product: string;
    agents: string;
    interaction: string;
    extensions: string;
    status: string;
    github: string;
    download: string;
    menu: string;
  };
  hero: {
    eyebrow: string;
    title: string[];
    accent: number;
    lede: string;
    primary: string;
    secondary: string;
    meta: string[];
    shotAlt: string;
  };
  awe: {
    eyebrow: string;
    title: string;
    lede: string;
    cards: { title: string; body: string }[];
  };
  product: {
    eyebrow: string;
    title: string;
    lede: string;
    cards: { title: string; body: string }[];
  };
  agents: {
    eyebrow: string;
    title: string;
    lede: string;
    auto: string;
    manual: string;
    note: string;
    howTitle: string;
    howLede: string;
    steps: { title: string; body: string }[];
    configTitle: string;
    configNote: string;
    limitsTitle: string;
    limits: string[];
  };
  interaction: {
    eyebrow: string;
    title: string;
    lede: string;
    gestures: { keys: string; title: string; body: string }[];
    agentLink: string;
  };
  extensions: {
    eyebrow: string;
    title: string;
    lede: string;
    cards: { title: string; body: string }[];
    noticeTitle: string;
    notice: string;
  };
  status: {
    eyebrow: string;
    title: string;
    lede: string;
    rows: { label: string; value: string }[];
  };
  start: {
    eyebrow: string;
    title: string;
    lede: string;
    steps: { label: string; command: string }[];
    note: string;
    git: string;
    license: string;
  };
  footer: {
    tagline: string;
    product: string;
    project: string;
    legal: string;
    productLinks: { label: string; href: string }[];
    projectLinks: { label: string; href: string }[];
    legalLinks: { label: string; href: string }[];
    copyright: string;
    analytics: string;
  };
}

export const EN: Copy = {
  lang: "en",
  htmlLang: "en",
  switchLabel: "Français",
  switchHref: "/fr/",
  switchCode: "FR",
  meta: {
    title: "Spark — an agentic workspace for macOS",
    description:
      "Spark is a desktop workspace where terminals, files, PDFs and data share one tab with your agents. Tiling layout, MCP over a local socket, open source.",
  },
  nav: {
    product: "Product",
    agents: "Agents",
    interaction: "Interaction",
    extensions: "Extensions",
    status: "Status",
    github: "GitHub",
    download: "Get Spark",
    menu: "Menu",
  },
  hero: {
    eyebrow: "Agentic Workspace Environment · macOS",
    title: ["Your agents work", "in the same room", "as you."],
    accent: 1,
    lede:
      "Spark is a desktop workspace built around tabs. Terminals, files, PDFs, tables and agents live side by side in one window — and share the same objects.",
    primary: "Build from source",
    secondary: "Read the code",
    meta: ["macOS", "Tauri 2 · Rust", "MIT", "v0.1.0"],
    shotAlt:
      "Spark window with three tiles: a Codex terminal, a data table of WMT 2014 BLEU scores for Attention Is All You Need, its bar chart, and the paper itself.",
  },
  awe: {
    eyebrow: "AWE",
    title: "An agentic workspace, not another chat window.",
    lede:
      "Most agent tools put the conversation in the middle and the work at the edges. Spark does the opposite: the workspace is the surface, and the agent plugs into it.",
    cards: [
      {
        title: "One tab, many tiles",
        body: "A terminal, a PDF, a table and a chart, split and grouped. Each tile keeps its own state, and a terminal keeps its session.",
      },
      {
        title: "Shared objects",
        body: "An agent opens a tile, reads its declared state and calls typed actions. It never scrapes the screen or fakes a click.",
      },
      {
        title: "Local by default",
        body: "The MCP bridge is a Unix socket with 0600 permissions. No network port, no account, no cloud relay.",
      },
    ],
  },
  product: {
    eyebrow: "Product",
    title: "What is already in the box.",
    lede:
      "Six tiles, one workspace. Everything below ships in the app today, not in a roadmap.",
    cards: [
      {
        title: "Terminal",
        body: "A real PTY session per tile. It survives layout changes and tab switches, and restarts fresh after a launch.",
      },
      {
        title: "Explorer",
        body: "A folder tree that opens a file in Markdown or a shell in the right directory, for you and for agents.",
      },
      {
        title: "Markdown",
        body: "Editor and preview over the same document, with line-addressed actions so an agent edits precisely.",
      },
      {
        title: "PDF",
        body: "An https link is fetched and cached. The content stays out of MCP: agents only see the title and page count.",
      },
      {
        title: "Data",
        body: "Typed tables — text, number, date — up to 2,000 rows and 32 columns, with charts bound to the table itself.",
      },
      {
        title: "OpenAlex",
        body: "Search by topic, author or DOI, read a work's fields, and open its free PDF beside your notes.",
      },
    ],
  },
  agents: {
    eyebrow: "MCP",
    title: "The agents you already use, in the workspace you already have.",
    lede:
      "Spark speaks the Model Context Protocol over a local socket. Fifteen tools, one server, and a bridge that is already in the bundle.",
    auto: "Configured by Spark",
    manual: "Connect by hand",
    note:
      "Spark recognises these commands in a terminal and offers to connect the client in one click. Six clients are configured automatically; the others work as soon as they point at the same bridge.",
    howTitle: "How an agent actually works here",
    howLede:
      "No screenshot parsing, no computer-use heuristics. The agent calls the app, and the app answers with references and summaries.",
    steps: [
      {
        title: "Spark holds the server.",
        body: "The MCP server lives inside the app, behind a Unix socket with 0600 permissions. The bundled spark-mcp binary relays a client's stdio to it.",
      },
      {
        title: "Your agent reads the tab.",
        body: "spark_brief returns the tab, its tiles and their surfaces. spark_tile_read adds the data and the actions that tile accepts right now.",
      },
      {
        title: "It acts on real objects.",
        body: "spark_tile_open creates a tile, spark_tile_call runs a typed action, spark_tile_move and spark_tile_resize arrange the tab.",
      },
      {
        title: "You keep the last word.",
        body: "Any action that changes data is flagged mutates and executed; asking for confirmation is the client's job. Tabs an agent opens stay in the background.",
      },
    ],
    configTitle: "Point a client at Spark",
    configNote:
      "Settings › Connect an agent… shows the absolute path and writes the client's config for you.",
    limitsTitle: "What an agent cannot do",
    limits: [
      "Read or write the terminal: no MCP action touches a PTY's content.",
      "Scrape pixel content: it gets declared surfaces, not screenshots.",
      "Open UI dialogs or move your focus to another tab.",
      "Add a tool on its own: the tool list is stable, actions are discovered per tile.",
    ],
  },
  interaction: {
    eyebrow: "Interaction",
    title: "Arrange the work by hand, undo it like text.",
    lede:
      "The layout is a direct manipulation surface. No presets, no layout dialog — just the gesture you would expect, and a history that covers agents too.",
    gestures: [
      {
        keys: "Drag → edge",
        title: "Split",
        body: "Drop a tab on a border and the tab divides in that direction.",
      },
      {
        keys: "Drag → center",
        title: "Group",
        body: "Drop it in the middle and it joins the tile as a tab, keeping both alive.",
      },
      {
        keys: "Drag separator",
        title: "Resize",
        body: "Both neighbours resize at once. The split ratio is persisted per tab.",
      },
      {
        keys: "⌘K",
        title: "Palette",
        body: "Every command, tile and pinned extension action, from the keyboard.",
      },
      {
        keys: "⌘Z · ⇧⌘Z",
        title: "Undo the layout",
        body: "Moves and resizes, including the ones an agent made. Never the content.",
      },
      {
        keys: "Side · Stack · Tiling",
        title: "Three modes",
        body: "Switch the arrangement without recreating a tab or killing a terminal session.",
      },
    ],
    agentLink: "The same moves exist as two MCP tools: spark_tile_move and spark_tile_resize.",
  },
  extensions: {
    eyebrow: "Extensions",
    title: "A tile is a small contract.",
    lede:
      "Extensions declare tile types, actions, data keys and a short guide. The guide is delivered once per agent session, so the agent learns the tile without spending tokens twice.",
    cards: [
      {
        title: "Declare",
        body: "A manifest with a stable id, React views, typed action inputs and a mutates or read-only contract per action.",
      },
      {
        title: "Install",
        body: "A JSON registry index, zips verified by SHA-256, extraction and activation handled in Rust. HTTPS only in release.",
      },
      {
        title: "Update",
        body: "An update reinstalls the package and reactivates the extension. Nothing installs itself in the background.",
      },
    ],
    noticeTitle: "Unsigned and unsandboxed",
    notice:
      "Imported extensions run in the main window with the app's privileges, and no signature is verified today. Spark treats them as code you chose to trust — install what you would run from a terminal.",
  },
  status: {
    eyebrow: "Status",
    title: "What works, and what does not, in v0.1.0.",
    lede:
      "A short honest list beats a feature grid. This is the state of the repository today.",
    rows: [
      {
        label: "Platform",
        value:
          "<strong>macOS</strong>, built locally. The PTY layer also targets Linux; Windows is not supported yet, including the MCP bridge.",
      },
      {
        label: "Builds",
        value:
          "Signed: no. Notarised: no. Builds are unsigned, so macOS asks you to confirm on first open.",
      },
      {
        label: "Downloads",
        value:
          "No release artefact yet. You build from source with Node, Rust and the Xcode command line tools.",
      },
      {
        label: "Updates",
        value: "No update channel. Pull the repository and rebuild.",
      },
      {
        label: "Extensions",
        value:
          "Imported packages are unsandboxed and signatures are not verified. Registry sources are capped at 20.",
      },
      {
        label: "Licence",
        value:
          "Code under MIT. The name and the logo are covered by a separate trademark policy. No CLA — a DCO sign-off.",
      },
      {
        label: "Telemetry",
        value: "None in the app. This site uses Vercel Web Analytics, without cookies.",
      },
    ],
  },
  start: {
    eyebrow: "Start",
    title: "Clone it, run it, break it.",
    lede:
      "The only installation path today is the source. It takes Node 22.18+, Rust and the Xcode command line tools.",
    steps: [
      { label: "Clone and install", command: "git clone https://github.com/nnnnnzo/sparkawe.git\ncd sparkawe && npm install" },
      { label: "Build the MCP bridge", command: "npm run sidecar" },
      { label: "Run the app", command: "npm run tauri -- dev" },
    ],
    note:
      "Then open Settings › Connect an agent… to wire Claude Code, Codex or another MCP client.",
    git: "Remote",
    license: "Licence",
  },
  footer: {
    tagline:
      "A desktop workspace where people and agents share the same tabs. Built by one person, in the open.",
    product: "Product",
    project: "Project",
    legal: "Legal",
    productLinks: [
      { label: "Download", href: "#start" },
      { label: "Agents", href: "#agents" },
      { label: "Extensions", href: "#extensions" },
      { label: "Status", href: "#status" },
    ],
    projectLinks: [
      { label: "GitHub", href: "https://github.com/nnnnnzo/sparkawe" },
      { label: "Issues", href: "https://github.com/nnnnnzo/sparkawe/issues" },
      { label: "Architecture", href: "https://github.com/nnnnnzo/sparkawe/tree/main/doc" },
      { label: "Brand", href: "https://github.com/nnnnnzo/sparkawe/tree/main/brand" },
    ],
    legalLinks: [
      { label: "Licence", href: "/license/" },
      { label: "Trademark", href: "/trademark/" },
      { label: "Third-party notices", href: "/notices/" },
    ],
    copyright: "© 2026 nnnnnzo · MIT",
    analytics: "Vercel Web Analytics · no cookies",
  },
};

export const FR: Copy = {
  lang: "fr",
  htmlLang: "fr",
  switchLabel: "English",
  switchHref: "/",
  switchCode: "EN",
  meta: {
    title: "Spark — un espace de travail agentique pour macOS",
    description:
      "Spark est un espace de travail où terminaux, fichiers, PDF et données partagent un onglet avec vos agents. Disposition en tuiles, MCP sur une socket locale, open source.",
  },
  nav: {
    product: "Produit",
    agents: "Agents",
    interaction: "Interaction",
    extensions: "Extensions",
    status: "État",
    github: "GitHub",
    download: "Obtenir Spark",
    menu: "Menu",
  },
  hero: {
    eyebrow: "Agentic Workspace Environment · macOS",
    title: ["Vos agents travaillent", "dans la même pièce", "que vous."],
    accent: 1,
    lede:
      "Spark est un espace de travail construit autour d’onglets. Terminaux, fichiers, PDF, tableaux et agents vivent côte à côte dans une seule fenêtre — et partagent les mêmes objets.",
    primary: "Compiler les sources",
    secondary: "Lire le code",
    meta: ["macOS", "Tauri 2 · Rust", "MIT", "v0.1.0"],
    shotAlt:
      "Fenêtre Spark avec trois tuiles : un terminal Codex, un tableau des scores BLEU WMT 2014 d’Attention Is All You Need, son graphique en barres, et le papier lui-même.",
  },
  awe: {
    eyebrow: "AWE",
    title: "Un espace agentique, pas une énième fenêtre de chat.",
    lede:
      "La plupart des outils d’agents mettent la conversation au centre et le travail sur les bords. Spark fait l’inverse : l’espace de travail est la surface, et l’agent s’y branche.",
    cards: [
      {
        title: "Un onglet, plusieurs tuiles",
        body: "Un terminal, un PDF, un tableau et un graphique, divisés et groupés. Chaque tuile garde son état, et un terminal garde sa session.",
      },
      {
        title: "Des objets partagés",
        body: "Un agent ouvre une tuile, lit l’état qu’elle déclare et appelle des actions typées. Il ne lit jamais l’écran et ne simule aucun clic.",
      },
      {
        title: "Local par défaut",
        body: "Le pont MCP est une socket Unix en 0600. Aucun port réseau, aucun compte, aucun relais dans le cloud.",
      },
    ],
  },
  product: {
    eyebrow: "Produit",
    title: "Ce qui est déjà dans la boîte.",
    lede:
      "Six tuiles, un seul espace. Tout ce qui suit est livré dans l’application aujourd’hui, pas dans une feuille de route.",
    cards: [
      {
        title: "Terminal",
        body: "Une vraie session PTY par tuile. Elle survit aux changements de disposition et d’onglet, et repart neuve au lancement.",
      },
      {
        title: "Explorateur",
        body: "Une arborescence qui ouvre un fichier en Markdown ou un shell dans le bon dossier — pour vous comme pour les agents.",
      },
      {
        title: "Markdown",
        body: "Éditeur et aperçu sur le même document, avec des actions adressées par ligne pour qu’un agent modifie au bon endroit.",
      },
      {
        title: "PDF",
        body: "Un lien https est téléchargé et mis en cache. Le contenu reste hors de MCP : l’agent ne voit que le titre et le nombre de pages.",
      },
      {
        title: "Données",
        body: "Des tableaux typés — texte, nombre, date — jusqu’à 2 000 lignes et 32 colonnes, avec des graphiques liés au tableau.",
      },
      {
        title: "OpenAlex",
        body: "Chercher par sujet, auteur ou DOI, lire les champs d’un travail et ouvrir son PDF libre à côté de vos notes.",
      },
    ],
  },
  agents: {
    eyebrow: "MCP",
    title: "Les agents que vous utilisez déjà, dans l’espace que vous avez déjà.",
    lede:
      "Spark parle le Model Context Protocol sur une socket locale. Quinze outils, un serveur, et un pont déjà présent dans le bundle.",
    auto: "Configuré par Spark",
    manual: "Connexion manuelle",
    note:
      "Spark reconnaît ces commandes dans un terminal et propose de connecter le client en un clic. Six clients sont configurés automatiquement ; les autres fonctionnent dès qu’ils pointent vers le même pont.",
    howTitle: "Comment un agent travaille vraiment ici",
    howLede:
      "Pas d’analyse d’écran, pas d’heuristique de computer-use. L’agent appelle l’application, qui répond par des références et des résumés.",
    steps: [
      {
        title: "Spark détient le serveur.",
        body: "Le serveur MCP vit dans l’application, derrière une socket Unix en 0600. Le binaire spark-mcp embarqué relaie le stdio du client.",
      },
      {
        title: "Votre agent lit l’onglet.",
        body: "spark_brief renvoie l’onglet, ses tuiles et leurs surfaces. spark_tile_read ajoute les données et les actions que la tuile accepte à cet instant.",
      },
      {
        title: "Il agit sur de vrais objets.",
        body: "spark_tile_open crée une tuile, spark_tile_call exécute une action typée, spark_tile_move et spark_tile_resize arrangent l’onglet.",
      },
      {
        title: "Vous gardez le dernier mot.",
        body: "Toute action qui modifie des données est signalée mutates puis exécutée ; demander confirmation revient au client. Les onglets ouverts par un agent restent en arrière-plan.",
      },
    ],
    configTitle: "Brancher un client sur Spark",
    configNote:
      "Réglages › Connecter un agent… affiche le chemin absolu et écrit la configuration du client.",
    limitsTitle: "Ce qu’un agent ne peut pas faire",
    limits: [
      "Lire ou écrire le terminal : aucune action MCP ne touche au contenu d’un PTY.",
      "Lire l’écran : il reçoit des surfaces déclarées, pas des captures.",
      "Ouvrir des dialogues ou voler le focus vers un autre onglet.",
      "Ajouter un outil de lui-même : la liste est stable, les actions se découvrent par tuile.",
    ],
  },
  interaction: {
    eyebrow: "Interaction",
    title: "Rangez le travail à la main, annulez comme du texte.",
    lede:
      "La disposition se manipule directement. Aucun preset, aucune boîte de dialogue : le geste attendu, et un historique qui couvre aussi les agents.",
    gestures: [
      {
        keys: "Glisser → bord",
        title: "Diviser",
        body: "Déposez un onglet sur un bord et l’onglet se divise dans cette direction.",
      },
      {
        keys: "Glisser → centre",
        title: "Grouper",
        body: "Déposez-le au centre : il rejoint la tuile comme onglet, sans en tuer aucun.",
      },
      {
        keys: "Glisser le séparateur",
        title: "Redimensionner",
        body: "Les deux voisins bougent ensemble. Le rapport est conservé par onglet.",
      },
      {
        keys: "⌘K",
        title: "Palette",
        body: "Toutes les commandes, tuiles et actions épinglées, au clavier.",
      },
      {
        keys: "⌘Z · ⇧⌘Z",
        title: "Annuler la disposition",
        body: "Déplacements et redimensionnements, y compris ceux d’un agent. Jamais le contenu.",
      },
      {
        keys: "Side · Stack · Tiling",
        title: "Trois modes",
        body: "Changez l’arrangement sans recréer un onglet ni tuer une session terminal.",
      },
    ],
    agentLink: "Les mêmes gestes existent en deux outils MCP : spark_tile_move et spark_tile_resize.",
  },
  extensions: {
    eyebrow: "Extensions",
    title: "Une tuile, un petit contrat.",
    lede:
      "Une extension déclare ses types de tuiles, ses actions, ses dataKeys et un guide. Le guide est livré une fois par session d’agent : il apprend la tuile sans payer deux fois les mêmes tokens.",
    cards: [
      {
        title: "Déclarer",
        body: "Un manifeste avec un identifiant stable, des vues React, des entrées d’action typées et un contrat lecture seule ou mutates par action.",
      },
      {
        title: "Installer",
        body: "Un index JSON, des zips vérifiés par SHA-256, extraction et activation côté Rust. HTTPS uniquement en release.",
      },
      {
        title: "Mettre à jour",
        body: "Une mise à jour réinstalle le paquet et réactive l’extension. Rien ne s’installe tout seul en arrière-plan.",
      },
    ],
    noticeTitle: "Non signé, non isolé",
    notice:
      "Une extension importée s’exécute dans la fenêtre principale avec les privilèges de l’application, et aucune signature n’est vérifiée aujourd’hui. Spark la traite comme du code auquel vous avez choisi de faire confiance — installez ce que vous lanceriez dans un terminal.",
  },
  status: {
    eyebrow: "État",
    title: "Ce qui marche, et ce qui ne marche pas, en v0.1.0.",
    lede:
      "Une liste honnête vaut mieux qu’une grille de fonctionnalités. Voilà l’état du dépôt aujourd’hui.",
    rows: [
      {
        label: "Plateforme",
        value:
          "<strong>macOS</strong>, compilé en local. La couche PTY vise aussi Linux ; Windows n’est pas pris en charge, pont MCP compris.",
      },
      {
        label: "Compilations",
        value:
          "Signées : non. Notarisées : non. Les binaires sont non signés, macOS demande donc une confirmation au premier lancement.",
      },
      {
        label: "Téléchargement",
        value:
          "Aucun artefact de release pour l’instant. On compile depuis les sources avec Node, Rust et les outils de ligne de commande Xcode.",
      },
      {
        label: "Mises à jour",
        value: "Aucun canal de mise à jour. On récupère le dépôt et on recompile.",
      },
      {
        label: "Extensions",
        value:
          "Les paquets importés ne sont pas isolés et les signatures ne sont pas vérifiées. Les sources de dépôt sont limitées à 20.",
      },
      {
        label: "Licence",
        value:
          "Code sous MIT. Le nom et le logo relèvent d’une politique de marque séparée. Pas de CLA — un sign-off DCO.",
      },
      {
        label: "Télémétrie",
        value:
          "Aucune dans l’application. Ce site utilise Vercel Web Analytics, sans cookies.",
      },
    ],
  },
  start: {
    eyebrow: "Démarrer",
    title: "Clonez, lancez, cassez.",
    lede:
      "La seule installation possible aujourd’hui, ce sont les sources. Il faut Node 22.18+, Rust et les outils de ligne de commande Xcode.",
    steps: [
      { label: "Cloner et installer", command: "git clone https://github.com/nnnnnzo/sparkawe.git\ncd sparkawe && npm install" },
      { label: "Compiler le pont MCP", command: "npm run sidecar" },
      { label: "Lancer l’application", command: "npm run tauri -- dev" },
    ],
    note:
      "Ensuite, Réglages › Connecter un agent… pour brancher Claude Code, Codex ou un autre client MCP.",
    git: "Dépôt",
    license: "Licence",
  },
  footer: {
    tagline:
      "Un espace de travail où les personnes et les agents partagent les mêmes onglets. Fait par une seule personne, à découvert.",
    product: "Produit",
    project: "Projet",
    legal: "Légal",
    productLinks: [
      { label: "Télécharger", href: "#start" },
      { label: "Agents", href: "#agents" },
      { label: "Extensions", href: "#extensions" },
      { label: "État", href: "#status" },
    ],
    projectLinks: [
      { label: "GitHub", href: "https://github.com/nnnnnzo/sparkawe" },
      { label: "Tickets", href: "https://github.com/nnnnnzo/sparkawe/issues" },
      { label: "Architecture", href: "https://github.com/nnnnnzo/sparkawe/tree/main/doc" },
      { label: "Marque", href: "https://github.com/nnnnnzo/sparkawe/tree/main/brand" },
    ],
    legalLinks: [
      { label: "Licence", href: "/fr/licence/" },
      { label: "Marque", href: "/fr/marque/" },
      { label: "Mentions", href: "/fr/mentions/" },
    ],
    copyright: "© 2026 nnnnnzo · MIT",
    analytics: "Vercel Web Analytics · sans cookies",
  },
};
