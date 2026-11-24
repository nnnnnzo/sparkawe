import type { ComponentType, SVGProps } from "react";

export type Dispose = () => void;
export type Data = Record<string, string>;
export type IconComponent = ComponentType<
  SVGProps<SVGSVGElement> & { size?: number }
>;

/**
 * Texte d’interface : soit une chaîne fournie par l’extension, soit une
 * référence au dictionnaire de l’hôte. Les paquets importés utilisent des
 * chaînes ; les intégrées passent par `localized("clé")`.
 */
export type LocalizedText = string | { readonly key: string };

/**
 * Niveau de garantie d'une extension. `core` désigne le socle livré et
 * maintenu avec Spark ; `official` une intégration à un service nommé ;
 * `community` est réservé aux extensions tierces.
 */
export type ExtensionTier = "core" | "official" | "community";

export interface Manifest {
  id: string;
  name: LocalizedText;
  version: string;
  icon?: IconComponent;
  color?: string;
  tier?: ExtensionTier;
  tileTypes?: readonly string[];
  /** Résumé court affiché dans le Store. */
  summary?: LocalizedText;
  /** Description longue affichée sur la fiche. */
  description?: LocalizedText;
  /** Identifiant stable de la catégorie éditoriale du Store. */
  category?: string;
  /** Fonction de l'extension, en quelques mots factuels. */
  subtitle?: LocalizedText;
  /** Captures statiques de la tuile, dans l'ordre de la galerie. */
  screenshots?: readonly string[];
  /**
   * Sceau de distribution. `spark` signifie que le paquet est publié et
   * signé par Spark ; son absence laisse l'extension dans le régime de
   * confiance communautaire.
   */
  certification?: "spark";
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

/**
 * Inverse déclaré par une action mutable. La capture est bornée et vit avec
 * l'action dans l'historique ; la restauration reçoit aussi le résultat.
 */
export interface ActionInverse {
  capture(tile: Tile, input: Record<string, ActionValue>): unknown;
  restore(
    tile: Tile,
    snapshot: unknown,
    result: unknown,
  ): unknown | Promise<unknown>;
}

export interface TileAction {
  title: LocalizedText;
  description?: LocalizedText;
  input?: Record<string, ActionField>;
  /** Services dont dépend l'action : absents, elle n'est pas proposée. */
  requires?: readonly ServiceKey<unknown>[];
  /**
   * Signale une action qui modifie des données et exige une confirmation.
   * Une fonction permet de décider selon l'état de la tuile.
   */
  mutates?: boolean | ((tile: Tile) => boolean);
  /**
   * Comment revenir à l'état d'avant. Ignoré si l'action n'est pas mutante.
   * Une capture absente ou trop grosse retire simplement la flèche.
   */
  inverse?: ActionInverse;
  run(
    tile: Tile,
    input: Record<string, ActionValue>,
  ): unknown | Promise<unknown>;
}

export interface TileDefinition {
  type: string;
  title: LocalizedText;
  icon?: IconComponent;
  /** Clés de données acceptées à l'ouverture. Les autres sont refusées. */
  dataKeys?: readonly string[];
  /**
   * Mode d'emploi pour un agent, livré avec la tuile quand elle est lue.
   * Texte court : les actions, les conventions, les pièges.
   */
  guide?: LocalizedText;
  prepare?(data: Data): Data;
  /**
   * Nom de l’onglet quand la tuile porte un titre propre — le titre d’une page
   * web par exemple. Absent ou vide, `title` sert de repli.
   */
  tabTitle?(tile: Tile): string | undefined;
  /** Résumé court et lisible affiché dans le brief d’un onglet. */
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
  title: LocalizedText;
  icon?: IconComponent;
  category?: LocalizedText;
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
