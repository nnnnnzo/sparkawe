/**
 * Activité des agents : une projection du journal, regroupée par appel MCP.
 * Le journal raconte chaque effet ; cette couche raconte une action lisible et
 * garde ce qu'il faut pour l'annuler. Le stockage est fourni par l'appelant.
 */

import type { JournalEntry } from "./journal.ts";
import type { Tile } from "../sdk/index.ts";
import type { Mode, Tab, WorkspaceState } from "./workspace.ts";

export const ACTIVITY_PER_TAB = 30;
export const ACTIVITY_STEP_CHARS = 480_000;

export interface ActivityAgent {
  id: string;
  brand: string;
  name: string;
  version?: string;
  label: string;
  startedAt?: number;
}

export interface ActivityEntry {
  kind: string;
  at: number;
  tabId?: string;
  tileId?: string;
  data?: unknown;
}

export type LayoutSide = "left" | "right" | "top" | "bottom" | "center";

export type InverseEffect =
  | {
      type: "layoutMove";
      tile: string;
      target: string;
      side: LayoutSide;
    }
  | {
      type: "layoutResize";
      tile: string;
      width?: number;
      height?: number;
    }
  | { type: "layoutRestore"; mode: Mode; snapshot: unknown }
  | { type: "closeTile"; tile: string }
  | { type: "reopenTile"; tabId: string; tile: Tile }
  | { type: "closeTab"; tabId: string }
  | {
      type: "reopenTab";
      tab: { name: string; mode: Mode; tiles: Tile[] };
    }
  | {
      type: "action";
      tileId: string;
      tileType: string;
      action: string;
      snapshot: unknown;
      result?: unknown;
    };

export interface ActivityDetail {
  key: string;
  params?: Record<string, string | number>;
}

export interface ActivityStep {
  id: string;
  op?: string;
  at: number;
  tabId: string;
  mode?: Mode;
  kind: string;
  agent: ActivityAgent;
  entries: ActivityEntry[];
  inverse: InverseEffect[];
  detail?: ActivityDetail;
  unavailable?: string;
  revertedAt?: number;
}

export interface ActivityLoad {
  steps: unknown[];
  lastSeenAt: number;
}

export interface ActivityPersistence {
  load(tabId: string, limit: number): Promise<ActivityLoad>;
  append(step: ActivityStep): Promise<void>;
  revert(id: string, at: number): Promise<void>;
  forget(id: string): Promise<void>;
  seen(tabId: string, at: number): Promise<void>;
  clear(): Promise<void>;
}

const TRACKED = new Set([
  "layout.move",
  "layout.resize",
  "layout.undo",
  "layout.redo",
  "tile.open",
  "tile.close",
  "tab.create",
  "tab.remove",
]);

const FALLBACK_AGENT: ActivityAgent = {
  id: "agent",
  brand: "client:agent",
  name: "Agent",
  label: "Agent",
};

function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function validTile(value: unknown): value is Tile {
  const tile = object(value);
  return (
    typeof tile.id === "string" &&
    typeof tile.type === "string" &&
    typeof tile.data === "object" &&
    tile.data !== null
  );
}

function validAgent(value: unknown): value is ActivityAgent {
  const agent = object(value);
  return (
    typeof agent.id === "string" &&
    typeof agent.brand === "string" &&
    typeof agent.name === "string" &&
    typeof agent.label === "string"
  );
}

function validEntry(value: unknown): value is ActivityEntry {
  return (
    typeof object(value).kind === "string" &&
    typeof object(value).at === "number"
  );
}

function validEffect(value: unknown): value is InverseEffect {
  const effect = object(value);
  const type = effect.type;
  const mode =
    effect.mode === "side" ||
    effect.mode === "tiling" ||
    effect.mode === "stack";
  switch (type) {
    case "layoutMove":
      return (
        typeof effect.tile === "string" &&
        typeof effect.target === "string" &&
        (effect.side === "left" ||
          effect.side === "right" ||
          effect.side === "top" ||
          effect.side === "bottom" ||
          effect.side === "center")
      );
    case "layoutResize":
      return (
        typeof effect.tile === "string" &&
        (effect.width === undefined || typeof effect.width === "number") &&
        (effect.height === undefined || typeof effect.height === "number")
      );
    case "layoutRestore":
      return mode && effect.snapshot !== undefined;
    case "closeTile":
      return typeof effect.tile === "string";
    case "reopenTile":
      return typeof effect.tabId === "string" && validTile(effect.tile);
    case "closeTab":
      return typeof effect.tabId === "string";
    case "reopenTab": {
      const tab = object(effect.tab);
      return (
        typeof tab.name === "string" &&
        (tab.mode === "side" ||
          tab.mode === "tiling" ||
          tab.mode === "stack") &&
        Array.isArray(tab.tiles) &&
        tab.tiles.every(validTile)
      );
    }
    case "action":
      return (
        typeof effect.tileId === "string" &&
        typeof effect.tileType === "string" &&
        typeof effect.action === "string" &&
        effect.snapshot !== undefined
      );
    default:
      return false;
  }
}

