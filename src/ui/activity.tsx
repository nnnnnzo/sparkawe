import {
  AppWindow,
  ChartLine,
  ChevronRight,
  Globe,
  History,
  Minus,
  Move,
  PenLine,
  Plus,
  Redo2,
  Scaling,
  Table2,
  Undo2,
  X,
  Zap,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import type {
  ActivityAgent,
  ActivityStep,
  InverseEffect,
  LayoutSide,
} from "../core/activity.ts";
import { activityHost } from "../core/activity.ts";
import { formatNumber, type Locale } from "../core/i18n.ts";
import type { LocalizedText, Tile } from "../sdk/index.ts";
import type { Mode, Tab } from "../core/workspace.ts";
import { AGENTS, type AgentBrand } from "../shared/agents/data.ts";
import { AgentMark } from "../shared/agents/index.tsx";
import { useI18n } from "../i18n/react.ts";
import type { Runtime } from "../app/runtime.ts";
import { revertFailure, revertStep } from "../app/activity.ts";
import { Button } from "@spark/ui/components/button";
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
  DropdownMenuTrigger,
} from "@spark/ui/components/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@spark/ui/components/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@spark/ui/components/tooltip";

const MODE_KEY: Record<Mode, string> = {
  side: "shell.command.side",
  tiling: "shell.command.tiling",
  stack: "shell.command.stack",
};

const SIDE_KEY: Record<LayoutSide, string> = {
  left: "activity.side.left",
  right: "activity.side.right",
  top: "activity.side.top",
  bottom: "activity.side.bottom",
  center: "activity.side.center",
};

type T = (key: string, params?: Record<string, string | number>) => string;
type TextFn = (value: LocalizedText | undefined) => string;
type TP = (
  key: string,
  count: number,
  params?: Record<string, string | number>,
) => string;

const TYPE_LABEL: Record<string, string> = {
  "layout.move": "activity.kind.move",
  "layout.resize": "activity.kind.resize",
  "layout.undo": "activity.kind.undo",
  "layout.redo": "activity.kind.redo",
  "tile.open": "activity.kind.open",
  "tile.close": "activity.kind.close",
  "tab.create": "activity.kind.tabCreate",
  "tab.remove": "activity.kind.tabRemove",
};

interface OptionState {
  enabled: boolean;
  reason?: string;
}

