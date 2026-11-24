import type {
  ActionField,
  ActionValue,
  Command,
  Dispose,
  ServiceKey,
  SparkAPI,
  SparkExtension,
  Manifest,
  Tile,
  TileAction,
  TileDefinition,
  TileSurface,
} from "../sdk/index.ts";
import { summarize, type JournalEntry, type JournalSource } from "./journal.ts";
import type { WorkspaceRecord } from "./workspace.ts";

type Contribution<T> = T & { owner: Manifest };

export interface ActionAttribution {
  source?: JournalSource;
  agent?: string;
  op?: string;
}

export interface ActionInverseEvent {
  entry: JournalEntry | void;
  tile: Tile;
  action: string;
  snapshot: unknown;
  result: unknown;
  mutates: boolean;
  tracked: boolean;
}
const core: Manifest = {
  id: "spark.core",
  name: "Spark",
  version: "1",
};

export interface ExtensionState {
  read(id: string): unknown;
  save(id: string, value: unknown): void;
}

export interface RegistryOptions {
  record?: WorkspaceRecord;
  /** Onglet qui contient une tuile, pour attribuer un événement du journal. */
  tabForTile?: (tileId: string) => string | undefined;
  /** Reçoit l'inverse capturé d'une action mutable. */
  onAction?: (event: ActionInverseEvent) => void;
  /** Délai maximal d’une activation, en millisecondes. */
  activationTimeout?: number;
}

const ACTION_NAME = /^[a-z][a-z0-9_.-]*$/;
const MAX_RESULT = 16_000;

function register<T>(map: Map<string, T>, key: string, value: T): Dispose {
  if (map.has(key)) throw new Error(`Identifiant déjà enregistré : ${key}`);
  map.set(key, value);
  return () => {
    if (map.get(key) === value) map.delete(key);
  };
}

function validateAction(
  action: TileAction,
  input: Record<string, ActionValue>,
): Record<string, ActionValue> {
  const fields: Record<string, ActionField> = action.input ?? {};
  const expected = Object.keys(fields);
  for (const key of Object.keys(input))
    if (!(key in fields))
      throw new Error(
        `Argument inconnu : ${key}. Attendus : ${expected.join(", ") || "aucun"}.`,
      );
  const args: Record<string, ActionValue> = {};
  for (const [key, field] of Object.entries(fields)) {
    const value = input[key];
    if (value === undefined) {
      if (field.required === false) continue;
      throw new Error(`Argument manquant : ${key} (${field.type}).`);
    }
    if (typeof value !== field.type)
      throw new Error(
        `Argument invalide : ${key} doit être de type ${field.type}.`,
      );
    if (field.type === "number" && !Number.isFinite(value))
      throw new Error(`Argument invalide : ${key} doit être un nombre fini.`);
    if (field.enum && !field.enum.includes(String(value)))
      throw new Error(
        `Argument invalide : ${key} doit valoir ${field.enum.join(", ")}.`,
      );
    args[key] = value;
  }
  return args;
}

function validateDefinition(definition: TileDefinition) {
  if (
    typeof definition.guide === "string" &&
    definition.guide.length > 1200
  )
    throw new Error(`Guide trop long : ${definition.type}`);
  for (const [name, action] of Object.entries(definition.actions ?? {})) {
    if (!ACTION_NAME.test(name))
      throw new Error(`Nom d’action invalide : ${name}`);
    if (!action.title || typeof action.run !== "function")
      throw new Error(`Action incomplète : ${name}`);
    for (const [field, spec] of Object.entries(action.input ?? {})) {
      if (!/^[a-z][a-zA-Z0-9_]*$/.test(field))
        throw new Error(`Champ d’action invalide : ${name}.${field}`);
      if (!["string", "number", "boolean"].includes(spec.type))
        throw new Error(`Type de champ invalide : ${name}.${field}`);
    }
  }
}

export class Registry {
  private readonly tiles = new Map<string, Contribution<TileDefinition>>();
  private readonly surfaces = new Map<string, TileSurface>();
  private readonly commands = new Map<string, Contribution<Command>>();
  private readonly services = new Map<string, unknown>();
  private readonly listeners = new Map<string, Set<(value: never) => void>>();
  private readonly toolsListeners = new Set<() => void>();
  private readonly active = new Map<
    string,
    { extension: SparkExtension; cleanup: Dispose[]; ready: boolean }
  >();

  private readonly tabs: SparkAPI["tabs"];
  private readonly state: ExtensionState;
  private readonly journal: WorkspaceRecord;
  private readonly tabForTile: (tileId: string) => string | undefined;
  private readonly onAction?: (event: ActionInverseEvent) => void;
  private readonly activationTimeout: number;

