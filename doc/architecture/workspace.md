# Espace de travail

## Modèle

```ts
interface WorkspaceState {
  version: 1;
  active: string;
  tabs: Tab[];
  pinned: string[] | null;      // null = toutes les extensions épinglées
  installedExtensions?: string[]; // ids activés/installés
  seededCore?: string[];         // socle déjà proposé à cet espace
  extensions?: Record<string, unknown>; // état sérialisé par extension
  theme: "dark" | "light" | "transparent";
}

type Mode = "side" | "tiling" | "stack";

interface Tab {
  id: string;
  name: string;
  mode: Mode;
  tiles: Tile[];
  layouts: Partial<Record<Mode, unknown>>;
  focused?: string;
}

interface Tile {
  id: string;
  type: string;
  data: Record<string, string>;
}
```

- `Tile.data` ne contient que des chaînes, pour rester sérialisable et borné.
- `WorkspaceState.extensions` est indexé par identifiant d’extension et contient ce que l’extension a sauvegardé.
- Le workspace est un document ; les paquets installés et les sources vivent séparément dans `extensions.json`.

## Modes

- **Side** : tuiles côte à côte.
- **Tiling** : disposition libre dockview, déplacement et redimensionnement.
- **Stack** : tuiles empilées.

Chaque onglet garde une disposition par mode. Le mode actif est stocké dans `Tab.mode`.

## Cycle de vie

- `seedCoreExtensions` active le socle lors d’une nouvelle installation et le propose une seule fois par espace.
- `setEnabled(false)` retire l’extension de `installedExtensions` et la désactive ; ses tuiles restent dans le workspace et leur vue devient indisponible.
- La réactivation restaure la vue ; l’état de l’extension est conservé dans `extensions`.
- Une extension importée est ajoutée par `ExtensionManager.addEntry` ; elle est activée et ajoutée à `installedExtensions`.
- Une désinstallation retire le paquet et l’id installé ; les tuiles restent dans le workspace et deviennent indisponibles.

## Identifiants

- Chaque tuile a un UUID stable.
- Le type de tuile est stable et préfixé par l’identifiant de l’extension pour les paquets importés.
- Les identifiants d’extension antérieurs au renommage Spark (`lab.*`) sont migrés vers `spark.*` au chargement.

## Journal

`src/core/journal.ts` garde 512 entrées en mémoire. Chaque entrée contient `seq`, `at`, `source` (`human`, `agent`, `system`), `kind`, éventuellement `tabId`/`tileId`/`data`.

Le journal ne remplace pas l’état : il raconte les changements. Il est borné par `summarize` (chaînes à 160 caractères, profondeur 2).

## Brief

`src/core/brief.ts` produit un résumé de l’onglet : tuiles, titres, résumés `describe`, événements récents, autres onglets. Le texte est limité à 1 400 caractères, les résumés à 120. Les événements bruyants (`tile.focus`, `tab.reorder`) sont filtrés.

## Persistance

- `workspace-v1.json` est écrit après un debounce de 180 ms.
- Les écritures sont sérialisées ; une écriture plus ancienne ne peut pas écraser une plus récente.
- En cas de reprise après un format invalide, le runtime part d’un workspace initial et marque `recovery` ; la première sauvegarde copie l’ancien fichier dans `workspace-recovery.json`.
- La fermeture de la fenêtre attend `persistence.flush()` avant de détruire la fenêtre.

Voir [la persistance](../operations/persistence.md).