interface RevertState {
  has: boolean;
  undo?: OptionState;
  instant?: OptionState;
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function brandOf(agent: ActivityAgent): AgentBrand {
  return (
    AGENTS.find((brand) => brand.id === agent.brand) ?? {
      id: agent.brand,
      name: agent.name,
      commands: [],
      setup: false,
      glyph: [...agent.name][0]?.toUpperCase() ?? "A",
    }
  );
}

function findTile(runtime: Runtime, id?: string): Tile | undefined {
  if (!id) return undefined;
  return runtime.workspace
    .get()
    .tabs.flatMap((tab) => tab.tiles)
    .find((tile) => tile.id === id);
}

function typeTitle(runtime: Runtime, type: string, text: TextFn) {
  const definition = runtime.registry.getTile(type);
  return definition ? text(definition.title) : type;
}

function tileLabel(
  runtime: Runtime,
  id: string | undefined,
  text: TextFn,
) {
  const tile = findTile(runtime, id);
  if (!tile) return id ?? "";
  const definition = runtime.registry.getTile(tile.type);
  if (definition?.describe) {
    try {
      const summary = definition
        .describe(tile, runtime.registry.surface(tile.id) ?? {})
        .trim();
      if (summary) return summary;
    } catch {
      // Un describe peut échouer quand l'extension se réveille ; le titre suffit.
    }
  }
  return definition ? text(definition.title) : tile.type;
}

function actionOf(step: ActivityStep) {
  if (!step.kind.startsWith("action:")) return undefined;
  const body = step.kind.slice(7);
  const dot = body.lastIndexOf(".");
  if (dot < 0) return { tileType: body, action: body };
  return { tileType: body.slice(0, dot), action: body.slice(dot + 1) };
}

function actionTitle(
  runtime: Runtime,
  step: ActivityStep,
  text: TextFn,
) {
  const action = actionOf(step);
  if (!action) return "";
  const actionDefinition = runtime.registry.getAction(
    action.tileType,
    action.action,
  );
  return actionDefinition ? text(actionDefinition.title) : action.action;
}

function titleFor(
  runtime: Runtime,
  step: ActivityStep,
  text: TextFn,
  t: T,
) {
  if (actionOf(step)) return actionTitle(runtime, step, text);
  return t(TYPE_LABEL[step.kind] ?? "activity.kind.action");
}

/** Fil d’Ariane : l’onglet qui contient l’objet, puis l’objet lui-même. */
function pathOf(
  runtime: Runtime,
  tab: Tab,
  step: ActivityStep,
  text: TextFn,
  t: T,
) {
  if (step.kind === "tab.create" || step.kind === "tab.remove") {
    const entry = step.entries.find((candidate) => candidate.kind === step.kind);
    const name = recordOf(entry?.data).name;
    return {
      tab: tab.name,
      subject:
        typeof name === "string"
          ? name
          : t(TYPE_LABEL[step.kind] ?? "activity.kind.action"),
    };
  }
  if (step.kind === "layout.undo" || step.kind === "layout.redo")
    return { tab: tab.name, subject: t("activity.path.layout") };

  const primary = step.entries.find(
    (entry) =>
      entry.kind.startsWith("action:") ||
      entry.kind === "tile.open" ||
      entry.kind === "tile.close" ||
      entry.kind.startsWith("layout."),
  );
  const tile = primary?.tileId
    ? findTile(runtime, primary.tileId)
    : undefined;
  if (tile)
    return {
      tab: runtime.workspace.tabForTile(tile.id)?.name ?? tab.name,
      subject: tileLabel(runtime, tile.id, text),
    };

  if (step.kind === "tile.open" || step.kind === "tile.close") {
    const type = recordOf(primary?.data).type;
    return {
      tab: tab.name,
      subject:
        typeof type === "string"
          ? typeTitle(runtime, type, text)
          : t(TYPE_LABEL[step.kind] ?? "activity.kind.action"),
    };
  }
  const action = actionOf(step);
  return {
    tab: tab.name,
    subject: action
      ? typeTitle(runtime, action.tileType, text)
      : t(TYPE_LABEL[step.kind] ?? "activity.kind.action"),
  };
}

function detailOf(
  runtime: Runtime,
  step: ActivityStep,
  locale: Locale,
  text: TextFn,
  t: T,
  tp: (
    key: string,
    count: number,
    params?: Record<string, string | number>,
  ) => string,
) {
  const primary = step.entries.find((entry) =>
    entry.kind.startsWith("action:"),
  );
  if (primary) {
    if (!step.detail) return t("activity.detail.changed");
    const params = { ...step.detail.params };
    if (step.detail.key === "activity.detail.url") {
      params.url = activityHost(params.url) ?? params.url;
    }
    if (
      step.detail.key === "activity.detail.characters" ||
      step.detail.key === "activity.detail.lines" ||
      step.detail.key === "activity.detail.rows"
    ) {
      const count = Number(params.count ?? 0);
      return tp(step.detail.key, count, params);
    }
    return t(step.detail.key);
  }
  if (step.kind === "layout.move") {
    const entry = step.entries.find((candidate) => candidate.kind === step.kind);
    const data = recordOf(entry?.data);
    const side = data.side;
    return t("activity.detail.to")
      .replace(
        "{side}",
        typeof side === "string" ? t(SIDE_KEY[side as LayoutSide]) : "",
      )
      .replace("{target}", tileLabel(runtime, data.target as string, text));
  }
  if (step.kind === "layout.resize") {
    const entry = step.entries.find((candidate) => candidate.kind === step.kind);
    const data = recordOf(entry?.data);
    const width = typeof data.width === "number" ? data.width : undefined;
    const height = typeof data.height === "number" ? data.height : undefined;
    return t("activity.detail.resize")
      .replace(
        "{width}",
        width !== undefined ? formatNumber(Math.round(width * 100), locale) : "—",
      )
      .replace(
        "{height}",
        height !== undefined
          ? formatNumber(Math.round(height * 100), locale)
          : "—",
      );
  }
  return "";
}

function dayKey(at: number) {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(at: number, locale: Locale, text: (key: string) => string) {
  const date = new Date(at);
  const now = new Date();
  if (dayKey(at) === dayKey(now.getTime())) return text("activity.day.today");
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(at) === dayKey(yesterday.getTime()))
    return text("activity.day.yesterday");
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear()
      ? {}
      : { year: "numeric" }),
  }).format(date);
}

