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

## Contenus natifs

Une tuile peut déléguer son contenu à une vue native — c’est le cas du navigateur web. Trois règles alors :

- la tuile ne rend qu’un **rectangle mesuré** (`ResizeObserver`, `resize`, `scroll`, changements de disposition) et transmet sa boîte en pixels logiques ;
- une vue native ne suit ni les animations FLIP de Dockview ni un `transform` : `src/ui/layoutSignal.ts` annonce le début et la fin d’un glissement, et la tuile masque sa vue pendant l’animation (avec son fondu) comme les autres tuiles, puis la replace exactement à la fin.
- Spark masque un onglet par `visibility` : un rectangle non nul ne suffit pas, la tuile vérifie aussi la visibilité calculée et que rien ne recouvre la page (Store, menu, dialogue) avant d’afficher quoi que ce soit. Une vue native passe au-dessus du DOM : toute couche flottante qui la chevauche la masque le temps qu’elle est ouverte. Pendant un glisser-déposer, la tuile navigateur remplace sa vue native par une image de la page (`web_snapshot`) : la page reste visible et la vignette d’onglet comme la cible de dépôt passent au-dessus. Le menu de déplacement d’une tuile échappe à la règle parce que c’est un menu du système, dessiné au-dessus de tout.

Les panneaux restent montés quand on change d’onglet, donc une vue native survit aux re-rendus ; elle est fermée avec la tuile et à la désactivation de l’extension.

## Placement d’une tuile ouverte par une autre

`src/ui/layoutPlacement.ts` transporte une demande volatile : la tuile à ouvrir et la tuile de référence. `syncPanels` la consomme en ajoutant le panneau avec `direction: "within"`, donc en onglet du même groupe, quel que soit le mode de l’espace. Rien n’entre dans `workspace-v1.json` : la place est calculée une fois, puis la disposition redevient celle de Dockview.

## Identifiants

- Chaque tuile a un UUID stable.
- Le type de tuile est stable et préfixé par l’identifiant de l’extension pour les paquets importés.
- Les identifiants d’extension antérieurs au renommage Spark (`lab.*`) sont migrés vers `spark.*` au chargement.

## Journal

`src/core/journal.ts` garde 512 entrées en mémoire. Chaque entrée contient `seq`, `at`, `source` (`human`, `agent`, `system`), `kind`, éventuellement `tabId`/`tileId`/`data`, et pour un agent :

- `agent` : identifiant de la session MCP qui a agi ;
- `op` : identifiant de l’appel d’outil, qui regroupe ses effets (ouverture, action, disposition) ;
- `activityTabId` : onglet dans lequel l’agent travaillait, même si l’effet touche une tuile d’un autre onglet.

Le journal ne remplace pas l’état : il raconte les changements. Il est borné par `summarize` (chaînes à 160 caractères, profondeur 2).

## Activité des agents

`src/core/activity.ts` projette le journal en **étapes** lisibles, regroupées par `op`. Une étape garde la session, les effets, un résumé borné et les inverses disponibles. La vue `src/ui/activity.tsx` affiche les 30 dernières étapes de l’onglet actif ; le bouton se trouve à gauche des modes de disposition.

- Une action est retenue si le registre l’a marquée `tracked` : soit elle est mutante, soit elle déclare un inverse. `mutates` ne sert qu’à la confirmation côté client MCP.
- Les ouvertures, fermetures, créations et suppressions d’onglet sont retenues ; les changements de focus ne le sont pas.
- Les déplacements et redimensionnements sont journalisés par le moteur de disposition (`layout.move`, `layout.resize`, `layout.undo`, `layout.redo`), avec la disposition d’avant et, pour un déplacement, l’ancrage précédent.
- Une étape peut être annulée : ses effets sont rejoués à l’envers, ou la disposition d’avant est restaurée. Une action fournit son inverse via `TileAction.inverse`.
- Une étape annulée joue une courte dispersion puis disparaît de la timeline et de `activity.db`. Une ligne déjà marquée annulée est retirée au chargement suivant.
- La vue groupe par jour et par session. L’icône de l’agent est sur l’en-tête du groupe, pas sur chaque ligne ; chaque ligne est indentée et porte un fil d’Ariane `onglet › objet`.
- La persistance est décrite dans [la persistance](../operations/persistence.md#activitydb). L’onglet actif charge ses étapes à la demande.
- Les instantanés trop gros sont retirés : l’action reste visible, la flèche explique pourquoi elle ne peut pas revenir en arrière.

## Brief

`src/core/brief.ts` produit un résumé de l’onglet : tuiles, titres, résumés `describe`, événements récents, autres onglets. Le texte est limité à 1 400 caractères, les résumés à 120. Les événements bruyants (`tile.focus`, `tab.reorder`) sont filtrés.

## Persistance

- `workspace-v1.json` est écrit après un debounce de 180 ms.
- Les écritures sont sérialisées ; une écriture plus ancienne ne peut pas écraser une plus récente.
- L’activité des agents vit dans `activity.db` (SQLite), séparément du document ; voir [la persistance](../operations/persistence.md#activitydb).
- En cas de reprise après un format invalide, le runtime part d’un workspace initial et marque `recovery` ; la première sauvegarde copie l’ancien fichier dans `workspace-recovery.json`.
- La fermeture de la fenêtre attend `persistence.flush()` avant de détruire la fenêtre.

Voir [la persistance](../operations/persistence.md).