  constructor(
    tabs: SparkAPI["tabs"],
    state: ExtensionState,
    options: RegistryOptions = {},
  ) {
    this.tabs = tabs;
    this.state = state;
    this.journal = options.record ?? (() => {});
    this.tabForTile = options.tabForTile ?? (() => undefined);
    this.onAction = options.onAction;
    this.activationTimeout = options.activationTimeout ?? 5000;
  }

  getTile = (type: string) => this.tiles.get(type);
  /** Prévient quand la liste des types de tuiles change (extension activée ou non). */
  subscribeTools = (listener: () => void) => {
    this.toolsListeners.add(listener);
    return () => {
      this.toolsListeners.delete(listener);
    };
  };
  private toolsChanged() {
    for (const listener of this.toolsListeners) listener();
  }
  getTileDefinitions = () =>
    [...this.tiles.values()].map((definition) => ({
      type: definition.type,
      title: definition.title,
      owner: definition.owner,
      actions: definition.actions,
      guide: definition.guide,
    }));
  surface = (tileId: string): TileSurface | undefined => {
    const surface = this.surfaces.get(tileId);
    return surface && { ...surface };
  };
  clearSurface = (tileId: string) => {
    this.surfaces.delete(tileId);
  };
  getAction = (type: string, name: string) =>
    this.tiles.get(type)?.actions?.[name];
  /** Une action n'est disponible que si les services qu'elle exige le sont. */
  available = (action: TileAction) =>
    (action.requires ?? []).every((key) => this.services.has(key.id));
  /** Une écriture conditionnelle devient refusée quand la tuile le décide. */
  mutates = (tile: Tile, action: TileAction) =>
    typeof action.mutates === "function"
      ? action.mutates(tile)
      : action.mutates === true;
  missing = (action: TileAction) =>
    (action.requires ?? [])
      .filter((key) => !this.services.has(key.id))
      .map((key) => key.id);
  getActions = () =>
    [...this.tiles.values()].flatMap((definition) =>
      Object.entries(definition.actions ?? {}).map(([name, action]) => ({
        tileType: definition.type,
        name,
        action,
        owner: definition.owner,
      })),
    );
  getCommands = () => [...this.commands.values()];

  /**
   * Exécute une action déclarée par une tuile. Le résultat doit rester un
   * identifiant ou un résumé : le contenu se lit par la tuile, pas par l'appel.
   */
  callAction = async (
    tileId: string,
    name: string,
    input: Record<string, ActionValue> = {},
    attribution: JournalSource | ActionAttribution = "human",
  ) => {
    const source =
      typeof attribution === "string"
        ? attribution
        : (attribution.source ?? "human");
    const agent =
      typeof attribution === "string" ? undefined : attribution.agent;
    const op = typeof attribution === "string" ? undefined : attribution.op;
    const tile = this.tabs
      .getAllTiles()
      .find((candidate) => candidate.id === tileId);
    if (!tile) throw new Error(`Tuile inconnue : ${tileId}`);
    const action = this.getAction(tile.type, name);
    if (!action) throw new Error(`Action indisponible : ${tile.type}.${name}`);
    const missing = this.missing(action);
    if (missing.length)
      throw new Error(
        `Action indisponible : ${tile.type}.${name} dépend de ${missing.join(", ")}.`,
      );
    const args = validateAction(action, input);
    const mutates = this.mutates(tile, action);
    const tracked = mutates || !!action.inverse;
    let snapshot: unknown;
    if (action.inverse) {
      try {
        snapshot = action.inverse.capture(tile, args);
      } catch (error) {
        // Une capture ratée ne doit pas empêcher l'action : elle retire la flèche.
        console.error(error);
      }
    }
    const result = await action.run(tile, args);
    const json = JSON.stringify(result ?? null);
    if (json.length > MAX_RESULT)
      throw new Error(
        `${tile.type}.${name} renvoie ${json.length} caractères. Renvoyez un identifiant plutôt que le contenu.`,
      );
    const tabId = this.tabForTile(tileId);
    const entry = this.journal({
      kind: `action:${tile.type}.${name}`,
      source,
      ...(agent ? { agent } : {}),
      ...(op ? { op } : {}),
      tileId,
      ...(tabId ? { tabId } : {}),
      data: {
        args: summarize(args),
        result: summarize(result),
        mutates,
        tracked,
      },
    });
    if (action.inverse && snapshot !== undefined)
      this.onAction?.({
        entry,
        tile,
        action: name,
        snapshot,
        result,
        mutates,
        tracked,
      });
    return result;
  };

