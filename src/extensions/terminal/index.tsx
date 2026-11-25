import { Channel, invoke } from "@tauri-apps/api/core";
import { Button } from "@spark/ui/components/button";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { terminalClosed, terminalLauncher, terminalSessions } from "./api.ts";
import type { ExtensionModule, TileViewProps } from "../../sdk/react.ts";
import {
  AgentMark,
  agentFor,
  type AgentBrand,
} from "../../shared/agents/index.tsx";
import { localized } from "../../core/i18n.ts";
import { t as translateNow } from "../../i18n/index.ts";
import { useI18n } from "../../i18n/react.ts";
import manifest, { sessionType } from "./manifest.ts";
import "@xterm/xterm/css/xterm.css";
import "./style.css";

type Output = { type: "data"; bytes: number[] } | { type: "closed" };

const ansiColors = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
] as const;

function terminalTheme(): ITheme {
  const styles = getComputedStyle(document.documentElement);
  const color = (token: string) => styles.getPropertyValue(token).trim();
  const palette = Object.fromEntries(
    ansiColors.flatMap((name) => [
      [name, color(`--terminal-${name}`)],
      [
        `bright${name[0].toUpperCase()}${name.slice(1)}`,
        color(`--terminal-bright-${name}`),
      ],
    ]),
  );
  return {
    ...palette,
    background: color("--tile"),
    foreground: color("--foreground"),
    cursor: color("--terminal-cursor"),
    cursorAccent: color("--tile"),
    selectionBackground: color("--terminal-selection"),
  };
}

const terminalUnavailableKey = "terminal.unavailable";

function UnavailableTerminalTile() {
  const { t } = useI18n();
  return <p className="tile-message">{t(terminalUnavailableKey)}</p>;
}