function relative(at: number, locale: Locale, now: number, text: (key: string) => string) {
  const minutes = Math.round((at - now) / 60_000);
  if (Math.abs(minutes) < 1) return text("activity.time.now");
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(minutes) < 60) return format.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return format.format(hours, "hour");
  return format.format(Math.round(hours / 24), "day");
}

function panels(snapshot: unknown) {
  const value = recordOf(recordOf(snapshot).panels);
  return Object.keys(value).sort().join(",");
}

function tabPanels(tab: Tab) {
  return tab.tiles
    .map((tile) => tile.id)
    .sort()
    .join(",");
}

function effectState(
  runtime: Runtime,
  tab: Tab,
  step: ActivityStep,
  effect: InverseEffect,
  t: T,
): OptionState {
  const tile = (id: string) => findTile(runtime, id);
  switch (effect.type) {
    case "layoutMove":
      if (step.mode !== tab.mode)
        return {
          enabled: false,
          reason: t("activity.reason.mode", {
            mode: t(MODE_KEY[step.mode ?? "side"]),
          }),
        };
      if (!tile(effect.tile) || runtime.workspace.tabForTile(effect.tile)?.id !== tab.id)
        return { enabled: false, reason: t("activity.reason.tile") };
      if (
        !tile(effect.target) ||
        runtime.workspace.tabForTile(effect.target)?.id !== tab.id
      )
        return { enabled: false, reason: t("activity.reason.anchor") };
      return { enabled: true };
    case "layoutResize":
      if (step.mode !== tab.mode)
        return {
          enabled: false,
          reason: t("activity.reason.mode", {
            mode: t(MODE_KEY[step.mode ?? "side"]),
          }),
        };
      if (!tile(effect.tile) || runtime.workspace.tabForTile(effect.tile)?.id !== tab.id)
        return { enabled: false, reason: t("activity.reason.tile") };
      return { enabled: true };
    case "layoutRestore":
      if (step.mode !== tab.mode)
        return {
          enabled: false,
          reason: t("activity.reason.mode", {
            mode: t(MODE_KEY[step.mode ?? "side"]),
          }),
        };
      if (effect.snapshot === undefined)
        return { enabled: false, reason: t("activity.reason.snapshot") };
      if (panels(effect.snapshot) !== tabPanels(tab))
        return { enabled: false, reason: t("activity.reason.panels") };
      return { enabled: true };
    case "closeTile":
      return tile(effect.tile)
        ? { enabled: true }
        : { enabled: false, reason: t("activity.reason.tile") };
    case "reopenTile":
      return runtime.workspace
        .get()
        .tabs.some((candidate) => candidate.id === effect.tabId)
        ? { enabled: true }
        : { enabled: false, reason: t("activity.reason.tab") };
    case "closeTab":
      return runtime.workspace
        .get()
        .tabs.some((candidate) => candidate.id === effect.tabId)
        ? { enabled: true }
        : { enabled: false, reason: t("activity.reason.tab") };
    case "reopenTab":
      return { enabled: true };
    case "action": {
      const current = tile(effect.tileId);
      if (!current)
        return { enabled: false, reason: t("activity.reason.tile") };
      const definition = runtime.registry.getTile(current.type);
      if (!definition)
        return { enabled: false, reason: t("activity.reason.extension") };
      const action = runtime.registry.getAction(current.type, effect.action);
      if (!action?.inverse)
        return { enabled: false, reason: t("activity.reason.noInverse") };
      if (effect.snapshot === undefined)
        return { enabled: false, reason: t("activity.reason.snapshot") };
      return { enabled: true };
    }
  }
}

function revertState(
  runtime: Runtime,
  tab: Tab,
  step: ActivityStep,
  t: T,
): RevertState {
  if (step.revertedAt) return { has: false };
  const effects = step.inverse.filter(
    (effect) => effect.type !== "layoutRestore",
  );
  const instant = step.inverse.find(
    (effect) => effect.type === "layoutRestore",
  ) as Extract<InverseEffect, { type: "layoutRestore" }> | undefined;
  if (!effects.length && !instant) return { has: false };
  const states = effects.map((effect) =>
    effectState(runtime, tab, step, effect, t),
  );
  const bad = states.find((state) => !state.enabled);
  const undo = effects.length
    ? bad
      ? { enabled: false, reason: bad.reason }
      : { enabled: true }
    : undefined;
  const instantState = instant
    ? effectState(runtime, tab, step, instant, t)
    : undefined;
  return {
    has: true,
    ...(undo ? { undo } : {}),
    ...(instantState ? { instant: instantState } : {}),
  };
}