  /** Applique une capture d'action, hors d'un nouvel appel d'outil. */
  restoreInverse = async (
    tileId: string,
    name: string,
    snapshot: unknown,
    result: unknown,
  ) => {
    const tile = this.tabs
      .getAllTiles()
      .find((candidate) => candidate.id === tileId);
    if (!tile) throw new Error(`Tuile inconnue : ${tileId}`);
    const action = this.getAction(tile.type, name);
    if (!action?.inverse)
      throw new Error(`Action sans inverse : ${tile.type}.${name}`);
    return action.inverse.restore(tile, snapshot, result);
  };
  getExtensions = () =>
    [...this.active.values()]
      .filter((record) => record.ready)
      .map((record) => record.extension.manifest);
  registerCommand = (command: Command) =>
    register(this.commands, command.id, { ...command, owner: core });
  /** Service fourni par le noyau, disponible avant l’activation des extensions. */
  registerService = (key: ServiceKey<unknown>, value: unknown) =>
    register(this.services, key.id, value);

  async activate(extension: SparkExtension) {
    const owner = extension.manifest;
    const record = { extension, cleanup: [] as Dispose[], ready: false };
    const remove = register(this.active, owner.id, record);
    let activated = false;
    let pending: { value: unknown } | undefined;
    const track = (contribute: () => Dispose) => {
      if (this.active.get(owner.id) !== record)
        throw new Error(`Extension inactive : ${owner.id}`);
      const dispose = contribute();
      record.cleanup.push(dispose);
      return dispose;
    };
    const api: SparkAPI = {
      state: {
        read: () => (pending ? pending.value : this.state.read(owner.id)),
        save: (value) => {
          if (this.active.get(owner.id) !== record) return;
          if (activated) this.state.save(owner.id, value);
          else pending = { value };
        },
      },
      tabs: this.tabs,
      tiles: {
        register: (definition) =>
          track(() => {
            validateDefinition(definition);
            const remove = register(this.tiles, definition.type, {
              ...definition,
              owner,
            });
            this.toolsChanged();
            return () => {
              remove();
              this.toolsChanged();
            };
          }),
        publish: (tileId, surface) => {
          const tile = this.tabs
            .getAllTiles()
            .find((candidate) => candidate.id === tileId);
          const definition = tile && this.tiles.get(tile.type);
          // La tuile a été fermée ou l'extension s'arrête.
          if (!tile || !definition) return;
          if (definition.owner.id !== owner.id)
            throw new Error(`Tuile d’une autre extension : ${tileId}`);
          if (
            JSON.stringify(surface).length > 2000 ||
            Object.values(surface).some((value) => typeof value !== "string")
          )
            throw new Error(
              "La surface d’une tuile est un résumé, pas un contenu.",
            );
          this.surfaces.set(tileId, { ...surface });
        },
      },
      commands: {
        register: (command) =>
          track(() =>
            register(this.commands, command.id, { ...command, owner }),
          ),
      },
      services: {
        provide: (key, value) =>
          track(() => register(this.services, key.id, value)),
        get: (key) => this.services.get(key.id) as never,
      },
      events: {
        on: (key, listener) =>
          track(() => {
            const group = this.listeners.get(key.id) ?? new Set();
            const handle = (value: never) => listener(value);
            this.listeners.set(key.id, group);
            group.add(handle);
            return () => {
              group.delete(handle);
              if (!group.size && this.listeners.get(key.id) === group)
                this.listeners.delete(key.id);
            };
          }),
        emit: (key, value) => {
          this.journal({
            kind: `event:${key.id}`,
            source: "system",
            data: summarize(value),
          });
          for (const listener of [...(this.listeners.get(key.id) ?? [])]) {
            queueMicrotask(() => {
              if (this.listeners.get(key.id)?.has(listener)) {
                try {
                  listener(value as never);
                } catch (error) {
                  console.error(error);
                }
              }
            });
          }
        },
      },
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve(extension.activate(api)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `Activation trop longue : ${owner.id} (${this.activationTimeout} ms).`,
                ),
              ),
            this.activationTimeout,
          );
        }),
      ]);
      if (pending) this.state.save(owner.id, pending.value);
      pending = undefined;
      activated = true;
      record.ready = true;
    } catch (error) {
      try {
        await extension.deactivate?.();
      } finally {
        record.cleanup.reverse().forEach((dispose) => dispose());
        remove();
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async deactivate(id: string) {
    const record = this.active.get(id);
    if (!record?.ready) return;
    record.ready = false;
    const types = new Set(
      [...this.tiles.values()]
        .filter((definition) => definition.owner.id === id)
        .map((definition) => definition.type),
    );
    for (const tile of this.tabs.getAllTiles())
      if (types.has(tile.type)) this.surfaces.delete(tile.id);
    try {
      await record.extension.deactivate?.();
    } finally {
      record.cleanup.reverse().forEach((dispose) => dispose());
      this.active.delete(id);
    }
  }
}
