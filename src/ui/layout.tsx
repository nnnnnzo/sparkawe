import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
  type SerializedDockview,
} from "dockview-react";
import { Blocks, Ellipsis, LayoutGrid, Plus, X } from "lucide-react";
import {
  Component,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { Runtime } from "../app/runtime.ts";
import type { Tile } from "../sdk/index.ts";
import type { Locale } from "../core/i18n.ts";
import { text as resolveLocalized, t as translateNow } from "../i18n/index.ts";
import { useI18n } from "../i18n/react.ts";
import { report } from "./errors.ts";
import type { Tab, WorkspaceState } from "../core/workspace.ts";
import { registerLayoutHandler } from "./layoutBridge.ts";
import { Button } from "@spark/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@spark/ui/components/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@spark/ui/components/empty";
import { Icon } from "./icons.tsx";
import { SparkMark } from "../shared/brand/index.tsx";

const sideMinimum = 220;
const dockTheme = {
  name: "spark",
  className: "spark-dock",
  gap: 10,
  dndOverlayBorder: "1px solid var(--ring)",
};
interface LayoutContext {
  runtime: Runtime;
  tab: Tab;
  mounts: Map<string, HTMLDivElement>;
}
const context = createContext<LayoutContext | null>(null);

function Panel({ api }: IDockviewPanelProps) {
  const { mounts } = useContext(context)!;
  const ref = useRef<HTMLDivElement>(null);
  const target = mounts.get(api.id);
  useLayoutEffect(() => {
    const host = ref.current!;
    if (!target) return;
    host.append(target);
    return () => {
      if (target.parentNode === host) target.remove();
    };
  }, [target]);
  return <div className="tile-host" data-tile-id={api.id} ref={ref} />;
}

class TileBoundary extends Component<
  { runtime: Runtime; tile: Tile; children: ReactNode; locale: Locale },
  { error?: Error }
> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info);
  }

  private retry = () => this.setState({ error: undefined });

  render() {
    if (!this.state.error) return this.props.children;
    const owner = this.props.runtime.registry.getTile(
      this.props.tile.type,
    )?.owner;
    return (
      <div className="tile-error" role="alert">
        <p className="tile-error-title">
          {translateNow("layout.tile.error.title")}
        </p>
        <p className="tile-error-detail">
          {this.state.error.message || String(this.state.error)}
        </p>
        <div className="tile-error-actions">
          <Button size="sm" variant="outline" onClick={this.retry}>
            {translateNow("layout.tile.error.retry")}
          </Button>
          {owner && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void this.props.runtime.extensions
                  .setEnabled(owner.id, false)
                  .catch(report)
              }
            >
              {translateNow("layout.tile.error.disable", {
                name: resolveLocalized(owner.name),
              })}
            </Button>
          )}
        </div>
      </div>
    );
  }
}

const directionKeys = {
  left: "layout.direction.left",
  right: "layout.direction.right",
  top: "layout.direction.top",
  bottom: "layout.direction.bottom",
  center: "layout.direction.center",
} as const;