function revertLabel(
  step: ActivityStep,
  runtime: Runtime,
  text: TextFn,
  t: T,
) {
  if (step.kind === "layout.move") return t("activity.revert.move");
  if (step.kind === "layout.resize") return t("activity.revert.resize");
  if (step.kind === "tile.open") return t("activity.revert.closeTile");
  if (step.kind === "tile.close") return t("activity.revert.reopenTile");
  if (step.kind === "tab.create") return t("activity.revert.closeTab");
  if (step.kind === "tab.remove") return t("activity.revert.reopenTab");
  const action = actionOf(step);
  return t("activity.revert.generic", {
    action: action
      ? actionTitle(runtime, step, text) || t("activity.kind.action")
      : t(TYPE_LABEL[step.kind] ?? "activity.kind.action"),
  });
}

function confirmCopy(
  step: ActivityStep,
  choice: "action" | "instant",
  t: T,
) {
  if (choice === "instant" || step.kind.startsWith("layout."))
    return t("activity.confirm.layout");
  if (step.kind === "tile.open") return t("activity.confirm.tileOpen");
  if (step.kind === "tile.close") return t("activity.confirm.tileClose");
  if (step.kind === "tab.create" || step.kind === "tab.remove")
    return t("activity.confirm.tab");
  if (step.kind.startsWith("action:")) {
    const action = actionOf(step);
    if (action?.action === "save") return t("activity.confirm.file");
    return t("activity.confirm.content");
  }
  return t("activity.confirm.content");
}

function needsConfirm(
  step: ActivityStep,
  choice: "action" | "instant",
  steps: readonly ActivityStep[],
) {
  if (
    choice === "instant" ||
    step.kind.startsWith("action:") ||
    step.kind.startsWith("tile.") ||
    step.kind.startsWith("tab.")
  )
    return true;
  const entry = step.entries.find((candidate) =>
    candidate.kind.startsWith("layout."),
  );
  const tile = entry?.tileId ?? recordOf(entry?.data).tile;
  return steps.some(
    (candidate) =>
      candidate.at > step.at &&
      candidate.entries.some((other) => {
        if (!other.kind.startsWith("layout.")) return false;
        const otherTile = other.tileId ?? recordOf(other.data).tile;
        return otherTile === tile;
      }),
  );
}

function StepIcon({ step }: { step: ActivityStep }) {
  if (step.kind.startsWith("action:")) {
    const action = actionOf(step);
    const name = action?.action;
    if (
      name === "write" ||
      name === "append" ||
      name === "insert" ||
      name === "replace" ||
      name === "delete" ||
      name === "save"
    )
      return <PenLine aria-hidden />;
    if (name === "navigate") return <Globe aria-hidden />;
    if (name === "set_chart") return <ChartLine aria-hidden />;
    if (
      name === "append_rows" ||
      name === "set_cell" ||
      name === "add_column" ||
      name === "create_table"
    )
      return <Table2 aria-hidden />;
    return <Zap aria-hidden />;
  }
  if (step.kind === "layout.move") return <Move aria-hidden />;
  if (step.kind === "layout.resize") return <Scaling aria-hidden />;
  if (step.kind === "tile.open") return <AppWindow aria-hidden />;
  if (step.kind === "tile.close") return <X aria-hidden />;
  if (step.kind === "tab.create") return <Plus aria-hidden />;
  if (step.kind === "tab.remove") return <Minus aria-hidden />;
  if (step.kind === "layout.undo") return <Undo2 aria-hidden />;
  if (step.kind === "layout.redo") return <Redo2 aria-hidden />;
  return <Zap aria-hidden />;
}