/** Relit une étape enregistrée, en écartant tout ce qui n'a pas la bonne forme. */
export function restoreStep(value: unknown): ActivityStep | undefined {
  const step = object(value);
  if (
    typeof step.id !== "string" ||
    typeof step.at !== "number" ||
    typeof step.tabId !== "string" ||
    typeof step.kind !== "string" ||
    !validAgent(step.agent) ||
    !Array.isArray(step.entries) ||
    !Array.isArray(step.inverse)
  )
    return undefined;
  return {
    id: step.id,
    at: step.at,
    tabId: step.tabId,
    ...(step.mode === "side" || step.mode === "tiling" || step.mode === "stack"
      ? { mode: step.mode }
      : {}),
    kind: step.kind,
    agent: step.agent,
    entries: step.entries.filter(validEntry).slice(0, 24),
    inverse: step.inverse.filter(validEffect).slice(0, 24),
    ...(step.detail && typeof object(step.detail).key === "string"
      ? { detail: step.detail as ActivityDetail }
      : {}),
    ...(typeof step.unavailable === "string"
      ? { unavailable: step.unavailable }
      : {}),
    ...(typeof step.revertedAt === "number"
      ? { revertedAt: step.revertedAt }
      : {}),
  };
}

function tracked(entry: JournalEntry) {
  if (TRACKED.has(entry.kind)) return true;
  if (!entry.kind.startsWith("action:")) return false;
  const data = object(entry.data);
  // `mutates` demande une confirmation ; `tracked` raconte aussi les actions
  // qui ont un inverse sans être mutantes (une édition libre d'un agent).
  return data.tracked === true || data.mutates === true;
}

function priority(kind: string) {
  if (kind.startsWith("action:")) return 5;
  if (kind.startsWith("layout.")) return 4;
  if (kind === "tile.close") return 3;
  if (kind === "tile.open") return 2;
  return 1;
}

function actionKind(tileType: string, action: string) {
  return `action:${tileType}.${action}`;
}

function actionDetail(result: unknown): ActivityDetail | undefined {
  const value = object(result);
  if (number(value.characters) !== undefined)
    return {
      key: "activity.detail.characters",
      params: { count: number(value.characters)! },
    };
  if (number(value.appended) !== undefined)
    return {
      key: "activity.detail.rows",
      params: { count: number(value.appended)! },
    };
  if (number(value.added) !== undefined)
    return {
      key: "activity.detail.rows",
      params: { count: number(value.added)! },
    };
  if (number(value.lines) !== undefined)
    return {
      key: "activity.detail.lines",
      params: { count: number(value.lines)! },
    };
  if (text(value.name)) return { key: "activity.detail.name", params: { name: text(value.name)! } };
  if (text(value.url)) return { key: "activity.detail.url", params: { url: text(value.url)! } };
  if (number(value.rows) !== undefined && number(value.columns) !== undefined)
    return {
      key: "activity.detail.tableSize",
      params: { rows: number(value.rows)!, columns: number(value.columns)! },
    };
  return undefined;
}

function hostOf(value: string) {
  try {
    return new URL(value).host || value;
  } catch {
    return value;
  }
}

export class Activity {
  private readonly listeners = new Set<() => void>();
  private readonly agents = new Map<string, ActivityAgent>();
  private readonly steps = new Map<string, ActivityStep[]>();
  private readonly seen = new Map<string, number>();
  private readonly loaded = new Set<string>();
  private readonly loading = new Set<string>();
  private readonly pending = new Set<number>();
  private readonly writes = new Set<Promise<void>>();
  private revision = 0;

  private readonly persistence?: ActivityPersistence;
  private readonly onError: (error: unknown) => void;

