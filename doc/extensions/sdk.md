# SDK d’extension

Contrats : `src/sdk/index.ts` (noyau) et `src/sdk/react.ts` (vues React).

## Manifeste

```ts
type LocalizedText = string | { readonly key: string };

interface Manifest {
  id: string;
  name: LocalizedText;
  version: string;
  icon?: IconComponent;      // composant Lucide pour les intégrées
  color?: string;            // teinte spectrale
  tier?: "core" | "official" | "community";
  tileTypes?: readonly string[];
  summary?: LocalizedText;
  description?: LocalizedText;
  category?: string;         // identifiant stable, traduit par le Store
  subtitle?: LocalizedText;
  screenshots?: readonly string[];
  certification?: "spark";
}
```

Les paquets importés utilisent un `extension.json` sérialisable, converti en `Manifest` côté front. Leurs champs restent des chaînes : l’hôte ne traduit pas les métadonnées d’un paquet tiers. `color` est repris tel quel et `icon` devient un composant rendu en masque, teinté par `currentColor` ; l’icône du manifeste sert aussi de repli à la barre d’onglet. `category` est un identifiant stable (`development`, `data`, `files`, `writing`, `research`, `reading` pour les intégrées), jamais un libellé traduit.

## `SparkAPI`

```ts
interface SparkAPI {
  state: {
    read(): unknown;
    save(value: unknown): void;
  };
  tiles: {
    register(definition: TileDefinition): Dispose;
    publish(tileId: string, surface: TileSurface): void;
  };
  commands: { register(command: Command): Dispose };
  services: {
    provide<Service>(key: ServiceKey<Service>, service: Service): Dispose;
    get<Service>(key: ServiceKey<Service>): Service | undefined;
  };
  events: {
    on<Value>(key: EventKey<Value>, listener: (value: Value) => void): Dispose;
    emit<Value>(key: EventKey<Value>, value: Value): void;
  };
  tabs: {
    openTile(type: string, data?: Data, alongside?: string): Tile;
    focusTile(id: string): void;
    updateTileData(id: string, data: Data): void;
    getTiles(): Tile[];
    getAllTiles(): Tile[];
    getFocusedTile(): Tile | undefined;
  };
}
```

- `state` est isolé par identifiant d’extension et sérialisé en JSON.
- `publish` alimente le brief et les lectures ciblées ; la surface est bornée à 2 000 caractères.
- `services` et `events` sont globaux au registre. Une contribution est retirée au `deactivate`.
- `tabs.openTile` applique `prepare` du type de tuile et ajoute la tuile à l’onglet demandé.

## Tuile

```ts
interface TileDefinition {
  type: string;
  title: LocalizedText;
  icon?: IconComponent;
  dataKeys?: readonly string[];
  guide?: LocalizedText;
  prepare?(data: Data): Data;
  /** Nom de l’onglet quand la tuile porte un titre propre (une page web). */
  tabTitle?(tile: Tile): string | undefined;
  describe?(tile: Tile, surface: TileSurface): string;
  actions?: Record<string, TileAction>;
  canClose?(tile: Tile, closing: ReadonlySet<string>): boolean | Promise<boolean>;
  close?(tile: Tile): void | Promise<void>;
}
```

- `dataKeys` limite les clés acceptées à l’ouverture.
- `guide` : mode d’emploi court pour un agent, **1 200 caractères maximum**, livré une fois par session. Une référence `localized(...)` est résolue dans la langue courante.
- `tabTitle` : nom affiché dans l’onglet de la tuile. Absent ou vide, `title` sert de repli ; il est relu à chaque changement de données de la tuile.
- `describe` : résumé d’une ligne pour le brief ; il ne doit pas lever.
- `canClose` : refuse une fermeture (document non enregistré).
- `close` : libère les ressources de la tuile (session, fichier, écouteur).

## Action

```ts
interface TileAction {
  title: LocalizedText;
  description?: LocalizedText;
  input?: Record<string, ActionField>;
  requires?: readonly ServiceKey<unknown>[];
  mutates?: boolean | ((tile: Tile) => boolean);
  run(tile: Tile, input: Record<string, ActionValue>): unknown | Promise<unknown>;
}
```

Règles appliquées par le registre :

- nom d’action `^[a-z][a-z0-9_.-]*$` ;
- champ `^[a-z][a-zA-Z0-9_]*$`, type `string`, `number` ou `boolean` ;
- argument inconnu, manquant ou de mauvais type refusé ;
- nombre fini, enum respecté ;
- résultat JSON **16 000 caractères maximum** ;
- action exécutée par `spark_tile_call` attribuée à `source: "agent"` ;
- `requires` : action masquée si le service est absent ;
- `mutates` : signalée au client MCP, qui décide de la confirmation.

## Commande

```ts
interface Command {
  id: string;
  title: LocalizedText;
  icon?: IconComponent;
  category?: LocalizedText;
  tileType?: string;
  keywords?: string[];
  dev?: boolean;
  run(): unknown | Promise<unknown>;
}
```

Une commande avec `tileType` apparaît dans le rail si elle est épinglée et dans la palette. Une commande `dev` n’apparaît qu’en mode développeur.

## Vue React

```ts
type TileView = React.ComponentType<{ tile: Tile; active: boolean }>;

interface ExtensionModule {
  activate(api: ExtensionAPI): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
```

`ExtensionAPI` est `SparkAPI` avec `tiles.register` enrichi de `view`. Le module retourne des vues React ; l’hôte les monte dans dockview.

Exemple minimal :

```tsx
export default function createHello(): ExtensionModule {
  return {
    activate(api) {
      api.tiles.register({
        type: "demo.hello.tile",
        title: "Hello",
        guide: "Tuile de démonstration. Aucune action.",
        view: () => <p>Hello</p>,
      });
    },
  };
}
```

## Services et événements

Un `ServiceKey<T>` et un `EventKey<T>` sont des objets `{ id }`. Les identifiants doivent être stables et préfixés.

Contrats existants :

- `terminal.open@1`, `terminal.sessions@1`, `terminal.session.closed`.
- `markdown.open@1`, `markdown.documents@1`, `markdown.document.saved`.
- `data.tables@1`, `data.charts@1`, `data.table.changed`.
- `preview.pdf@1`.
- `spark.notifications@1` : service du noyau, `send({ title, body })`, disponible même pour un paquet importé. Il passe par le plugin de notification natif ; l’appelant garde son propre repli si l’OS refuse.

Une extension peut consommer un service absent : `get` renvoie `undefined`. Une action qui le déclare dans `requires` n’est pas proposée.

## Limites et conventions

- Préfixer les types de tuiles, commandes et identifiants par l’identifiant d’extension.
- Ne jamais mettre de contenu lourd dans une surface, un brief ou un résultat d’action.
- Les guides sont des modes d’emploi, pas de la documentation marketing.
- Une vue doit être robuste : une erreur est contenue par la barrière de tuile, mais elle ne doit pas être utilisée comme contrôle de flux.