export default function createTerminal(): ExtensionModule {
  const terminalSupported = !navigator.platform.toLowerCase().startsWith("win");
  const sessions = new Map<
    string,
    {
      id: string;
      running: boolean;
      nativeId: string;
      ready: Promise<void>;
    }
  >();
  let notifyClosed: (id: string) => void;

  // Une seule vérification à la fois par agent, mais la proposition revient
  // à chaque lancement tant que le client n'est pas connecté.
  const checking = new Set<string>();
  async function connectAgent(agent: AgentBrand) {
    if (!agent.setup) {
      // Client sans format connu : on ouvre la configuration à copier.
      window.dispatchEvent(
        new CustomEvent("spark:connect-agent", {
          detail: { name: agent.name },
        }),
      );
      return;
    }
    try {
      const message = await invoke<string>("agent_setup", { agent: agent.id });
      toast.success(message, {
        description: translateNow("terminal.agent.restart"),
      });
    } catch (error) {
      toast.error(String(error));
    }
  }
  function showOffer(agent: AgentBrand) {
    toast(translateNow("terminal.agent.launched", { name: agent.name }), {
      icon: <AgentMark agent={agent} width={18} height={18} />,
      description: translateNow("terminal.agent.connect.description"),
      action: {
        label: translateNow("terminal.agent.connect.action"),
        onClick: () => void connectAgent(agent),
      },
      cancel: {
        label: translateNow("terminal.agent.later"),
        onClick: () => {},
      },
      duration: 9000,
    });
  }
  function offerAgent(agent: AgentBrand) {
    if (checking.has(agent.id)) return;
    checking.add(agent.id);
    // Déjà branché sur ce pont : on ne repropose rien.
    void invoke<boolean>("agent_connected", { agent: agent.id })
      .then((connected) => {
        if (!connected) showOffer(agent);
      })
      .catch(() => showOffer(agent))
      .finally(() => checking.delete(agent.id));
  }

  async function close(id: string) {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    await session.ready.catch(() => {});
    await invoke("terminal_close", { id: session.nativeId });
  }

  function TerminalTile({ tile, active }: TileViewProps) {
    const { t } = useI18n();
    const host = useRef<HTMLDivElement>(null);
    const fitCurrent = useRef<() => void>(() => {});
    const retryButton = useRef<HTMLButtonElement>(null);
    const [attempt, setAttempt] = useState(0);
    const [failure, setFailure] = useState<{
      attempt: number;
      message: string;
    } | null>(null);
    const retrying = failure !== null && failure.attempt !== attempt;
    useEffect(() => {
      const element = host.current!;
      const terminal = new Terminal({
        theme: terminalTheme(),
        allowTransparency: true,
        minimumContrastRatio: 4.5,
        fontFamily: "ui-monospace, Menlo, Consolas, monospace",
        fontSize: 13,
        cursorBlink: true,
        scrollback: 5000,
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(element);
      // Le shell signale chaque commande lancée (OSC 777) : on y reconnaît
      // un agent pour proposer la connexion MCP sans surveiller les frappes.
      const agents = terminal.parser.registerOscHandler(777, (data) => {
        const match = /^spark;(.+)$/.exec(data);
        if (!match) return false;
        const agent = agentFor(match[1]);
        if (agent) offerAgent(agent);
        return true;
      });
      let wheelRemainder = 0;
      terminal.attachCustomWheelEventHandler((event) => {
        const buffer = terminal.buffer.active;
        if (
          buffer.type !== "normal" ||
          terminal.modes.mouseTrackingMode !== "none"
        ) {
          wheelRemainder = 0;
          return true;
        }
        // Keep horizontal gestures available to the workspace's Side layout.
        if (
          event.ctrlKey ||
          event.shiftKey ||
          !event.deltaY ||
          Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ) {
          return false;
        }
        if (
          event.deltaY < 0
            ? buffer.viewportY === 0
            : buffer.viewportY === buffer.baseY
        ) {
          wheelRemainder = 0;
          return false;
        }
        const rowHeight =
          (element.clientHeight -
            parseFloat(getComputedStyle(element).paddingTop) -
            parseFloat(getComputedStyle(element).paddingBottom)) /
          terminal.rows;
        const delta =
          event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? event.deltaY
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
              ? event.deltaY * terminal.rows
              : event.deltaY / Math.max(rowHeight, 1);
        if (Math.sign(delta) !== Math.sign(wheelRemainder)) wheelRemainder = 0;
        wheelRemainder += delta;
        const lines = Math.trunc(wheelRemainder);
        wheelRemainder -= lines;
        // Scroll xterm's buffer directly so WebKit can't reset a viewport-only change.
        terminal.scrollLines(lines);
        event.preventDefault();
        return false;
      });

      let disposed = false;
      let session:
        | (typeof sessions extends Map<string, infer Value> ? Value : never)
        | undefined;
      let lastSize = "";
      let input = Promise.resolve();
      const report = (error: unknown) => {
        if (!disposed) toast.error(String(error));
      };

      function resize(start = false) {
        if (
          element.isConnected &&
          element.clientWidth &&
          element.clientHeight
        ) {
          fit.fit();
        } else if (!start) {
          return;
        }
        const { cols: columns, rows } = terminal;
        if (!session) {
          const nativeId = crypto.randomUUID();
          const output = new Channel<Output>((event) => {
            if (disposed) return;
            if (event.type === "data")
              terminal.write(Uint8Array.from(event.bytes));
            else {
              if (session) session.running = false;
              terminal.writeln(`\r\n${translateNow("terminal.session.ended")}`);
              notifyClosed(tile.id);
            }
          });
          const ready = invoke<void>("terminal_start", {
            id: nativeId,
            directory: tile.data.directory,
            columns,
            rows,
            output,
          });
          session = { id: tile.id, nativeId, running: true, ready };
          sessions.set(tile.id, session);
          const started = session;
          void ready.then(
            () => {
              if (disposed || attempt === 0) return;
              const restoreFocus =
                document.activeElement === retryButton.current;
              setFailure(null);
              if (restoreFocus) {
                requestAnimationFrame(() => {
                  if (!disposed && document.activeElement === document.body)
                    terminal.focus();
                });
              }
            },
            (error: unknown) => {
              started.running = false;
              if (!disposed) {
                setFailure({
                  attempt,
                  message:
                    error instanceof Error ? error.message : String(error),
                });
              }
            },
          );
        } else if (session.running && lastSize !== `${columns}:${rows}`) {
          const current = session;
          void current.ready
            .then(() =>
              invoke("terminal_resize", {
                id: current.nativeId,
                columns,
                rows,
              }),
            )
            .catch(report);
        }
        lastSize = `${columns}:${rows}`;
      }

      terminal.attachCustomKeyEventHandler((event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")
          return false;
        if (
          event.type === "keydown" &&
          event.key.toLowerCase() === "c" &&
          (event.metaKey || (event.ctrlKey && event.shiftKey)) &&
          terminal.hasSelection()
        ) {
          void navigator.clipboard
            .writeText(terminal.getSelection())
            .catch(report);
          return false;
        }
        return true;
      });
      const subscription = terminal.onData((data) => {
        const current = session;
        if (!current?.running) return;
        input = input
          .then(() => current.ready)
          .then(() =>
            current.running && !disposed
              ? invoke<void>("terminal_input", {
                  id: current.nativeId,
                  input: data,
                })
              : undefined,
          )
          .catch(report);
      });
      const observer = new ResizeObserver(() => resize());
      observer.observe(element);
      // Un panneau masqué n'a pas de rectangle, mais son shell doit rester
      // disponible aux agents. xterm le remet à la bonne taille à l'affichage.
      resize(true);
      const refreshTheme = () => {
        terminal.options.theme = terminalTheme();
      };
      const theme = new MutationObserver(refreshTheme);
      theme.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
      // En développement, un changement de token CSS ne change pas la classe
      // du document : sans cela, le fond xterm resterait sur l'ancienne tuile.
      import.meta.hot?.on("vite:afterUpdate", refreshTheme);
      fitCurrent.current = resize;
      return () => {
        disposed = true;
        observer.disconnect();
        theme.disconnect();
        import.meta.hot?.off("vite:afterUpdate", refreshTheme);
        subscription.dispose();
        agents.dispose();
        terminal.dispose();
        void close(tile.id).catch((error) => toast.error(String(error)));
      };
    }, [attempt, tile.id, tile.data.directory]);

    useEffect(() => {
      if (active) requestAnimationFrame(() => fitCurrent.current());
    }, [active]);
    return (
      <div className="relative h-full">
        <div
          className="terminal-view"
          style={{ visibility: failure ? "hidden" : undefined }}
          ref={host}
        />
        {failure && (
          <div className="absolute inset-0 flex flex-col items-start gap-3 overflow-auto p-3">
            <div role="alert">
              <p className="font-medium">{t("terminal.failure.title")}</p>
              <p className="wrap-anywhere text-muted-foreground">
                {failure.message}
              </p>
              {tile.data.directory && (
                <p className="text-muted-foreground">
                  {t("terminal.failure.directory")}
                </p>
              )}
            </div>
            <Button
              ref={retryButton}
              variant="outline"
              size="sm"
              aria-disabled={retrying}
              onClick={() => {
                if (!retrying) setAttempt(attempt + 1);
              }}
            >
              {retrying ? t("terminal.starting") : t("terminal.retry")}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return {
    activate(api) {
      notifyClosed = (id) => api.events.emit(terminalClosed, id);
      api.tiles.register({
        type: sessionType,
        title: localized("terminal.tile.session"),
        icon: manifest.icon,
        guide: localized("terminal.guide.session"),
        view: terminalSupported ? TerminalTile : UnavailableTerminalTile,
        dataKeys: ["directory"],
        describe: (tile) => {
          const session = sessions.get(tile.id);
          const state = !session
            ? translateNow("terminal.describe.idle")
            : session.running
              ? translateNow("terminal.describe.running")
              : translateNow("terminal.describe.ended");
          return tile.data.directory
            ? `${tile.data.directory} · ${state}`
            : state;
        },
        prepare: (data) => {
          if (!terminalSupported)
            throw new Error(translateNow(terminalUnavailableKey));
          return data;
        },
        close: (tile) => close(tile.id),
      });
      api.commands.register({
        id: "terminal.new",
        title: terminalSupported
          ? localized("terminal.command.new")
          : localized("terminal.command.availability"),
        icon: manifest.icon,
        tileType: sessionType,
        run: () => api.tabs.openTile(sessionType),
      });
      if (terminalSupported) {
        api.services.provide(terminalLauncher, {
          open: (directory, alongside) =>
            api.tabs.openTile(sessionType, { directory }, alongside),
        });
      }
      api.services.provide(terminalSessions, {
        get: (id) => {
          const session = sessions.get(id);
          return session && { id, running: session.running };
        },
        list: () =>
          [...sessions.values()].map(({ id, running }) => ({ id, running })),
      });
    },
    async deactivate() {
      await Promise.all([...sessions.keys()].map(close));
    },
  };
}