function PanelTab({ api, containerApi }: IDockviewPanelHeaderProps) {
  const { tab, runtime } = useContext(context)!;
  const { t, text } = useI18n();
  const tile = tab.tiles.find((tile) => tile.id === api.id);
  const definition = tile && runtime.registry.getTile(tile.type);
  const title = definition
    ? text(definition.title)
    : (api.title ?? t("layout.tile.unavailable"));
  const close = () =>
    void runtime
      .closeTiles([api.id], () => runtime.workspace.removeTile(tab.id, api.id))
      .catch(report);
  const targets = containerApi.panels.filter((panel) => panel.id !== api.id);
  return (
    <span className="dock-tab">
      <Icon glyph={definition?.icon} extension={definition?.owner} />
      <span className="truncate" title={title}>
        {title}
      </span>
      {tab.mode === "tiling" && targets.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              title={t("layout.tile.move")}
              aria-label={t("layout.tile.move.aria", { name: title })}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Ellipsis data-icon="inline-start" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuGroup>
              {Object.entries(directionKeys).map(([position, key]) => (
                <DropdownMenuItem
                  key={position}
                  onSelect={() => {
                    const group =
                      targets.find((panel) => panel.group !== api.group)
                        ?.group ?? targets[0].group;
                    api.moveTo({
                      group,
                      position: position as keyof typeof directionKeys,
                    });
                  }}
                >
                  {t(key)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Button
        variant="ghost"
        size="icon"
        title={t("layout.tile.close")}
        aria-label={t("layout.tile.close.aria", { name: title })}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          close();
        }}
      >
        <X data-icon="inline-start" />
      </Button>
    </span>
  );
}
const components = { tile: Panel };
const tabComponents = { tile: PanelTab };
const Watermark = () => null;

/**
 * La tuile qui offre le plus de place. En tiling, on la coupe en deux plutôt
 * que de couper la dernière arrivée : les tuiles restent larges au lieu de
 * finir en bandes de plus en plus étroites.
 */
function largestGroup(api: DockviewApi) {
  let best = api.groups[0];
  let bestArea = -1;
  for (const group of api.groups) {
    const rect = group.element.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) {
      best = group;
      bestArea = area;
    }
  }
  return best;
}

function tilingPosition(api: DockviewApi) {
  const group = largestGroup(api);
  if (!group) return undefined;
  const rect = group.element.getBoundingClientRect();
  const panel = group.activePanel ?? group.panels[0];
  if (!panel) return undefined;
  return {
    referencePanel: panel,
    direction:
      rect.width >= rect.height ? ("right" as const) : ("below" as const),
  };
}

function syncPanels(
  api: DockviewApi,
  tab: Tab,
  runtime: Runtime,
  beforeMutate?: () => void,
  afterMutate?: () => void,
) {
  const ids = new Set(tab.tiles.map((tile) => tile.id));
  for (const panel of api.panels) {
    if (!ids.has(panel.id)) {
      beforeMutate?.();
      try {
        api.removePanel(panel);
      } finally {
        afterMutate?.();
      }
    }
  }
  for (const tile of tab.tiles) {
    if (api.getPanel(tile.id)) continue;
    const last = api.panels.at(-1);
    let position;
    if (tab.mode === "tiling") {
      position = tilingPosition(api);
    } else {
      const ref = tab.mode === "side" ? last : (api.activePanel ?? last);
      position = ref
        ? {
            referencePanel: ref,
            direction:
              tab.mode === "stack" ? ("below" as const) : ("right" as const),
          }
        : undefined;
    }
    beforeMutate?.();
    try {
      api.addPanel({
        id: tile.id,
        component: "tile",
        tabComponent: "tile",
        title: runtime.registry.getTile(tile.type)
          ? resolveLocalized(runtime.registry.getTile(tile.type)!.title)
          : translateNow("layout.tile.unavailable"),
        position,
        minimumWidth: tab.mode === "side" ? sideMinimum : 120,
        minimumHeight: 84,
      });
    } finally {
      afterMutate?.();
    }
  }
  if (tab.focused) api.getPanel(tab.focused)?.api.setActive();
}

/**
 * FLIP sur les groupes : quand une tuile se déplace ou qu'une autre doit lui
 * laisser la place, le groupe glisse vers sa nouvelle position. Le
 * redimensionnement par poignée n'est pas une mutation structurelle et reste
 * donc direct.
 */
function animateGroupMovement(api: DockviewApi, enabled: () => boolean) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let before: Map<string, DOMRect> | undefined;
  let frame: number | undefined;
  const running = new Set<Animation>();
  const timers = new Set<number>();
  const frameDuration = 220;
  const will = api.onWillMutateLayout(() => {
    // Une mutation peut arriver pendant une animation précédente : on la
    // termine avant de mesurer, sinon le delta part d'une position déjà
    // transformée et les tuiles sautent.
    for (const animation of running) animation.finish();
    running.clear();
    // Ajouter ou retirer une tuile est structurel : on pose la nouvelle
    // disposition d'un coup, sans faire glisser puis réapparaître les autres.
    if (!enabled() || before || reduced.matches) return;
    before = new Map();
    for (const group of api.groups) {
      const element = group.element.parentElement ?? group.element;
      before.set(group.id, element.getBoundingClientRect());
    }
  });
  const did = api.onDidMutateLayout(() => {
    if (!before || frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      const previous = before ?? new Map<string, DOMRect>();
      before = undefined;
      frame = undefined;
      const movements: {
        element: Element;
        groupElement: Element;
        panels: Set<string>;
        dx: number;
        dy: number;
      }[] = [];
      for (const group of api.groups) {
        const from = previous.get(group.id);
        if (!from) continue;
        const element = group.element.parentElement ?? group.element;
        const rect = element.getBoundingClientRect();
        const dx = from.left - rect.left;
        const dy = from.top - rect.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        movements.push({
          element,
          groupElement: group.element,
          panels: new Set(group.panels.map((panel) => panel.id)),
          dx,
          dy,
        });
      }
      if (!movements.length) return;
      for (const movement of movements) {
        const animation = movement.element.animate(
          [
            { transform: `translate(${movement.dx}px, ${movement.dy}px)` },
            { transform: "translate(0px, 0px)" },
          ],
          {
            duration: frameDuration,
            easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
          },
        );
        running.add(animation);
        animation.finished
          .catch(() => {})
          .finally(() => running.delete(animation));
      }
      // Le contenu des tuiles vit dans des overlays séparés. On les masque
      // pendant le glissement, on répare leur boîte à la fin (Dockview peut
      // avoir échantillonné une position intermédiaire du cadre), puis on les
      // fait revenir en fondu à la bonne place.
      const root =
        (api.groups[0]?.element.closest(".dv-shell") as Element | null) ??
        document.body;
      const repairs: { content: Element; overlays: Element[] }[] = [];
      for (const movement of movements) {
        const content = movement.groupElement.querySelector(
          ":scope > .dv-content-container",
        );
        const overlays = [
          ...root.querySelectorAll(".dv-render-overlay"),
        ].filter((overlay) => {
          const tileId = overlay
            .querySelector("[data-tile-id]")
            ?.getAttribute("data-tile-id");
          return typeof tileId === "string" && movement.panels.has(tileId);
        });
        if (!content || !overlays.length) continue;
        repairs.push({ content, overlays });
        for (const overlay of overlays) {
          overlay.animate(
            [
              { opacity: 0, offset: 0 },
              { opacity: 0, offset: 0.82 },
              { opacity: 1, offset: 1 },
            ],
            { duration: 340, easing: "linear" },
          );
        }
      }
      if (!repairs.length) return;
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        const shell = root.getBoundingClientRect();
        for (const { content, overlays } of repairs) {
          const rect = content.getBoundingClientRect();
          for (const overlay of overlays) {
            const element = overlay as HTMLElement;
            element.style.left = `${rect.left - shell.left}px`;
            element.style.top = `${rect.top - shell.top}px`;
            element.style.width = `${rect.width}px`;
            element.style.height = `${rect.height}px`;
          }
        }
      }, frameDuration + 20);
      timers.add(timer);
    });
  });
  return () => {
    will.dispose();
    did.dispose();
    if (frame !== undefined) cancelAnimationFrame(frame);
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
  };
}

