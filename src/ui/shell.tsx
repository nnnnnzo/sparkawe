import {
  Blocks,
  ChevronDown,
  Columns2,
  Droplets,
  LayoutGrid,
  Moon,
  Plus,
  Rows3,
  ScrollText,
  Search,
  Sun,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { KeyboardEvent } from "react";
import type { Runtime } from "../app/runtime.ts";
import { report } from "./errors.ts";
import type { Mode, Tab } from "../core/workspace.ts";
import type { Command } from "../sdk/index.ts";
import { Button } from "@spark/ui/components/button";
import {
  Command as CommandMenu,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@spark/ui/components/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@spark/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@spark/ui/components/dropdown-menu";
import { Input } from "@spark/ui/components/input";
import { SidebarProvider } from "@spark/ui/components/sidebar";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@spark/ui/components/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@spark/ui/components/tooltip";
import { Icon } from "./icons.tsx";
import { WorkspaceLayout } from "./layout.tsx";
import { Rail } from "./rail.tsx";

const macOS = navigator.platform.toLowerCase().includes("mac");
const modifier = macOS ? "⌘" : "Ctrl+";

export function SparkShell({ runtime }: { runtime: Runtime }) {
  const { workspace, registry } = runtime;
  const state = useSyncExternalStore(workspace.subscribe, workspace.get);
  const settings = useSyncExternalStore(
    runtime.settings.subscribe,
    runtime.settings.get,
  );
  const current = workspace.active();
  const currentIndex = state.tabs.indexOf(current);
  const previousTab = state.tabs[currentIndex - 1];
  const nextTab = state.tabs[currentIndex + 1];
  const [palette, setPalette] = useState(false);
  const [extensionHub, setExtensionHub] = useState(false);
  const [rename, setRename] = useState<Tab>();
  const [brief, setBrief] = useState(false);
  const [unread, setUnread] = useState<ReadonlySet<string>>(new Set());
  // Un onglet créé par un agent ne prend pas le focus : on le signale
  // discrètement dans la barre, et le signal disparaît dès qu'on l'ouvre.
  useEffect(() => {
    return runtime.journal.subscribe(() => {
      const last = runtime.journal.list(1).at(-1);
      if (
        !last ||
        last.kind !== "tab.create" ||
        last.source !== "agent" ||
        !last.tabId
      )
        return;
      if (last.tabId === runtime.workspace.get().active) return;
      const id = last.tabId;
      setUnread((previous) => new Set(previous).add(id));
    });
  }, [runtime]);
  useEffect(() => {
    if (!unread.has(current.id)) return;
    setUnread((previous) => {
      const next = new Set(previous);
      next.delete(current.id);
      return next;
    });
  }, [current.id, unread]);
  const focusBeforePalette = useRef<HTMLElement | null>(null);
  const openPalette = useCallback(() => {
    focusBeforePalette.current = document.activeElement as HTMLElement | null;
    setPalette(true);
  }, []);
  const closeTab = useCallback(
    (tab: Tab) =>
      runtime.closeTiles(
        tab.tiles.map((tile) => tile.id),
        () => workspace.remove(tab.id),
      ),
    [runtime, workspace],
  );
  const setMode = useCallback(
    (mode: Mode) => workspace.updateTab(workspace.active().id, { mode }),
    [workspace],
  );
  const run = useCallback((command: Command) => {
    setPalette(false);
    void Promise.resolve()
      .then(() => command.run())
      .catch(report);
  }, []);

  const [coreCommands] = useState<Command[]>(() => {
    const commands: Command[] = [
      {
        id: "tabs.new",
        title: "Nouvel onglet",
        category: "Onglets",
        icon: Plus,
        run: () => workspace.create(),
      },
      {
        id: "tabs.rename",
        title: "Renommer l’onglet",
        category: "Onglets",
        run: () => setRename(workspace.active()),
      },
      {
        id: "tabs.close",
        title: "Fermer l’onglet",
        category: "Onglets",
        icon: X,
        run: () => closeTab(workspace.active()),
      },
      {
        id: "layout.side",
        title: "Mode Side",
        category: "Affichage",
        icon: Columns2,
        run: () => setMode("side"),
      },
      {
        id: "layout.tiling",
        title: "Mode Tiling",
        category: "Affichage",
        icon: LayoutGrid,
        run: () => setMode("tiling"),
      },
      {
        id: "layout.stack",
        title: "Mode Stack",
        category: "Affichage",
        icon: Rows3,
        run: () => setMode("stack"),
      },
      {
        id: "theme.dark",
        title: "Thème sombre",
        category: "Affichage",
        icon: Moon,
        run: () => workspace.patch({ theme: "dark" }),
      },
      {
        id: "theme.light",
        title: "Thème clair",
        category: "Affichage",
        icon: Sun,
        run: () => workspace.patch({ theme: "light" }),
      },
      {
        id: "extensions.manage",
        title: "Gérer les extensions",
        icon: Blocks,
        run: () => setExtensionHub(true),
      },
      {
        id: "dev.brief",
        title: "Afficher le brief de l’onglet",
        category: "Développement",
        icon: ScrollText,
        dev: true,
        keywords: ["agent", "contexte", "mcp"],
        run: () => setBrief(true),
      },
    ];
    if (macOS)
      commands.push({
        id: "theme.transparent",
        title: "Thème transparent",
        category: "Affichage",
        icon: Droplets,
        run: () => workspace.patch({ theme: "transparent" }),
      });
    return commands;
  });
  useEffect(() => {
    const disposals = coreCommands.map(registry.registerCommand);
    return () => disposals.forEach((dispose) => dispose());
  }, [coreCommands, registry]);

  useLayoutEffect(() => {
    const transparent = macOS && state.theme === "transparent";
    const root = document.documentElement;
    root.classList.toggle("dark", transparent || state.theme === "dark");
    root.classList.toggle("transparent", transparent);
    if (macOS)
      void invoke("set_window_material", { enabled: transparent }).catch(
        report,
      );
  }, [state.theme]);
  useLayoutEffect(() => {
    document
      .getElementById(`tab-${current.id}`)
      ?.closest(".spark-tab")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current.id, currentIndex]);
  useEffect(() => {
    const keyboard = (event: globalThis.KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "k"
      )
        return;
      event.preventDefault();
      if (palette) setPalette(false);
      else openPalette();
    };
    window.addEventListener("keydown", keyboard, true);
    return () => window.removeEventListener("keydown", keyboard, true);
  }, [openPalette, palette]);

  function navigateTabs(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    const last = state.tabs.length - 1;
    const next = {
      ArrowLeft: index === 0 ? last : index - 1,
      ArrowRight: index === last ? 0 : index + 1,
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const id = state.tabs[next].id;
    workspace.activate(id);
    document.getElementById(`tab-${id}`)?.focus();
  }

  const groups = new Map<string, ReturnType<typeof registry.getCommands>>();
  for (const category of ["Tuiles", "Onglets", "Affichage", "Extensions"])
    groups.set(category, []);
  for (const command of registry.getCommands()) {
    if (command.dev && !settings.dev) continue;
    const category =
      command.category ?? (command.tileType ? "Tuiles" : "Extensions");
    const group = groups.get(category) ?? [];
    group.push(command);
    groups.set(category, group);
  }
  const briefText = useMemo(() => {
    if (!brief) return "";
    try {
      return runtime.brief().text;
    } catch (error) {
      return String(error);
    }
  }, [brief, runtime, state]);

  return (
    <SidebarProvider className="spark-shell" open>
      <header
        className="window-bar"
        data-macos={macOS || undefined}
        data-tauri-drag-region={macOS || undefined}
      >
        {macOS && (
          <div
            className="window-controls-inset"
            aria-hidden
            data-tauri-drag-region
          />
        )}
        <div role="tablist" aria-label="Onglets Spark" className="tab-list">
          {state.tabs.map((tab, index) => (
            <div
              className="spark-tab"
              key={tab.id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData("application/x-spark-tab", tab.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(event) => {
                if (
                  event.dataTransfer.types.includes("application/x-spark-tab")
                )
                  event.preventDefault();
              }}
              onDrop={(event) => {
                const id = event.dataTransfer.getData(
                  "application/x-spark-tab",
                );
                if (id) workspace.reorder(id, tab.id);
              }}
            >
              <Tooltip delayDuration={500}>
                <TooltipTrigger asChild>
                  <button
                    id={`tab-${tab.id}`}
                    role="tab"
                    className="spark-tab-label"
                    aria-controls={`panel-${tab.id}`}
                    aria-selected={current.id === tab.id}
                    tabIndex={current.id === tab.id ? 0 : -1}
                    onClick={() => workspace.activate(tab.id)}
                    onDoubleClick={() => setRename(tab)}
                    onKeyDown={(event) => navigateTabs(event, index)}
                  >
                    {unread.has(tab.id) && (
                      <span className="spark-tab-dot" aria-hidden />
                    )}
                    <span className="truncate">{tab.name}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  className="max-w-64 wrap-anywhere"
                  side="bottom"
                >
                  {tab.name}
                </TooltipContent>
              </Tooltip>
              <Button
                className="spark-tab-close size-6 shrink-0"
                size="icon"
                variant="ghost"
                aria-label={`Fermer ${tab.name}`}
                title="Fermer l’onglet"
                onClick={() => void closeTab(tab).catch(report)}
              >
                <X data-icon="inline-start" />
              </Button>
            </div>
          ))}
        </div>
        {state.tabs.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-8 shrink-0"
                aria-label="Tous les onglets"
                title="Tous les onglets"
              >
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="spark-tab-menu max-w-72"
            >
              <DropdownMenuRadioGroup
                value={current.id}
                onValueChange={(id) => workspace.activate(id)}
              >
                {state.tabs.map((tab) => (
                  <DropdownMenuRadioItem
                    key={tab.id}
                    value={tab.id}
                    className="wrap-anywhere"
                  >
                    {tab.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!previousTab}
                onSelect={() => workspace.reorder(current.id, previousTab.id)}
              >
                Déplacer l’onglet actif à gauche
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!nextTab}
                onSelect={() => workspace.reorder(current.id, nextTab.id)}
              >
                Déplacer l’onglet actif à droite
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-8 shrink-0"
              aria-label="Nouvel onglet"
              onClick={() => workspace.create()}
            >
              <Plus data-icon="inline-start" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Nouvel onglet</TooltipContent>
        </Tooltip>
        <div
          className="window-drag-space"
          aria-hidden
          data-tauri-drag-region={macOS || undefined}
        />
        <ToggleGroup
          type="single"
          value={current.mode}
          className="mode-control shadow-none"
          aria-label="Disposition de l’onglet"
          variant="outline"
          size="sm"
          onValueChange={(value) => {
            if (value === "side" || value === "tiling" || value === "stack")
              setMode(value);
          }}
        >
          <ToggleGroupItem value="side" aria-label="Side" title="Side">
            <Columns2 />
            <span>Side</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="tiling" aria-label="Tiling" title="Tiling">
            <LayoutGrid />
            <span>Tiling</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="stack" aria-label="Stack" title="Stack">
            <Rows3 />
            <span>Stack</span>
          </ToggleGroupItem>
        </ToggleGroup>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              aria-label="Palette de commandes"
              onClick={openPalette}
            >
              <Search data-icon="inline-start" />
              <kbd className="palette-shortcut font-sans text-muted-foreground">
                {modifier}K
              </kbd>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Palette de commandes</TooltipContent>
        </Tooltip>
      </header>
      <div className="spark-content">
        <div className="spark-body">
          <Rail
            runtime={runtime}
            run={run}
            hub={extensionHub}
            setHub={setExtensionHub}
            pinned={state.pinned}
            theme={state.theme}
            dev={settings.dev}
          />
          <WorkspaceLayout
            runtime={runtime}
            state={state}
            palette={openPalette}
            manageExtensions={() => setExtensionHub(true)}
            hasTileCommands={registry
              .getCommands()
              .some((command) => !!command.tileType)}
            shortcut={`${modifier}K`}
          />
        </div>
      </div>
      <Dialog open={palette} onOpenChange={setPalette}>
        <DialogContent
          showCloseButton={false}
          animateOnOpen={false}
          className="overflow-hidden p-0"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (extensionHub) return;
            if (focusBeforePalette.current?.isConnected) {
              focusBeforePalette.current.focus();
            } else {
              document.getElementById(`tab-${workspace.active().id}`)?.focus();
            }
          }}
        >
          <DialogTitle className="sr-only">Palette de commandes</DialogTitle>
          <DialogDescription className="sr-only">
            Rechercher et exécuter une commande Spark.
          </DialogDescription>
          <CommandMenu label="Rechercher une commande">
            <CommandInput placeholder="Rechercher une commande…" />
            <CommandList>
              <CommandEmpty>
                Aucune commande trouvée. Essayez un autre terme.
              </CommandEmpty>
              {[...groups.entries()].map(
                ([category, commands]) =>
                  commands.length > 0 && (
                    <CommandGroup key={category} heading={category}>
                      {commands.map((command) => (
                        <CommandItem
                          key={command.id}
                          value={command.title}
                          keywords={[
                            command.owner.name,
                            ...(command.keywords ?? []),
                          ]}
                          onSelect={() => run(command)}
                        >
                          <Icon
                            glyph={command.icon}
                            extension={command.owner}
                          />
                          {command.title}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ),
              )}
            </CommandList>
          </CommandMenu>
        </DialogContent>
      </Dialog>
      {rename && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setRename(undefined);
          }}
        >
          <DialogContent showCloseButton={false}>
            <DialogTitle>Renommer l’onglet</DialogTitle>
            <DialogDescription className="sr-only">
              Choisir le nom affiché pour cet onglet.
            </DialogDescription>
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                const name = String(
                  new FormData(event.currentTarget).get("name"),
                ).trim();
                if (name) {
                  workspace.updateTab(rename.id, { name });
                  setRename(undefined);
                }
              }}
            >
              <Input
                name="name"
                defaultValue={rename.name}
                aria-label="Nom de l’onglet"
                required
                maxLength={60}
              />
              <DialogFooter>
                <Button type="submit">Renommer</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
      <Dialog open={brief} onOpenChange={setBrief}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Brief de l’onglet</DialogTitle>
            <DialogDescription>
              La version texte que lira un agent pour comprendre l’espace actif.
            </DialogDescription>
          </DialogHeader>
          <pre className="bg-muted/40 max-h-[55vh] overflow-auto rounded-md border p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap select-text">
            {briefText}
          </pre>
          <DialogFooter>
            <span className="text-muted-foreground mr-auto text-xs">
              {briefText.length} caractères
            </span>
            <Button variant="outline" onClick={() => setBrief(false)}>
              Fermer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