  constructor(
    persistence?: ActivityPersistence,
    onError: (error: unknown) => void = (error) => console.error(error),
  ) {
    this.persistence = persistence;
    this.onError = onError;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  /** Instantané stable pour `useSyncExternalStore`. */
  version = () => this.revision;
  private notify() {
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }

  registerAgent(agent: ActivityAgent) {
    this.agents.set(agent.id, agent);
  }

  stepsFor(tabId: string): readonly ActivityStep[] {
    return this.steps.get(tabId) ?? [];
  }

  seenAt(tabId: string) {
    return this.seen.get(tabId) ?? 0;
  }

  unread(tabId: string) {
    return (this.stepsFor(tabId)[0]?.at ?? 0) > this.seenAt(tabId);
  }

  has(tabId: string) {
    return this.loaded.has(tabId) || this.loading.has(tabId);
  }

  async ensure(tabId: string) {
    if (this.loaded.has(tabId) || this.loading.has(tabId) || !this.persistence)
      return;
    this.loading.add(tabId);
    try {
      const loaded = await this.persistence.load(tabId, ACTIVITY_PER_TAB);
      const persisted = loaded.steps
        .map(restoreStep)
        .filter((step): step is ActivityStep => !!step);
      const current = this.steps.get(tabId) ?? [];
      const merged = new Map<string, ActivityStep>();
      for (const step of persisted) merged.set(step.id, step);
      // Une étape créée pendant le chargement est plus fraîche que la DB.
      for (const step of current) merged.set(step.id, step);
      this.steps.set(
        tabId,
        [...merged.values()]
          .sort((left, right) => right.at - left.at)
          .slice(0, ACTIVITY_PER_TAB),
      );
      if (!this.seen.has(tabId))
        this.seen.set(tabId, Math.max(0, loaded.lastSeenAt));
      this.loaded.add(tabId);
      this.notify();
    } catch (error) {
      this.onError(error);
    } finally {
      this.loading.delete(tabId);
    }
  }

  /** Point d'entrée : le journal attribue chaque effet à un appel et une session. */
  record = (entry: JournalEntry) => {
    if (entry.source !== "agent" || !tracked(entry)) return;
    const data = object(entry.data);
    const tabId =
      text(data.activityTabId) ?? entry.activityTabId ?? entry.tabId;
    if (!tabId) return;
    const agent =
      (entry.agent ? this.agents.get(entry.agent) : undefined) ??
      FALLBACK_AGENT;
    const list = this.steps.get(tabId) ?? [];
    let step = entry.op
      ? list.find((candidate) => candidate.op === entry.op)
      : undefined;
    if (!step) {
      step = {
        id: entry.op ?? `seq:${entry.seq}`,
        ...(entry.op ? { op: entry.op } : {}),
        at: entry.at,
        tabId,
        kind: entry.kind,
        agent,
        entries: [],
        inverse: [],
      };
      list.unshift(step);
    }
    if (!step.entries.some((candidate) => candidate.at === entry.at && candidate.kind === entry.kind))
      step.entries.push({
        kind: entry.kind,
        at: entry.at,
        ...(entry.tabId ? { tabId: entry.tabId } : {}),
        ...(entry.tileId ? { tileId: entry.tileId } : {}),
        ...(entry.data === undefined ? {} : { data: entry.data }),
      });
    if (entry.kind.startsWith("action:")) {
      const result = object(entry.data).result;
      step.detail = actionDetail(result) ?? step.detail;
    }
    if (data.mode === "side" || data.mode === "tiling" || data.mode === "stack")
      step.mode = data.mode;
    this.addLifecycle(step, entry);
    step.kind =
      step.entries
        .map((candidate) => candidate.kind)
        .sort((left, right) => priority(right) - priority(left))[0] ?? step.kind;
    this.steps.set(
      tabId,
      list.sort((left, right) => right.at - left.at).slice(0, ACTIVITY_PER_TAB),
    );
    this.schedule(step);
    this.notify();
  };

  private addLifecycle(step: ActivityStep, entry: JournalEntry) {
    const data = object(entry.data);
    if (entry.kind === "tile.open" && entry.tileId) {
      step.inverse.push({ type: "closeTile", tile: entry.tileId });
      return;
    }
    if (entry.kind === "tile.close" && validTile(data.tile)) {
      step.inverse.push({
        type: "reopenTile",
        tabId: entry.tabId ?? step.tabId,
        tile: data.tile,
      });
      return;
    }
    if (entry.kind === "tab.create") {
      step.inverse.push({ type: "closeTab", tabId: entry.tabId ?? step.tabId });
      return;
    }
    if (entry.kind === "tab.remove" && Array.isArray(data.tiles)) {
      const tab = {
        name: text(data.name) ?? "Tab",
        mode:
          data.mode === "side" || data.mode === "tiling" || data.mode === "stack"
            ? data.mode
            : ("side" as Mode),
        tiles: data.tiles.filter(validTile),
      };
      if (tab.tiles.length)
        step.inverse.push({ type: "reopenTab", tab });
    }
  }

  /** Le moteur ajoute l'instantané de disposition après avoir appliqué la commande. */
  attachLayout = (
    entry: JournalEntry | void,
    info: {
      mode: Mode;
      before: unknown;
      from?: { target: string; side: LayoutSide } | null;
      resize?: { width?: number; height?: number };
    },
  ) => {
    if (!entry) return;
    const step = this.find(entry);
    if (!step) return;
    step.mode = info.mode;
    if (info.from)
      step.inverse.push({
        type: "layoutMove",
        tile: text(object(entry.data).tile) ?? entry.tileId ?? "",
        target: info.from.target,
        side: info.from.side,
      });
    if (info.resize)
      step.inverse.push({
        type: "layoutResize",
        tile: text(object(entry.data).tile) ?? entry.tileId ?? "",
        width: info.resize.width,
        height: info.resize.height,
      });
    step.inverse.push({
      type: "layoutRestore",
      mode: info.mode,
      snapshot: info.before,
    });
    this.schedule(step);
    this.notify();
  };

  /** Le registre ajoute la capture fournie par une action mutable. */
  attachAction = (event: {
    entry: JournalEntry | void;
    tile: Tile;
    action: string;
    snapshot: unknown;
    result: unknown;
    mutates: boolean;
    tracked: boolean;
  }) => {
    if (!event.entry || event.snapshot === undefined) return;
    const step = this.find(event.entry);
    if (!step) return;
    step.inverse.push({
      type: "action",
      tileId: event.tile.id,
      tileType: event.tile.type,
      action: event.action,
      snapshot: event.snapshot,
      result: event.result,
    });
    this.schedule(step);
    this.notify();
  };

  private find(entry: JournalEntry) {
    const tabId =
      text(object(entry.data).activityTabId) ??
      entry.activityTabId ??
      entry.tabId;
    if (!tabId) return undefined;
    const list = this.steps.get(tabId) ?? [];
    return entry.op
      ? list.find((step) => step.op === entry.op)
      : list.find((step) => step.id === `seq:${entry.seq}`);
  }

  markSeen(tabId: string) {
    const at = this.stepsFor(tabId)[0]?.at;
    if (!at || at <= this.seenAt(tabId)) return;
    this.seen.set(tabId, at);
    if (this.persistence)
      this.track(this.persistence.seen(tabId, at));
    this.notify();
  }

  markReverted(step: ActivityStep) {
    if (step.revertedAt) return;
    step.revertedAt = Date.now();
    if (this.persistence)
      this.track(this.persistence.revert(step.id, step.revertedAt));
    this.notify();
  }

  /** Efface une étape annulée, une fois son animation terminée. */
  async forget(id: string) {
    for (const [tabId, list] of this.steps) {
      const next = list.filter((step) => step.id !== id);
      if (next.length !== list.length) this.steps.set(tabId, next);
    }
    this.notify();
    if (!this.persistence) return;
    try {
      await this.persistence.forget(id);
    } catch (error) {
      this.onError(error);
    }
  }

  async clear() {
    this.steps.clear();
    this.seen.clear();
    this.loaded.clear();
    this.notify();
    if (!this.persistence) return;
    try {
      await this.persistence.clear();
    } catch (error) {
      this.onError(error);
    }
  }

  private schedule(step: ActivityStep) {
    const id = (this.revision + 1) * 1_000_003 + this.pending.size;
    this.pending.add(id);
    queueMicrotask(() => {
      this.pending.delete(id);
      void this.persist(step);
    });
  }

  private async persist(step: ActivityStep) {
    if (!this.persistence) return;
    let payload: string;
    try {
      payload = JSON.stringify(step);
    } catch (error) {
      this.onError(error);
      step.inverse = [];
      step.unavailable = "activity.reason.noInverse";
      this.notify();
      return;
    }
    if (payload.length > ACTIVITY_STEP_CHARS) {
      // Un instantané trop gros ne doit pas empêcher de raconter l'action.
      step.inverse = step.inverse.map((effect) =>
        "snapshot" in effect
          ? { ...effect, snapshot: undefined, result: undefined }
          : effect,
      );
      step.inverse = step.inverse.filter(
        (effect) => effect.type !== "action" || effect.snapshot !== undefined,
      );
      step.unavailable = "activity.reason.large";
      try {
        payload = JSON.stringify(step);
      } catch (error) {
        this.onError(error);
        step.inverse = [];
        this.notify();
        return;
      }
      this.notify();
      if (payload.length > ACTIVITY_STEP_CHARS) return;
    }
    const write = this.persistence.append(step);
    this.writes.add(write);
    try {
      await write;
    } catch (error) {
      this.onError(error);
    } finally {
      this.writes.delete(write);
    }
  }

  private track(write: Promise<void>) {
    this.writes.add(write);
    void write
      .catch((error) => this.onError(error))
      .finally(() => this.writes.delete(write));
    return write;
  }

  async flush() {
    // Laisse partir les écritures programmées dans la même tâche.
    await Promise.resolve();
    while (this.writes.size)
      await Promise.allSettled([...this.writes]);
  }
}

/** Titre de l'onglet qui porte une étape, ou repli lisible. */
export function stepTab(state: WorkspaceState, step: ActivityStep): Tab | undefined {
  return state.tabs.find((tab) => tab.id === step.tabId);
}

/** Adresse lisible pour un détail d'action Web. */
export function activityHost(url: unknown) {
  return typeof url === "string" ? hostOf(url) : undefined;
}

export { actionKind };