function Engine({
  tab,
  runtime,
  active,
}: {
  tab: Tab;
  runtime: Runtime;
  active: boolean;
}) {
  const [api, setApi] = useState<DockviewApi>();
  const live = useRef(tab);
  const updating = useRef(false);
  const skipAnimation = useRef(false);
  const host = useRef<HTMLDivElement>(null);
  const { t, text, locale } = useI18n();
  live.current = tab;
  function ready(event: DockviewReadyEvent) {
    const saved = tab.layouts[tab.mode];
    if (saved) {
      try {
        event.api.fromJSON(saved as SerializedDockview);
      } catch {
        event.api.clear();
      }
    }
    syncPanels(event.api, tab, runtime);
    setApi(event.api);
  }
  useEffect(() => {
    if (!api) return;
    for (const panel of api.panels) {
      const tile = live.current.tiles.find((item) => item.id === panel.id);
      const definition = tile && runtime.registry.getTile(tile.type);
      panel.api.setTitle(
        definition ? text(definition.title) : t("layout.tile.unavailable"),
      );
    }
  }, [api, locale, runtime, t, text, tab.tiles]);
  useEffect(() => {
    if (!api) return;
    const persist = () => {
      const current = runtime.workspace
        .get()
        .tabs.find((item) => item.id === tab.id);
      if (!current || current.mode !== tab.mode || updating.current) return;
      const serialized = api.toJSON();
      if (
        JSON.stringify(current.layouts[tab.mode]) !== JSON.stringify(serialized)
      ) {
        runtime.workspace.updateTab(tab.id, {
          layouts: { ...current.layouts, [tab.mode]: serialized },
        });
      }
    };
    const layout = api.onDidLayoutChange(persist);
    const focus = api.onDidActivePanelChange(({ panel }) => {
      if (!active || !panel || updating.current) return;
      const current = runtime.workspace
        .get()
        .tabs.find((item) => item.id === tab.id);
      if (
        current?.mode === tab.mode &&
        current.focused !== panel.id &&
        current.tiles.some((tile) => tile.id === panel.id)
      ) {
        runtime.workspace.updateTab(tab.id, { focused: panel.id });
      }
    });
    persist();
    return () => {
      layout.dispose();
      focus.dispose();
    };
  }, [api, runtime, tab.id, tab.mode, active]);
  useEffect(() => {
    if (!api || !active) return;
    return registerLayoutHandler((command) => {
      if (command.type === "undo" || command.type === "redo") {
        if (!historyControls.current)
          throw new Error(translateNow("layout.error.history"));
        if (command.type === "undo") historyControls.current.undo();
        else historyControls.current.redo();
        return;
      }
      if (command.type === "move") {
        const moving = api.getPanel(command.tile);
        const target = api.getPanel(command.target);
        if (!moving)
          throw new Error(
            translateNow("layout.error.missing", { id: command.tile }),
          );
        if (!target)
          throw new Error(
            translateNow("layout.error.targetMissing", { id: command.target }),
          );
        if (moving === target)
          throw new Error(translateNow("layout.error.selfMove"));
        moving.api.moveTo({
          group: target.group,
          position: command.side,
          skipSetActive: true,
        });
        return;
      }
      const panel = api.getPanel(command.tile);
      if (!panel)
        throw new Error(
          translateNow("layout.error.missing", { id: command.tile }),
        );
      const element = host.current;
      if (!element)
        throw new Error(translateNow("layout.error.tabUnavailable"));
      const size: { width?: number; height?: number } = {};
      if (command.width !== undefined)
        size.width = Math.max(
          120,
          Math.round(element.clientWidth * command.width),
        );
      if (command.height !== undefined)
        size.height = Math.max(
          84,
          Math.round(element.clientHeight * command.height),
        );
      if (size.width === undefined && size.height === undefined)
        throw new Error(translateNow("layout.error.size"));
      panel.group.api.setSize(size);
    });
  }, [api, active]);

  const historyControls = useRef<
    { undo: () => void; redo: () => void } | undefined
  >(undefined);

  useEffect(() => {
    if (!api || !active) return;
    const state = {
      past: [api.toJSON()] as SerializedDockview[],
      future: [] as SerializedDockview[],
      applying: false,
      timer: undefined as number | undefined,
      release: undefined as number | undefined,
    };
    const samePanels = () => {
      const panels = api.panels
        .map((panel) => panel.id)
        .sort()
        .join(",");
      const tiles = live.current.tiles
        .map((tile) => tile.id)
        .sort()
        .join(",");
      return panels === tiles;
    };
    const flush = () => {
      if (state.timer !== undefined) {
        window.clearTimeout(state.timer);
        state.timer = undefined;
      }
      if (state.applying) return;
      const serialized = api.toJSON();
      // Une ouverture ou une fermeture de tuile remet l'historique à zéro :
      // annuler ne doit jamais ressusciter une tuile absente du workspace.
      if (!samePanels()) {
        state.past = [serialized];
        state.future = [];
        return;
      }
      const last = state.past[state.past.length - 1];
      if (last && JSON.stringify(last) === JSON.stringify(serialized)) return;
      state.past.push(serialized);
      if (state.past.length > 50) state.past.shift();
      state.future = [];
    };
    const schedule = () => {
      if (state.applying) return;
      if (state.timer !== undefined) window.clearTimeout(state.timer);
      state.timer = window.setTimeout(flush, 250);
    };
    const restore = (snapshot: SerializedDockview) => {
      state.applying = true;
      if (state.timer !== undefined) {
        window.clearTimeout(state.timer);
        state.timer = undefined;
      }
      try {
        api.fromJSON(snapshot, { reuseExistingPanels: true });
      } finally {
        // Le changement de disposition arrive de façon asynchrone : on ignore
        // les événements le temps qu'il retombe, sinon il vide la pile redo.
        if (state.release !== undefined) window.clearTimeout(state.release);
        state.release = window.setTimeout(() => {
          state.applying = false;
        }, 300);
      }
    };
    const undo = () => {
      flush();
      if (state.past.length < 2) return;
      const current = state.past.pop()!;
      state.future.push(current);
      restore(state.past[state.past.length - 1]);
    };
    const redo = () => {
      const next = state.future.pop();
      if (!next) return;
      state.past.push(next);
      restore(next);
    };
    historyControls.current = { undo, redo };
    const changed = api.onDidLayoutChange(schedule);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable='true'], .cm-editor, .xterm",
        )
      )
        return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (!event.metaKey && event.ctrlKey && key === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      changed.dispose();
      window.removeEventListener("keydown", onKeyDown);
      if (state.timer !== undefined) window.clearTimeout(state.timer);
      if (state.release !== undefined) window.clearTimeout(state.release);
      if (historyControls.current?.undo === undo)
        historyControls.current = undefined;
    };
  }, [api, active]);

  useEffect(() => {
    if (!api) return;
    return animateGroupMovement(api, () => !skipAnimation.current);
  }, [api]);

  useLayoutEffect(() => {
    if (!api) return;
    updating.current = true;
    try {
      syncPanels(
        api,
        live.current,
        runtime,
        () => {
          skipAnimation.current = true;
        },
        () => {
          skipAnimation.current = false;
        },
      );
    } finally {
      updating.current = false;
    }
    const current = runtime.workspace
      .get()
      .tabs.find((item) => item.id === tab.id);
    const serialized = api.toJSON();
    if (
      current?.mode === tab.mode &&
      JSON.stringify(current.layouts[tab.mode]) !== JSON.stringify(serialized)
    ) {
      runtime.workspace.updateTab(tab.id, {
        layouts: { ...current.layouts, [tab.mode]: serialized },
      });
    }
  }, [api, runtime, tab.id, tab.mode, tab.tiles, tab.focused]);

  return (
    <div className="layout-scroll">
      <div
        className="layout-engine"
        ref={host}
        style={{
          minWidth:
            tab.mode === "side"
              ? tab.tiles.length * sideMinimum +
                (tab.tiles.length - 1) * dockTheme.gap
              : undefined,
        }}
      >
        <DockviewReact
          theme={dockTheme}
          dndStrategy="pointer"
          components={components}
          tabComponents={tabComponents}
          onReady={ready}
          watermarkComponent={Watermark}
          disableFloatingGroups
          defaultRenderer="always"
        />
      </div>
    </div>
  );
}

