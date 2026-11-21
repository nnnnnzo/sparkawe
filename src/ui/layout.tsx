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
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { Runtime } from "../app/runtime.ts";
import { report } from "./errors.ts";
import type { Tab, WorkspaceState } from "../core/workspace.ts";
import { Button } from "@lab/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@lab/ui/components/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@lab/ui/components/empty";
import { Icon } from "./icons.tsx";

const sideMinimum = 220;
const dockTheme = {
  name: "lab",
  className: "lab-dock",
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
  return <div className="tile-host" ref={ref} />;
}

const directions = {
  left: "À gauche",
  right: "À droite",
  top: "Au-dessus",
  bottom: "En dessous",
  center: "Dans le même groupe",
} as const;

function PanelTab({ api, containerApi }: IDockviewPanelHeaderProps) {
  const { tab, runtime } = useContext(context)!;
  const tile = tab.tiles.find((tile) => tile.id === api.id);
  const definition = tile && runtime.registry.getTile(tile.type);
  const title = definition?.title ?? api.title ?? "Tuile indisponible";
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
              title="Déplacer la tuile"
              aria-label={`Déplacer ${title}`}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Ellipsis data-icon="inline-start" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuGroup>
              {Object.entries(directions).map(([position, label]) => (
                <DropdownMenuItem
                  key={position}
                  onSelect={() => {
                    const group =
                      targets.find((panel) => panel.group !== api.group)
                        ?.group ?? targets[0].group;
                    api.moveTo({
                      group,
                      position: position as keyof typeof directions,
                    });
                  }}
                >
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Button
        variant="ghost"
        size="icon"
        title="Fermer la tuile"
        aria-label={`Fermer ${title}`}
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

function syncPanels(api: DockviewApi, tab: Tab, runtime: Runtime) {
  const ids = new Set(tab.tiles.map((tile) => tile.id));
  for (const panel of api.panels) {
    if (!ids.has(panel.id)) api.removePanel(panel);
  }
  for (const tile of tab.tiles) {
    if (api.getPanel(tile.id)) continue;
    const last = api.panels.at(-1);
    const ref = tab.mode === "side" ? last : (api.activePanel ?? last);
    const position = ref
      ? {
          referencePanel: ref,
          direction:
            tab.mode === "side" || api.panels.length % 2
              ? ("right" as const)
              : ("below" as const),
        }
      : undefined;
    api.addPanel({
      id: tile.id,
      component: "tile",
      tabComponent: "tile",
      title: runtime.registry.getTile(tile.type)?.title ?? "Tuile indisponible",
      position,
      minimumWidth: tab.mode === "side" ? sideMinimum : 120,
      minimumHeight: 84,
    });
  }
  if (tab.focused) api.getPanel(tab.focused)?.api.setActive();
}

function Engine({ tab, runtime }: { tab: Tab; runtime: Runtime }) {
  const [api, setApi] = useState<DockviewApi>();
  const live = useRef(tab);
  const updating = useRef(false);
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
      if (!panel || updating.current) return;
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
  }, [api, runtime, tab.id, tab.mode]);

  useLayoutEffect(() => {
    if (!api) return;
    updating.current = true;
    try {
      syncPanels(api, live.current, runtime);
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
          disableDnd={tab.mode === "side"}
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
            <View tile={tile} active={tab.tiles.includes(tile)} />
          ) : (
            <p className="tile-message">Tuile indisponible.</p>
          ),
          mounts.get(tile.id)!,
          tile.id,
        );
      })}
      {tab.tiles.length ? (
        <context.Provider value={{ runtime, tab, mounts }}>
          <Engine key={`${tab.id}:${tab.mode}`} tab={tab} runtime={runtime} />
        </context.Provider>
      ) : (
        <Empty className="layout-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon" aria-hidden>
              <LayoutGrid strokeWidth={1.5} />
            </EmptyMedia>
            <EmptyTitle role="heading" aria-level={2}>
              Onglet vide
            </EmptyTitle>
            <EmptyDescription>
              {hasTileCommands
                ? "Choisissez les tuiles à afficher dans cet onglet."
                : "Activez une extension pour ajouter des tuiles."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {hasTileCommands ? (
              <Button variant="outline" size="sm" onClick={palette}>
                <Plus data-icon="inline-start" /> Ajouter une tuile
                <kbd className="shortcut-key" aria-hidden>
                  {shortcut}
                </kbd>
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={manageExtensions}>
                <Blocks data-icon="inline-start" /> Gérer les extensions
              </Button>
            )}
          </EmptyContent>
        </Empty>
      )}
    </main>
  );
}
