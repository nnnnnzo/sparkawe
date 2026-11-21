import type { ComponentType, SVGProps } from "react";

export type Dispose = () => void;
export type Data = Record<string, string>;
export type IconComponent = ComponentType<
  SVGProps<SVGSVGElement> & { size?: number }
>;

/**
 * Niveau de garantie d'une extension. `core` désigne le socle livré et
 * maintenu avec Spark ; `official` une intégration à un service nommé ;
 * `community` est réservé aux extensions tierces.
 */
export type ExtensionTier = "core" | "official" | "community";

export interface Manifest {
  id: string;
  name: string;
  version: string;
  icon?: IconComponent;
  color?: string;
  tier?: ExtensionTier;
  tileTypes?: readonly string[];
}

export interface Tile {
  id: string;
  type: string;
  data: Data;
}

export type ActionValue = string | number | boolean;

/**
 * État volatil d'une tuile : ce qu'elle contient de sémantique à l'instant
 * présent (sélection, requête, résultat courant). Jamais persisté.
 */
export type TileSurface = Record<string, string>;

export interface ActionField {
  type: "string" | "number" | "boolean";
  description?: string;
  /** Un champ est requis par défaut. Passez false pour le rendre facultatif. */
  required?: boolean;
  enum?: readonly string[];
}

export interface TileAction {
  title: string;
  description?: string;
  input?: Record<string, ActionField>;
  /** Services dont dépend l'action : absents, elle n'est pas proposée. */
  requires?: readonly ServiceKey<unknown>[];
  /**
   * Signale une action qui modifie des données et exige une confirmation.
   * Une fonction permet de décider selon l'état de la tuile.
   */
  mutates?: boolean | ((tile: Tile) => boolean);
  run(
    tile: Tile,
    input: Record<string, ActionValue>,
  ): unknown | Promise<unknown>;
}

export interface TileDefinition {
  type: string;
  title: string;
  icon?: IconComponent;
  /** Clés de données acceptées à l'ouverture. Les autres sont refusées. */
  dataKeys?: readonly string[];
  /**
   * Mode d'emploi pour un agent, livré avec la tuile quand elle est lue.
   * Texte court : les actions, les conventions, les pièges.
   */
  guide?: string;
  prepare?(data: Data): Data;
  /** Résumé court et lisible affiché dans le brief d'un onglet. */
  describe?(tile: Tile, surface: TileSurface): string;
  actions?: Record<string, TileAction>;
  canClose?(
    tile: Tile,
    closing: ReadonlySet<string>,
  ): boolean | Promise<boolean>;
  close?(tile: Tile): void | Promise<void>;
}

export interface Command {
  id: string;
  title: string;
  icon?: IconComponent;
  category?: string;
  tileType?: string;
  keywords?: string[];
  /** N'apparaît que lorsque le mode développeur est actif. */
  dev?: boolean;
  run(): unknown | Promise<unknown>;
}

export interface ServiceKey<Service> {
  id: string;
  readonly service?: Service;
}

export interface EventKey<Value> {
  id: string;
  readonly value?: Value;
}

export interface SparkAPI {
  state: {
    read(): unknown;
    save(value: unknown): void;
  };
  tiles: {
    register(definition: TileDefinition): Dispose;
    /** Publie l'état volatil d'une tuile pour le brief et les lectures ciblées. */
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

export interface SparkExtension {
  manifest: Manifest;
  activate(api: SparkAPI): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