function ActivityRow({
  runtime,
  tab,
  step,
  now,
  locale,
  t,
  tp,
  text,
  onChoose,
}: {
  runtime: Runtime;
  tab: Tab;
  step: ActivityStep;
  now: number;
  locale: Locale;
  t: T;
  tp: TP;
  text: TextFn;
  onChoose: (step: ActivityStep, choice: "action" | "instant") => void;
}) {
  const state = revertState(runtime, tab, step, t);
  const canChoose =
    (state.undo?.enabled ?? false) || (state.instant?.enabled ?? false);
  const blocked =
    state.undo?.reason ?? state.instant?.reason ?? undefined;
  const path = pathOf(runtime, tab, step, text, t);
  const detail = [
    detailOf(runtime, step, locale, text, t, tp),
    step.unavailable ? t(step.unavailable) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      className={
        step.revertedAt ? "activity-row is-dissolving" : "activity-row"
      }
    >
      <div className="activity-main">
        <div
          className="activity-path"
          title={`${path.tab} › ${path.subject}`}
        >
          <span className="activity-path-tab">{path.tab}</span>
          <ChevronRight aria-hidden />
          <span className="activity-path-subject">{path.subject}</span>
        </div>
        <div className="activity-title">
          <span className="activity-glyph" aria-hidden>
            <StepIcon step={step} />
          </span>
          <span className="activity-label">
            {titleFor(runtime, step, text, t)}
          </span>
          {detail && <span className="activity-detail">· {detail}</span>}
        </div>
      </div>
      <div className="activity-side">
        <time
          className="activity-time"
          dateTime={new Date(step.at).toISOString()}
          title={new Intl.DateTimeFormat(locale, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(step.at)}
        >
          {relative(step.at, locale, now, t)}
        </time>
        {state.has ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="activity-revert size-6"
                aria-label={revertLabel(step, runtime, text, t)}
                title={canChoose ? undefined : blocked}
                disabled={!canChoose}
              >
                <Undo2 aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {state.undo && (
                <DropdownMenuItem
                  disabled={!state.undo.enabled}
                  onSelect={() => onChoose(step, "action")}
                >
                  <div className="activity-menu-item">
                    <span>{revertLabel(step, runtime, text, t)}</span>
                    {!state.undo.enabled && state.undo.reason && (
                      <small>{state.undo.reason}</small>
                    )}
                  </div>
                </DropdownMenuItem>
              )}
              {state.instant && (
                <DropdownMenuItem
                  disabled={!state.instant.enabled}
                  onSelect={() => onChoose(step, "instant")}
                >
                  <div className="activity-menu-item">
                    <span>{t("activity.revert.instant")}</span>
                    {!state.instant.enabled && state.instant.reason && (
                      <small>{state.instant.reason}</small>
                    )}
                  </div>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </article>
  );
}

interface SessionGroup {
  key: string;
  agent: ActivityAgent;
  steps: ActivityStep[];
}

interface DayGroup {
  key: string;
  label: string;
  sessions: SessionGroup[];
}

export function ActivityControl({
  runtime,
  tabId,
}: {
  runtime: Runtime;
  tabId: string;
}) {
  const { t, tp, text, locale } = useI18n();
  const { activity } = runtime;
  const revision = useSyncExternalStore(
    activity.subscribe,
    activity.version,
    activity.version,
  );
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState<
    { step: ActivityStep; choice: "action" | "instant" } | undefined
  >();
  const [clearing, setClearing] = useState(false);
  const [dissolving, setDissolving] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const steps = activity.stepsFor(tabId);
  const visible = useMemo(
    () =>
      steps.filter(
        (step) => !step.revertedAt || dissolving.has(step.id),
      ),
    [dissolving, steps],
  );

  useEffect(() => {
    void activity.ensure(tabId);
  }, [activity, tabId]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!open || !steps[0] || activity.seenAt(tabId) >= steps[0].at) return;
    activity.markSeen(tabId);
  }, [activity, open, revision, steps, tabId]);

  const tab = runtime.workspace.get().tabs.find((item) => item.id === tabId);
  const unread = activity.unread(tabId) && !open;

  const days = useMemo(() => {
    const list: DayGroup[] = [];
    let day: DayGroup | undefined;
    let session: SessionGroup | undefined;
    for (const step of visible) {
      const key = dayKey(step.at);
      if (!day || day.key !== `day:${key}`) {
        day = {
          key: `day:${key}`,
          label: dayLabel(step.at, locale, t),
          sessions: [],
        };
        list.push(day);
        session = undefined;
      }
      if (!session || session.agent.id !== step.agent.id) {
        session = {
          key: `session:${day.key}:${day.sessions.length}`,
          agent: step.agent,
          steps: [],
        };
        day.sessions.push(session);
      }
      session.steps.push(step);
    }
    return list;
  }, [locale, t, visible]);

  if (!tab) return null;

  const run = (step: ActivityStep, choice: "action" | "instant") => {
    setPending(undefined);
    setDissolving((previous) => new Set(previous).add(step.id));
    void revertStep(runtime, step, choice)
      .then(() => {
        toast.success(t("activity.toast.reverted"));
        const reduced = window.matchMedia?.(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        window.setTimeout(
          () => {
            setDissolving((previous) => {
              const next = new Set(previous);
              next.delete(step.id);
              return next;
            });
            void activity.forget(step.id);
          },
          reduced ? 40 : 820,
        );
      })
      .catch((error) => {
        setDissolving((previous) => {
          const next = new Set(previous);
          next.delete(step.id);
          return next;
        });
        toast.error(
          t("activity.toast.failed", { reason: revertFailure(error) }),
        );
      });
  };

  const choose = (step: ActivityStep, choice: "action" | "instant") => {
    if (needsConfirm(step, choice, steps)) setPending({ step, choice });
    else run(step, choice);
  };

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) setNow(Date.now());
          setOpen(next);
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="activity-trigger size-8 shrink-0"
                aria-label={
                  unread
                    ? t("activity.trigger.unread")
                    : t("activity.trigger")
                }
              >
                <History aria-hidden />
                {unread && <span className="activity-dot" aria-hidden />}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("activity.trigger")}</TooltipContent>
        </Tooltip>
        <PopoverContent
          align="end"
          side="bottom"
          sideOffset={8}
          className="activity-popover"
          style={{
            width: "min(380px, calc(100vw - 24px))",
            padding: 0,
          }}
          aria-label={t("activity.title")}
          onInteractOutside={(event) => {
            if (
              event.target instanceof HTMLElement &&
              event.target.closest(
                '[data-slot="dropdown-menu-content"], [data-slot="dialog-content"]',
              )
            )
              event.preventDefault();
          }}
        >
          <header className="activity-head">
            <div>
              <h2>{t("activity.title")}</h2>
              <p>{t("activity.description")}</p>
            </div>
            <span className="activity-count" aria-hidden>
              {visible.length}
            </span>
          </header>
          {visible.length ? (
            <>
              <div
                className="activity-scroll"
                tabIndex={0}
                aria-label={t("activity.trigger")}
              >
                {days.map((day) => (
                  <div className="activity-day-group" key={day.key}>
                    <div className="activity-day">{day.label}</div>
                    {day.sessions.map((session) => (
                      <section
                        className="activity-session-group"
                        key={session.key}
                      >
                        <div className="activity-session">
                          <span className="activity-session-mark" aria-hidden>
                            <AgentMark agent={brandOf(session.agent)} />
                          </span>
                          <span className="activity-session-name">
                            {session.agent.label}
                          </span>
                          {session.agent.version && (
                            <span className="activity-session-version">
                              {session.agent.version}
                            </span>
                          )}
                        </div>
                        <div className="activity-session-body">
                          {session.steps.map((step) => (
                            <ActivityRow
                              key={step.id}
                              runtime={runtime}
                              tab={tab}
                              step={step}
                              now={now}
                              locale={locale}
                              t={t}
                              tp={tp}
                              text={text}
                              onChoose={choose}
                            />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                ))}
              </div>
              <footer className="activity-foot">
                <span>
                  {tp("activity.footer", visible.length, {
                    count: visible.length,
                  })}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs"
                  title={t("activity.clear.action")}
                  aria-label={t("activity.clear.action")}
                  onClick={() => setClearing(true)}
                >
                  {t("activity.clear.confirm")}
                </Button>
              </footer>
            </>
          ) : (
            <div className="activity-empty">
              <span className="activity-empty-icon" aria-hidden>
                <History />
              </span>
              <p className="activity-empty-title">
                {t("activity.empty.title")}
              </p>
              <p className="activity-empty-detail">
                {t("activity.empty.description")}
              </p>
            </div>
          )}
        </PopoverContent>
      </Popover>

      <Dialog
        open={!!pending}
        onOpenChange={(next) => {
          if (!next) setPending(undefined);
        }}
      >
        <DialogContent showCloseButton={false} className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("activity.confirm.title")}</DialogTitle>
            <DialogDescription>
              {pending ? confirmCopy(pending.step, pending.choice, t) : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(undefined)}>
              {t("activity.confirm.cancel")}
            </Button>
            <Button
              onClick={() => {
                if (pending) run(pending.step, pending.choice);
              }}
            >
              {t("activity.confirm.run")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={clearing} onOpenChange={setClearing}>
        <DialogContent showCloseButton={false} className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("activity.clear.title")}</DialogTitle>
            <DialogDescription>
              {t("activity.clear.description")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearing(false)}>
              {t("activity.confirm.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setClearing(false);
                void activity.clear();
              }}
            >
              {t("activity.clear.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
