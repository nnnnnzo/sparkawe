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
import { AnimatePresence } from "motion/react";
import type { Runtime } from "../app/runtime.ts";
import { localized } from "../core/i18n.ts";
import { useI18n } from "../i18n/react.ts";
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
import { ActivityControl } from "./activity.tsx";
import { Icon } from "./icons.tsx";
import { WorkspaceLayout } from "./layout.tsx";
import { Rail } from "./rail.tsx";
import { StorePage } from "./store/page.tsx";
import { tabDropTarget } from "./tabDrop.ts";

const macOS = navigator.platform.toLowerCase().includes("mac");
const modifier = macOS ? "⌘" : "Ctrl+";
const tabDragType = "application/x-spark-tab";
const motionPreference = "(prefers-reduced-motion: reduce)";

export function SparkShell({ runtime }: { runtime: Runtime }) {
  const { workspace, registry } = runtime;
  const { t, text, tp, locale } = useI18n();
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
  const [store, setStore] = useState(false);
  const [storeLeaving, setStoreLeaving] = useState(false);
  const restoreStoreFocus = useRef(false);
  const tabList = useRef<HTMLDivElement>(null);
  const tabPositions = useRef(new Map<string, number>());
  const tabAnimations = useRef<Animation[]>([]);
  const [draggedTab, setDraggedTab] = useState<string>();
  const [dropEdge, setDropEdge] = useState<{
    id: string;
    edge: "before" | "after";
  }>();
  const modeControl = useRef<HTMLDivElement>(null);
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
  const closeStore = useCallback((restoreFocus = true) => {
    restoreStoreFocus.current = restoreFocus;
    setStoreLeaving(true);
    setStore(false);
  }, []);
  const finishStoreExit = useCallback(() => setStoreLeaving(false), []);
  useLayoutEffect(() => {
    if (store || storeLeaving || !restoreStoreFocus.current) return;
    restoreStoreFocus.current = false;
    document.getElementById("store-trigger")?.focus();
  }, [store, storeLeaving]);
  const dismissStore = useCallback(() => {
    if (store) closeStore(false);
  }, [closeStore, store]);
  const run = useCallback(
    (command: Command) => {
      setPalette(false);
      dismissStore();
      void Promise.resolve()
        .then(() => command.run())
        .catch(report);
    },
    [dismissStore],
  );

  const [coreCommands] = useState<Command[]>(() => {
    const commands: Command[] = [
      {
        id: "tabs.new",
        title: localized("shell.command.newTab"),
        category: localized("shell.category.tabs"),
        icon: Plus,
        run: () => workspace.create(),
      },
      {
        id: "tabs.rename",
        title: localized("shell.command.renameTab"),
        category: localized("shell.category.tabs"),
        run: () => setRename(workspace.active()),
      },
      {
        id: "tabs.close",
        title: localized("shell.command.closeTab"),
        category: localized("shell.category.tabs"),
        icon: X,
        run: () => closeTab(workspace.active()),
      },
      {
        id: "layout.side",
        title: localized("shell.command.side"),
        category: localized("shell.category.layout"),
        icon: Columns2,
        run: () => setMode("side"),
      },
      {
        id: "layout.tiling",
        title: localized("shell.command.tiling"),
        category: localized("shell.category.layout"),
        icon: LayoutGrid,
        run: () => setMode("tiling"),
      },
      {
        id: "layout.stack",
        title: localized("shell.command.stack"),
        category: localized("shell.category.layout"),
        icon: Rows3,
        run: () => setMode("stack"),
      },
      {
        id: "theme.dark",
        title: localized("shell.command.dark"),
        category: localized("shell.category.layout"),
        icon: Moon,
        run: () => workspace.patch({ theme: "dark" }),
      },
      {
        id: "theme.light",
        title: localized("shell.command.light"),
        category: localized("shell.category.layout"),
        icon: Sun,
        run: () => workspace.patch({ theme: "light" }),
      },
      {
        id: "extensions.store",
        title: localized("shell.command.store"),
        category: localized("shell.category.extensions"),
        icon: Blocks,
        keywords: ["extensions", "marketplace", "installer"],
        run: () => setStore(true),
      },
      {
        id: "dev.brief",
        title: localized("shell.command.brief"),
        category: localized("shell.category.development"),
        icon: ScrollText,
        dev: true,
        keywords: ["agent", "contexte", "mcp"],
        run: () => setBrief(true),
      },
    ];
    if (macOS)
      commands.push({
        id: "theme.transparent",
        title: localized("shell.command.transparent"),
        category: localized("shell.category.layout"),
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
    const dark = transparent || state.theme === "dark";
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.classList.toggle("transparent", transparent);
    // L’apparence native suit le thème : les pages web reçoivent
    // `prefers-color-scheme` et les contrôles système restent cohérents.
    void invoke("set_window_theme", { dark }).catch(report);
    if (macOS)
      void invoke("set_window_material", { enabled: transparent }).catch(
        report,
      );
  }, [state.theme]);
  useLayoutEffect(() => {
    const tabs =
      tabList.current?.querySelectorAll<HTMLElement>("[data-tab-id]");
    if (!tabs) return;
    const previous = tabPositions.current;
    const orderChanged =
      Array.from(tabs, (tab) => tab.dataset.tabId).join("|") !==
      Array.from(previous.keys()).join("|");
    const reduced = window.matchMedia(motionPreference).matches;
    if (orderChanged) {
      for (const animation of tabAnimations.current) animation.cancel();
      tabAnimations.current = [];
    }
    const next = new Map<string, number>();
    for (const tab of tabs) {
      const id = tab.dataset.tabId!;
      const x = tab.offsetLeft;
      const from = previous.get(id);
      next.set(id, x);
      if (reduced || !orderChanged || !previous.size || from === x) continue;
      tabAnimations.current.push(
        tab.animate(
          from === undefined
            ? [
                { opacity: 0, transform: "translateY(2px)" },
                { opacity: 1, transform: "none" },
              ]
            : [
                { transform: `translateX(${from - x}px)` },
                { transform: "none" },
              ],
          {
            duration: from === undefined ? 140 : 160,
            easing: "cubic-bezier(.2,.7,.2,1)",
          },
        ),
      );
    }
    tabPositions.current = next;
  }, [state.tabs]);
  useLayoutEffect(() => {
    const control = modeControl.current;
    const selected = control?.querySelector<HTMLElement>('[data-state="on"]');
    if (!control || !selected) return;
    const position = () => {
      const x = selected.offsetLeft + selected.offsetWidth / 2;
      control.style.setProperty("--mode-x", `${x}px`);
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(control);
    for (const button of control.querySelectorAll("button"))
      observer.observe(button);
    return () => observer.disconnect();
  }, [current.mode]);
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
        event.shiftKey
      )
        return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable='true'], .cm-editor, .xterm",
        )
      )
        return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        if (palette) setPalette(false);
        else openPalette();
      } else if (key === "t") {
        event.preventDefault();
        workspace.create();
        setStore(false);
      }
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
    dismissStore();
    document.getElementById(`tab-${id}`)?.focus();
  }

  const groups = new Map<string, ReturnType<typeof registry.getCommands>>();
  const categoryTiles = t("shell.category.tiles");
  const categoryExtensions = t("shell.category.extensions");
  for (const category of [
    categoryTiles,
    t("shell.category.tabs"),
    t("shell.category.layout"),
    categoryExtensions,
    t("shell.category.development"),
  ])
    groups.set(category, []);
  for (const command of registry.getCommands()) {
    if (command.dev && !settings.dev) continue;
    const category = command.category
      ? text(command.category)
      : command.tileType
        ? categoryTiles
        : categoryExtensions;
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
  }, [brief, runtime, state, locale]);

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
        <div
          role="tablist"
          aria-label={t("shell.tabs.aria")}
          className="tab-list"
          ref={tabList}
        >
          {state.tabs.map((tab, index) => (
            <div
              className="spark-tab"
              key={tab.id}
              data-tab-id={tab.id}
              data-dragging={draggedTab === tab.id || undefined}
              data-drop-edge={
                dropEdge?.id === tab.id ? dropEdge.edge : undefined
              }
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(tabDragType, tab.id);
                event.dataTransfer.effectAllowed = "move";
                setDraggedTab(tab.id);
              }}
              onDragOver={(event) => {
                if (!draggedTab || draggedTab === tab.id) return;
                if (!event.dataTransfer.types.includes(tabDragType)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const rect = event.currentTarget.getBoundingClientRect();
                const edge =
                  event.clientX < rect.left + rect.width / 2
                    ? "before"
                    : "after";
                setDropEdge((current) =>
                  current?.id === tab.id && current.edge === edge
                    ? current
                    : { id: tab.id, edge },
                );
              }}
              onDragLeave={(event) => {
                if (
                  event.relatedTarget instanceof Node &&
                  event.currentTarget.contains(event.relatedTarget)
                )
                  return;
                setDropEdge((current) =>
                  current?.id === tab.id ? undefined : current,
                );
              }}
              onDragEnd={() => {
                setDraggedTab(undefined);
                setDropEdge(undefined);
              }}
              onDrop={(event) => {
                const id = event.dataTransfer.getData(tabDragType);
                if (!id || id !== draggedTab || id === tab.id) return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                const edge =
                  event.clientX < rect.left + rect.width / 2
                    ? "before"
                    : "after";
                const target = tabDropTarget(state.tabs, id, tab.id, edge);
                if (target) workspace.reorder(id, target);
                setDraggedTab(undefined);
                setDropEdge(undefined);
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
                    onClick={() => {
                      workspace.activate(tab.id);
                      dismissStore();
                    }}
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
                aria-label={t("shell.tabs.close", { name: tab.name })}
                title={t("shell.tabs.close.title")}
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
                aria-label={t("shell.tabs.all")}
                title={t("shell.tabs.all")}
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
                onValueChange={(id) => {
                  workspace.activate(id);
                  dismissStore();
                }}
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
                {t("shell.tabs.moveLeft")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!nextTab}
                onSelect={() => workspace.reorder(current.id, nextTab.id)}
              >
                {t("shell.tabs.moveRight")}
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
              aria-label={t("shell.tabs.new")}
              onClick={() => {
                workspace.create();
                dismissStore();
              }}
            >
              <Plus data-icon="inline-start" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("shell.tabs.new")}</TooltipContent>
        </Tooltip>
        <div
          className="window-drag-space"
          aria-hidden
          data-tauri-drag-region={macOS || undefined}
        />
        <div className="mode-cluster">
          <ActivityControl runtime={runtime} tabId={current.id} />
          <ToggleGroup
            type="single"
            value={current.mode}
            className="mode-control shadow-none"
            ref={modeControl}
            aria-label={t("shell.tabs.layout")}
            variant="outline"
            size="sm"
            onValueChange={(value) => {
              if (value === "side" || value === "tiling" || value === "stack")
                setMode(value);
            }}
          >
            <ToggleGroupItem
              value="side"
              aria-label={t("shell.command.side")}
              title={t("shell.command.side")}
            >
              <Columns2 />
              <span>Side</span>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="tiling"
              aria-label={t("shell.command.tiling")}
              title={t("shell.command.tiling")}
            >
              <LayoutGrid />
              <span>Tiling</span>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="stack"
              aria-label={t("shell.command.stack")}
              title={t("shell.command.stack")}
            >
              <Rows3 />
              <span>Stack</span>
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              aria-label={t("shell.palette.open")}
              onClick={openPalette}
            >
              <Search data-icon="inline-start" />
              <kbd className="palette-shortcut font-sans text-muted-foreground">
                {modifier}K
              </kbd>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("shell.palette.open")}</TooltipContent>
        </Tooltip>
      </header>
      <div className="spark-content">
        <div
          className="spark-surface"
          inert={store || storeLeaving || undefined}
          aria-hidden={store || storeLeaving || undefined}
        >
          <div className="spark-body">
            <Rail
              runtime={runtime}
              run={run}
              pinned={state.pinned}
              theme={state.theme}
              dev={settings.dev}
              onOpenStore={() => setStore(true)}
            />
            <WorkspaceLayout
              runtime={runtime}
              state={state}
              palette={openPalette}
              manageExtensions={() => setStore(true)}
              hasTileCommands={registry
                .getCommands()
                .some((command) => !!command.tileType)}
              shortcut={`${modifier}K`}
            />
          </div>
        </div>
        <AnimatePresence onExitComplete={finishStoreExit}>
          {store && (
            <StorePage
              key="store"
              runtime={runtime}
              onClose={closeStore}
              dev={settings.dev}
            />
          )}
        </AnimatePresence>
      </div>
      <Dialog open={palette} onOpenChange={setPalette}>
        <DialogContent
          showCloseButton={false}
          animateOnOpen={false}
          className="overflow-hidden p-0"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const storeMain = document.querySelector<HTMLElement>(
              ".spark-store:not([inert]) .store-main",
            );
            if (storeMain) {
              storeMain.focus();
              return;
            }
            if (focusBeforePalette.current?.isConnected) {
              focusBeforePalette.current.focus();
            } else {
              document.getElementById(`tab-${workspace.active().id}`)?.focus();
            }
          }}
        >
          <DialogTitle className="sr-only">
            {t("shell.palette.open")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("shell.palette.description")}
          </DialogDescription>
          <CommandMenu label={t("shell.palette.search")}>
            <CommandInput placeholder={t("shell.palette.placeholder")} />
            <CommandList>
              <CommandEmpty>{t("shell.palette.empty")}</CommandEmpty>
              {[...groups.entries()].map(
                ([category, commands]) =>
                  commands.length > 0 && (
                    <CommandGroup key={category} heading={category}>
                      {commands.map((command) => (
                        <CommandItem
                          key={command.id}
                          value={text(command.title)}
                          keywords={[
                            text(command.owner.name),
                            ...(command.keywords ?? []),
                          ]}
                          onSelect={() => run(command)}
                        >
                          <Icon
                            glyph={command.icon}
                            extension={command.owner}
                          />
                          {text(command.title)}
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
            <DialogTitle>{t("shell.tabs.rename.title")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("shell.tabs.rename.description")}
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
                aria-label={t("shell.tabs.rename.label")}
                required
                maxLength={60}
              />
              <DialogFooter>
                <Button type="submit">{t("shell.tabs.rename.action")}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
      <Dialog open={brief} onOpenChange={setBrief}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("shell.brief.title")}</DialogTitle>
            <DialogDescription>
              {t("shell.brief.description")}
            </DialogDescription>
          </DialogHeader>
          <pre className="bg-muted/40 max-h-[55vh] overflow-auto rounded-md border p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap select-text">
            {briefText}
          </pre>
          <DialogFooter>
            <span className="text-muted-foreground mr-auto text-xs">
              {tp("shell.brief.character", briefText.length, {
                count: briefText.length,
              })}
            </span>
            <Button variant="outline" onClick={() => setBrief(false)}>
              {t("shell.brief.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
