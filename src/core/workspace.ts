import type { Data, Tile } from "../sdk/index.ts";
import { t as translateNow } from "../i18n/index.ts";
import type { JournalSource } from "./journal.ts";

export type WorkspaceRecord = (record: {
  source?: JournalSource;
  kind: string;
  tabId?: string;
  tileId?: string;
  data?: unknown;
}) => void;

export type Mode = "side" | "tiling" | "stack";
export type Theme = "dark" | "light" | "transparent";
export interface Tab {
  id: string;
  name: string;
  mode: Mode;
  tiles: Tile[];
  layouts: Partial<Record<Mode, unknown>>;
  focused?: string;
}
export interface WorkspaceState {
  version: 1;
  active: string;
  tabs: Tab[];
  pinned: string[] | null;
  installedExtensions?: string[];
  /** Extensions du socle déjà proposées à cet espace. */
  seededCore?: string[];
  extensions?: Record<string, unknown>;
  theme: Theme;
}

const newTab = (
  name = translateNow("workspace.tab.default", { count: 1 }),
  mode: Mode = "side",
): Tab => ({
  id: crypto.randomUUID(),
  name,
  mode,
  tiles: [],
  layouts: {},
});

export function initialWorkspace(): WorkspaceState {
  const tab = newTab();
  return {
    version: 1,
    active: tab.id,
    tabs: [tab],
    pinned: null,
    theme: "dark",
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validTile(value: unknown): value is Tile {
  return (
    record(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    record(value.data) &&
    Object.values(value.data).every((item) => typeof item === "string")
  );
}

function validTab(value: unknown): value is Tab {
  return (
    record(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.mode === "side" ||
      value.mode === "tiling" ||
      value.mode === "stack") &&
    record(value.layouts) &&
    Array.isArray(value.tiles) &&
    value.tiles.every(validTile) &&
    (value.focused === undefined || typeof value.focused === "string")
  );
}

/** Identifiants d'extension antérieurs au renommage Spark. */
const legacyIds: Record<string, string> = {
  "lab.core": "spark.core",
  "lab.explorer": "spark.explorer",
  "lab.markdown": "spark.markdown",
  "lab.terminal": "spark.terminal",
};

const sparkId = (id: string) => legacyIds[id] ?? id;

export function restoreWorkspace(state: unknown): WorkspaceState {
  if (state === null) return initialWorkspace();
  if (
    !record(state) ||
    state.version !== 1 ||
    !Array.isArray(state.tabs) ||
    !state.tabs.length ||
    !state.tabs.every(validTab) ||
    !state.tabs.some((tab) => tab.id === state.active) ||
    (state.theme !== "dark" &&
      state.theme !== "light" &&
      state.theme !== "transparent") ||
    (state.installedExtensions !== undefined &&
      !(
        Array.isArray(state.installedExtensions) &&
        state.installedExtensions.every((id) => typeof id === "string")
      )) ||
    (state.seededCore !== undefined &&
      !(
        Array.isArray(state.seededCore) &&
        state.seededCore.every((id) => typeof id === "string")
      )) ||
    (state.extensions !== undefined && !record(state.extensions)) ||
    (state.pinned !== null &&
      !(
        Array.isArray(state.pinned) &&
        state.pinned.every((id) => typeof id === "string")
      ))
  ) {
    throw new Error(translateNow("errors.workspaceFormat"));
  }
  const tabs: Tab[] = (state.tabs as Tab[]).map((tab) => ({
    ...tab,
    tiles: tab.tiles.map((tile) =>
      tile.type === "openalex.pdf"
        ? {
            ...tile,
            type: "preview.pdf",
            data: {
              id: tile.data.work ?? "",
              title: "",
              url: tile.data.url ?? "",
            },
          }
        : tile,
    ),
  }));
  const ids = tabs.flatMap((tab) => [
    tab.id,
    ...tab.tiles.map((tile) => tile.id),
  ]);
  if (new Set(ids).size !== ids.length)
    throw new Error(translateNow("errors.workspaceDuplicateIds"));
  const installed = (state.installedExtensions as string[] | undefined)?.map(
    sparkId,
  );
  const seededCore = (state.seededCore as string[] | undefined)?.map(sparkId);
  const pinned = (state.pinned as string[] | null)?.map(sparkId);
  const extensions = state.extensions
    ? Object.fromEntries(
        Object.entries(state.extensions as Record<string, unknown>).map(
          ([id, value]) => [sparkId(id), value],
        ),
      )
    : undefined;
  return {
    ...(state as unknown as WorkspaceState),
    tabs,
    ...(installed && { installedExtensions: [...new Set(installed)] }),
    ...(seededCore && { seededCore: [...new Set(seededCore)] }),
    ...(pinned && { pinned: [...new Set(pinned)] }),
    ...(extensions && { extensions }),
  };
}

export class Workspace {
  private readonly listeners = new Set<() => void>();
  private state: WorkspaceState;
  private readonly record: WorkspaceRecord;
  /** Provenance des mutations en cours : l'interface ou un agent MCP. */
  source: JournalSource = "human";

  constructor(state: WorkspaceState, record: WorkspaceRecord = () => {}) {
    this.state = state;
    this.record = (event) => record({ ...event, source: this.source });
  }
  get = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  active = () => this.state.tabs.find((tab) => tab.id === this.state.active)!;
  patch(change: Partial<WorkspaceState>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((listener) => listener());
  }
  updateTab(id: string, change: Partial<Tab>) {
    this.patch({
      tabs: this.state.tabs.map((tab) =>
        tab.id === id ? { ...tab, ...change } : tab,
      ),
    });
  }
  activate(id: string) {
    if (
      id !== this.state.active &&
      this.state.tabs.some((tab) => tab.id === id)
    ) {
      this.patch({ active: id });
      this.record({ kind: "tab.activate", tabId: id });
    }
  }
  create(name?: string, mode?: Mode, activate = true) {
    let label = name?.trim() ?? "";
    if (!label) {
      let number = 1;
      while (
        this.state.tabs.some(
          (tab) =>
            tab.name ===
            translateNow("workspace.tab.default", { count: number }),
        )
      )
        number++;
      label = translateNow("workspace.tab.default", { count: number });
    } else if (this.state.tabs.some((tab) => tab.name === label)) {
      let number = 2;
      while (this.state.tabs.some((tab) => tab.name === `${label} ${number}`))
        number++;
      label = `${label} ${number}`;
    }
    const tab = newTab(label, mode);
    this.patch(
      activate
        ? { tabs: [...this.state.tabs, tab], active: tab.id }
        : { tabs: [...this.state.tabs, tab] },
    );
    this.record({
      kind: "tab.create",
      tabId: tab.id,
      data: { name: tab.name, mode: tab.mode },
    });
    return tab;
  }
  remove(id: string) {
    const index = this.state.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const tabs = this.state.tabs.filter((tab) => tab.id !== id);
    if (!tabs.length) tabs.push(newTab());
    this.patch({
      tabs,
      active:
        id === this.state.active
          ? tabs[Math.min(index, tabs.length - 1)].id
          : this.state.active,
    });
    this.record({ kind: "tab.remove", tabId: id });
  }
  reorder(source: string, target: string) {
    if (source === target) return;
    const tabs = [...this.state.tabs];
    const from = tabs.findIndex((tab) => tab.id === source);
    const to = tabs.findIndex((tab) => tab.id === target);
    if (from < 0 || to < 0) return;
    tabs.splice(to, 0, tabs.splice(from, 1)[0]);
    this.patch({ tabs });
    this.record({ kind: "tab.reorder", tabId: source });
  }
  tabForTile(id: string) {
    return this.state.tabs.find((tab) =>
      tab.tiles.some((tile) => tile.id === id),
    );
  }
  focusTile(id: string) {
    const tab = this.tabForTile(id);
    if (tab && tab.focused !== id) {
      this.updateTab(tab.id, { focused: id });
      this.record({ kind: "tile.focus", tabId: tab.id, tileId: id });
    }
  }
  updateTileData(id: string, data: Data) {
    const tab = this.tabForTile(id);
    if (!tab) return;
    this.updateTab(tab.id, {
      tiles: tab.tiles.map((tile) =>
        tile.id === id ? { ...tile, data } : tile,
      ),
    });
  }
  addTile(type: string, data: Data, tabId = this.state.active) {
    const tab = this.state.tabs.find(({ id }) => id === tabId);
    if (!tab) throw new Error(translateNow("errors.workspaceClosed"));
    const tile: Tile = { id: crypto.randomUUID(), type, data };
    this.updateTab(tab.id, { tiles: [...tab.tiles, tile], focused: tile.id });
    this.record({
      kind: "tile.open",
      tabId: tab.id,
      tileId: tile.id,
      data: { type },
    });
    return tile;
  }
  removeTile(tabId: string, tileId: string) {
    const tab = this.state.tabs.find((tab) => tab.id === tabId);
    if (!tab) return;
    const tiles = tab.tiles.filter((tile) => tile.id !== tileId);
    this.updateTab(tab.id, {
      tiles,
      focused: tab.focused === tileId ? tiles.at(-1)?.id : tab.focused,
    });
    this.record({
      kind: "tile.close",
      tabId,
      tileId,
      data: { type: tab.tiles.find((tile) => tile.id === tileId)?.type },
    });
  }
}
