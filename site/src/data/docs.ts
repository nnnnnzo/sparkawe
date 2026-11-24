/** Navigation de la documentation, identique dans les deux langues. */

export interface DocItem {
  /** Segment d'URL ; vide pour la page d'accueil. */
  slug: string;
  title: string;
  /** Résumé d'une ligne, aussi utilisé comme description SEO. */
  summary: string;
}

export interface DocGroup {
  title: string;
  items: readonly DocItem[];
}

export const DOC_GROUPS: Record<"en" | "fr", readonly DocGroup[]> = {
  en: [
    {
      title: "Start",
      items: [
        {
          slug: "",
          title: "How Spark works",
          summary:
            "The three objects Spark keeps apart — workspace, registry, extension manager — and the path a click takes to the disk.",
        },
        {
          slug: "build",
          title: "Build and run",
          summary:
            "Prerequisites, development commands, the checks to run before shipping, and how to rebuild the MCP bridge.",
        },
      ],
    },
    {
      title: "Under the hood",
      items: [
        {
          slug: "workspace",
          title: "Workspace",
          summary:
            "Tabs, tiles, the three layout modes, the journal, the brief and the files persisted on disk.",
        },
        {
          slug: "mcp",
          title: "MCP bridge",
          summary:
            "Connect a local agent to Spark and verify direct calls or Code Mode.",
        },
      ],
    },
    {
      title: "Extensions",
      items: [
        {
          slug: "extensions",
          title: "Extension SDK",
          summary:
            "Manifest, tile definition, typed actions, commands, services and a minimal React tile.",
        },
        {
          slug: "packages",
          title: "Packages and registries",
          summary:
            "The extension.json contract, the classic-script bundle, size limits, the install pipeline and the registry index.",
        },
      ],
    },
    {
      title: "Trust",
      items: [
        {
          slug: "trust",
          title: "Trust model",
          summary:
            "Extensions run unsandboxed. What is validated, what is only declared, and what the app never promises.",
        },
      ],
    },
  ],
  fr: [
    {
      title: "Démarrer",
      items: [
        {
          slug: "",
          title: "Comment Spark fonctionne",
          summary:
            "Les trois objets que Spark sépare — espace de travail, registre, gestionnaire d’extensions — et le chemin d’un clic jusqu’au disque.",
        },
        {
          slug: "build",
          title: "Compiler et lancer",
          summary:
            "Prérequis, commandes de développement, vérifications avant de rendre, et reconstruction du pont MCP.",
        },
      ],
    },
    {
      title: "Sous le capot",
      items: [
        {
          slug: "workspace",
          title: "Espace de travail",
          summary:
            "Onglets, tuiles, les trois modes de disposition, le journal, le brief et les fichiers persistés.",
        },
        {
          slug: "mcp",
          title: "Pont MCP",
          summary:
            "Connecter un agent local à Spark et vérifier les appels directs ou le Code Mode.",
        },
      ],
    },
    {
      title: "Extensions",
      items: [
        {
          slug: "extensions",
          title: "SDK d’extension",
          summary:
            "Manifeste, définition de tuile, actions typées, commandes, services et une tuile React minimale.",
        },
        {
          slug: "packages",
          title: "Paquets et dépôts",
          summary:
            "Le contrat extension.json, le bundle en script classique, les limites, l’installation et l’index de dépôt.",
        },
      ],
    },
    {
      title: "Confiance",
      items: [
        {
          slug: "trust",
          title: "Modèle de confiance",
          summary:
            "Les extensions s’exécutent sans sandbox. Ce qui est validé, ce qui est seulement déclaré, et ce que l’app ne promet pas.",
        },
      ],
    },
  ],
};

export function docHref(lang: "en" | "fr", slug: string): string {
  const prefix = lang === "fr" ? "/fr/docs/" : "/docs/";
  return slug ? `${prefix}${slug}/` : prefix;
}

export function docItems(lang: "en" | "fr"): DocItem[] {
  return DOC_GROUPS[lang].flatMap((group) => group.items);
}