export function WorkspaceLayout({
  runtime,
  state,
  palette,
  shortcut,
  manageExtensions,
  hasTileCommands,
}: {
  runtime: Runtime;
  state: WorkspaceState;
  palette: () => void;
  shortcut: string;
  manageExtensions: () => void;
  hasTileCommands: boolean;
}) {
  const [mounts] = useState(() => new Map<string, HTMLDivElement>());
  const { t, locale } = useI18n();
  const tab = state.tabs.find((tab) => tab.id === state.active)!;
  const tiles = state.tabs.flatMap((item) => item.tiles);
  for (const tile of tiles) {
    if (!mounts.has(tile.id)) {
      const element = document.createElement("div");
      element.className = "tile-root";
      mounts.set(tile.id, element);
    }
  }
  useEffect(() => {
    const retained = new Set(tiles.map((tile) => tile.id));
    for (const [id, element] of mounts) {
      if (!retained.has(id)) {
        element.remove();
        mounts.delete(id);
      }
    }
  }, [tiles, mounts]);
  return (
    <main
      className="layout-area"
      role="tabpanel"
      id={`panel-${tab.id}`}
      aria-labelledby={`tab-${tab.id}`}
    >
      {tiles.map((tile) => {
        const View = runtime.views.get(tile.type);
        return createPortal(
          View ? (
            <TileBoundary runtime={runtime} tile={tile} locale={locale}>
              <View tile={tile} active={tab.tiles.includes(tile)} />
            </TileBoundary>
          ) : (
            <p className="tile-message">
              {t("layout.tile.unavailable.message")}
            </p>
          ),
          mounts.get(tile.id)!,
          tile.id,
        );
      })}
      {state.tabs.map((item) =>
        item.tiles.length ? (
          <div
            key={`${item.id}:${item.mode}`}
            className={
              item.id === tab.id ? "layout-pane is-active" : "layout-pane"
            }
            aria-hidden={item.id !== tab.id}
            inert={item.id !== tab.id}
          >
            <context.Provider value={{ runtime, tab: item, mounts }}>
              <Engine
                tab={item}
                runtime={runtime}
                active={item.id === tab.id}
              />
            </context.Provider>
          </div>
        ) : null,
      )}
      {tab.tiles.length === 0 && (
        <Empty className="layout-empty">
          <SparkMark variant="mono" className="spark-empty-mark" />
          <EmptyHeader>
            <EmptyMedia variant="icon" aria-hidden>
              <LayoutGrid strokeWidth={1.5} />
            </EmptyMedia>
            <EmptyTitle role="heading" aria-level={2}>
              {t("layout.empty.title")}
            </EmptyTitle>
            <EmptyDescription>
              {hasTileCommands
                ? t("layout.empty.tiles")
                : t("layout.empty.extensions")}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {hasTileCommands ? (
              <Button variant="secondary" size="sm" onClick={palette}>
                <Plus data-icon="inline-start" /> {t("layout.empty.add")}
                <kbd className="shortcut-key" aria-hidden>
                  {shortcut}
                </kbd>
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={manageExtensions}>
                <Blocks data-icon="inline-start" /> {t("layout.empty.manage")}
              </Button>
            )}
          </EmptyContent>
        </Empty>
      )}
    </main>
  );
}
