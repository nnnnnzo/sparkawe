import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ActivityAgent } from "../core/activity.ts";
import type { Data, LocalizedText, Tile } from "../sdk/index.ts";
import { agentForClient } from "../shared/agents/data.ts";
import { text as translateText } from "../i18n/index.ts";
import { report } from "../ui/errors.ts";
import type { Runtime } from "./runtime.ts";
import { runLayoutCommand } from "../ui/layoutBridge.ts";
import { BRIEF_TILE_LIMIT, readOutputs } from "./mcpSchemas.ts";

const PROTOCOL = "2025-06-18";

const instructions = [
  "Spark est un espace de travail à onglets. Chaque onglet est un contexte indépendant",
  "avec ses tuiles : terminal, fichiers, documents, recherches.",
  "Commencez par spark_brief pour voir l’onglet actif. Pour du contenu précis, lisez une",
  "tuile avec spark_tile_read, puis agissez avec spark_tile_call. Ne demandez pas de contenu",
  "que l’interface affiche déjà : la tuile le détient.",
].join(" ");

interface Message {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

class McpError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

const answer = (id: string | number | null, result: unknown) =>
  JSON.stringify({ jsonrpc: "2.0", id, result });
const problem = (
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data ? { data } : {}) },
  });
const failure = (value: string) => ({
  content: [{ type: "text", text: value }],
  isError: true,
});

function tileOf(runtime: Pick<Runtime, "workspace">, id: unknown): Tile {
  if (typeof id !== "string") throw new McpError(-32602, "Tuile manquante.");
  const tile = runtime.workspace
    .get()
    .tabs.flatMap((tab) => tab.tiles)
    .find((candidate) => candidate.id === id);
  if (!tile) throw new McpError(-32602, `Tuile inconnue : ${id}`);
  return tile;
}

const object = (value: unknown) =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

type McpRuntime = Pick<
  Runtime,
  "workspace" | "registry" | "journal" | "brief" | "closeTiles"
>;

export function createMcpServer(
  runtime: McpRuntime,
  cacheTools?: (snapshot: string) => void,
  onSession?: (session: ActivityAgent) => void,
) {
  const sessions = new Map<number, ActivityAgent>();
  /** Texte pour tous les clients, objet propre pour ceux qui lisent structuredContent. */
  function toolResult(value: unknown, structured?: Record<string, unknown>) {
    const shape =
      structured ??
      (typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : { result: value });
    return {
      content: [{ type: "text", text: JSON.stringify(value) }],
      structuredContent: shape,
    };
  }

  // Un guide est un mode d'emploi stable : on le livre une fois par session
  // d'agent, au premier catalogue ou à la première lecture de ce type de tuile.
  const deliveredGuides = new Set<string>();
  function guideFor(definition: { type: string; guide?: LocalizedText }) {
    if (!definition.guide || deliveredGuides.has(definition.type))
      return undefined;
    deliveredGuides.add(definition.type);
    return translateText(definition.guide);
  }

  interface Tool {
    name: string;
    description: string | (() => string);
    inputSchema: Record<string, unknown>;
  }
  const readOutput = (name: string) =>
    Object.hasOwn(readOutputs, name)
      ? readOutputs[name as keyof typeof readOutputs]
      : undefined;
  const tools = (): Tool[] => [
    {
      name: "spark_brief",
      description:
        "Résumé compact d’un onglet Spark : tuiles ouvertes, état et derniers événements. À appeler en premier. Pour lire une tuile depuis du code, utilisez tileRefs[].ref plutôt que de parser le texte.",
      inputSchema: {
        type: "object",
        properties: {
          tab: {
            type: "string",
            description: "Identifiant d’onglet. Par défaut, l’onglet actif.",
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: "spark_tabs",
      description: "Liste les onglets et leur disposition (side ou tiling).",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "spark_tiles",
      description:
        "Catalogue compact des types de tuiles : extension, actions, disponibilité. Passez detail « full » pour les descriptions et les schémas d’entrée.",
      inputSchema: {
        type: "object",
        properties: {
          detail: {
            type: "string",
            enum: ["compact", "full"],
            description: "Niveau de détail. Compact par défaut.",
          },
        },
      },
    },
    {
      name: "spark_tab_open",
      description:
        "Crée un onglet en arrière-plan, sans changer l’onglet actif, et renvoie son identifiant. Passez cet identifiant en `tab` pour y ouvrir des tuiles.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nom de l’onglet." },
          mode: {
            type: "string",
            enum: ["side", "tiling"],
            description: "Disposition des tuiles. Par défaut, side.",
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: "spark_tab_close",
      description:
        "Ferme un onglet et ses tuiles. Refusé si un document non enregistré empêche la fermeture.",
      inputSchema: {
        type: "object",
        properties: { tab: { type: "string" } },
        required: ["tab"],
      },
    },
    {
      name: "spark_tab_focus",
      description: "Active un onglet.",
      inputSchema: {
        type: "object",
        properties: { tab: { type: "string" } },
        required: ["tab"],
      },
    },
    {
      name: "spark_tile_open",
      description: () =>
        `Ouvre une tuile d’extension et renvoie sa référence. Types disponibles : ${
          runtime.registry
            .getTileDefinitions()
            .map((definition) => definition.type)
            .join(", ") || "aucun"
        }.`,
      inputSchema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            description:
              "Type de tuile. Voir spark_tiles pour la liste disponible.",
          },
          tab: {
            type: "string",
            description: "Onglet cible. Par défaut, l’onglet actif.",
          },
          data: {
            type: "object",
            description: "Données initiales, sous forme de chaînes.",
          },
        },
        required: ["type"],
      },
    },
    {
      name: "spark_tile_read",
      description:
        "Lit l’état déclaré d’une tuile : surface, données, actions disponibles. Ne transporte pas de contenu lourd.",
      inputSchema: {
        type: "object",
        properties: { tile: { type: "string" } },
        required: ["tile"],
      },
    },
    {
      name: "spark_tile_call",
      description:
        "Exécute une action déclarée par une tuile. Les actions marquées mutates sont exécutées ; la confirmation appartient au client MCP.",
      inputSchema: {
        type: "object",
        properties: {
          tile: { type: "string" },
          action: { type: "string" },
          args: { type: "object", description: "Arguments de l’action." },
        },
        required: ["tile", "action"],
      },
    },
    {
      name: "spark_tile_close",
      description: "Ferme une tuile.",
      inputSchema: {
        type: "object",
        properties: { tile: { type: "string" } },
        required: ["tile"],
      },
    },
    {
      name: "spark_tile_move",
      description:
        "Déplace une tuile de l’onglet actif à côté d’une autre (left, right, top, bottom), sans la fermer. La position et la taille résultantes sont conservées.",
      inputSchema: {
        type: "object",
        properties: {
          tile: { type: "string" },
          target: {
            type: "string",
            description: "Tuile de référence, dans le même onglet.",
          },
          side: {
            type: "string",
            enum: ["left", "right", "top", "bottom", "center"],
            description:
              "Côté de la cible où placer la tuile. center l’ajoute comme onglet dans son groupe.",
          },
        },
        required: ["tile", "target", "side"],
      },
    },
    {
      name: "spark_tile_resize",
      description:
        "Redimensionne une tuile de l’onglet actif. width et height sont des fractions de l’onglet (0,05 à 1) ; au moins l’une des deux est requise.",
      inputSchema: {
        type: "object",
        properties: {
          tile: { type: "string" },
          width: {
            type: "number",
            description: "Fraction de la largeur de l’onglet (0,05 à 1).",
          },
          height: {
            type: "number",
            description: "Fraction de la hauteur de l’onglet (0,05 à 1).",
          },
        },
        required: ["tile"],
      },
    },
    {
      name: "spark_undo",
      description:
        "Annule le dernier déplacement ou redimensionnement de tuile dans l’onglet actif.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "spark_redo",
      description:
        "Rétablit le dernier déplacement ou redimensionnement annulé dans l’onglet actif.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "spark_events_since",
      description:
        "Événements du journal postérieurs à une séquence : ce qui vient de changer.",
      inputSchema: {
        type: "object",
        properties: { seq: { type: "number" }, limit: { type: "number" } },
        required: ["seq"],
      },
    },
  ];

  function sessionFor(connection: number): ActivityAgent {
    const existing = sessions.get(connection);
    if (existing) return existing;
    const brand = agentForClient();
    const session: ActivityAgent = {
      id: crypto.randomUUID(),
      brand: brand.id,
      name: brand.name,
      label: brand.name,
      startedAt: Date.now(),
    };
    sessions.set(connection, session);
    onSession?.(session);
    return session;
  }

  function openSession(connection: number, params: Record<string, unknown>) {
    const info = object(params.clientInfo);
    const name = typeof info.name === "string" ? info.name : undefined;
    const title = typeof info.title === "string" ? info.title : undefined;
    const version = typeof info.version === "string" ? info.version : undefined;
    const brand = agentForClient(name, title);
    const live = [...sessions.values()].filter(
      (session) =>
        session.brand === brand.id &&
        session.id !== sessions.get(connection)?.id,
    ).length;
    const session: ActivityAgent = {
      id: crypto.randomUUID(),
      brand: brand.id,
      name: brand.name,
      ...(version ? { version } : {}),
      label: live ? `${brand.name} ${live + 1}` : brand.name,
      startedAt: Date.now(),
    };
    sessions.set(connection, session);
    onSession?.(session);
    return session;
  }

  function openTile(args: Record<string, unknown>) {
    const type = String(args.type ?? "");
    const definition = runtime.registry.getTile(type);
    if (!definition)
      throw new McpError(
        -32602,
        `Tuile indisponible : ${type}. L’extension est peut-être inactive.`,
      );
    const tab =
      typeof args.tab === "string"
        ? runtime.workspace.get().tabs.find((tab) => tab.id === args.tab)
        : runtime.workspace.active();
    if (!tab) throw new McpError(-32602, `Onglet inconnu : ${args.tab}`);
    const data = object(args.data) as Data;
    const keys = definition.dataKeys;
    if (keys)
      for (const key of Object.keys(data))
        if (!keys.includes(key))
          throw new McpError(
            -32602,
            `Donnée inconnue pour ${type} : ${key}. Clés acceptées : ${keys.join(", ") || "aucune"}.`,
          );
    const tile = runtime.workspace.addTile(
      type,
      definition.prepare?.(data) ?? data,
      tab.id,
    );
    const surface = runtime.registry.surface(tile.id) ?? {};
    return {
      ref: tile.id,
      type,
      title: translateText(definition.title),
      tab: tab.id,
      summary: definition.describe?.(tile, surface) ?? "",
    };
  }

  function readTile(args: Record<string, unknown>) {
    const tile = tileOf(runtime, args.tile);
    const definition = runtime.registry.getTile(tile.type);
    const surface = runtime.registry.surface(tile.id) ?? {};
    return {
      ref: tile.id,
      type: tile.type,
      title: definition ? translateText(definition.title) : tile.type,
      summary: definition?.describe?.(tile, surface) ?? "",
      guide: definition ? guideFor(definition) : undefined,
      data: tile.data,
      surface,
      actions: Object.entries(definition?.actions ?? {}).map(
        ([name, action]) => ({
          name,
          title: translateText(action.title),
          description: action.description
            ? translateText(action.description)
            : undefined,
          input: action.input,
          mutates: runtime.registry.mutates(tile, action),
          available: runtime.registry.available(action),
          requires: action.requires?.map((key) => key.id) ?? [],
        }),
      ),
    };
  }

  async function callTile(
    args: Record<string, unknown>,
    session: ActivityAgent,
    op: string,
  ) {
    const tile = tileOf(runtime, args.tile);
    const name = String(args.action ?? "");
    const definition = runtime.registry.getTile(tile.type);
    if (!definition)
      throw new McpError(
        -32602,
        `Tuile inactive : l’extension de ${tile.type} n’est pas active.`,
      );
    const action = runtime.registry.getAction(tile.type, name);
    if (!action) {
      const names = Object.keys(definition.actions ?? {});
      throw new McpError(
        -32602,
        `Action indisponible : ${tile.type}.${name}. Disponibles : ${names.join(", ") || "aucune"}.`,
      );
    }
    const input = object(args.args) as Record<
      string,
      string | number | boolean
    >;
    return runtime.registry.callAction(tile.id, name, input, {
      source: "agent",
      agent: session.id,
      op,
    });
  }

  async function closeTile(args: Record<string, unknown>) {
    const tile = tileOf(runtime, args.tile);
    const tab = runtime.workspace.tabForTile(tile.id);
    if (!tab) throw new McpError(-32602, `Tuile inconnue : ${tile.id}`);
    const closed = await runtime.closeTiles([tile.id], () =>
      runtime.workspace.removeTile(tab.id, tile.id),
    );
    if (!closed)
      throw new McpError(
        -32603,
        "Fermeture annulée : le document contient des modifications non enregistrées. Enregistrez-le ou confirmez la fermeture dans l’interface.",
      );
    return { closed: tile.id };
  }

  async function execute(
    name: string,
    args: Record<string, unknown>,
    call: { session: ActivityAgent; op: string },
  ) {
    switch (name) {
      case "spark_brief": {
        const brief = runtime.brief(
          typeof args.tab === "string" ? args.tab : undefined,
        );
        return {
          content: [{ type: "text", text: brief.text }],
          // Certains clients ne montrent au modèle que structuredContent :
          // le brief doit y figurer en entier, pas seulement ses identifiants.
          structuredContent: {
            text: brief.text,
            tab: brief.tab.id,
            lastSeq: brief.lastSeq,
            tileRefs: brief.tab.tiles
              .slice(0, BRIEF_TILE_LIMIT)
              .map(({ id, type }) => ({ ref: id, type })),
            tileRefsTruncated: brief.tab.tiles.length > BRIEF_TILE_LIMIT,
          },
        };
      }
      case "spark_tabs": {
        const tabs = runtime.workspace.get().tabs.map((tab) => ({
          id: tab.id,
          name: tab.name,
          mode: tab.mode,
          active: tab.id === runtime.workspace.get().active,
          tiles: tab.tiles.length,
        }));
        return toolResult(tabs, { tabs });
      }
      case "spark_tiles": {
        const detail = args.detail === "full" ? "full" : "compact";
        const tiles = runtime.registry
          .getTileDefinitions()
          .map((definition) => ({
            type: definition.type,
            title: translateText(definition.title),
            extension: definition.owner.id,
            tier: definition.owner.tier ?? "core",
            guide: guideFor(definition),
            actions: Object.entries(definition.actions ?? {}).map(
              ([name, action]) => ({
                name,
                mutates:
                  typeof action.mutates === "function" ||
                  action.mutates === true,
                available: runtime.registry.available(action),
                requires: action.requires?.map((key) => key.id) ?? [],
                ...(detail === "full"
                  ? {
                      title: translateText(action.title),
                      description: action.description
                        ? translateText(action.description)
                        : undefined,
                      input: action.input,
                    }
                  : {}),
              }),
            ),
          }));
        return toolResult(tiles, { tiles });
      }
      case "spark_tab_open": {
        const name = typeof args.name === "string" ? args.name : undefined;
        const mode =
          args.mode === "side" || args.mode === "tiling"
            ? args.mode
            : undefined;
        const tab = runtime.workspace.create(name, mode, false);
        return toolResult({
          tab: tab.id,
          name: tab.name,
          mode: tab.mode,
          active: false,
        });
      }
      case "spark_tab_close": {
        const id = String(args.tab ?? "");
        const tab = runtime.workspace
          .get()
          .tabs.find((candidate) => candidate.id === id);
        if (!tab) throw new McpError(-32602, `Onglet inconnu : ${id}`);
        const closed = await runtime.closeTiles(
          tab.tiles.map((tile) => tile.id),
          () => runtime.workspace.remove(id),
        );
        if (!closed)
          throw new McpError(
            -32603,
            "Fermeture annulée : une tuile contient des modifications non enregistrées. Confirmez-la dans l’interface.",
          );
        return toolResult({ closed: id });
      }
      case "spark_tab_focus": {
        const tab = runtime.workspace
          .get()
          .tabs.find((candidate) => candidate.id === args.tab);
        if (!tab) throw new McpError(-32602, `Onglet inconnu : ${args.tab}`);
        runtime.workspace.activate(tab.id);
        return toolResult({ active: tab.id });
      }
      case "spark_tile_open":
        return toolResult(openTile(args));
      case "spark_tile_read":
        return toolResult(readTile(args));
      case "spark_tile_call":
        return toolResult(await callTile(args, call.session, call.op));
      case "spark_tile_close":
        return toolResult(await closeTile(args));
      case "spark_tile_move": {
        const tile = String(args.tile ?? "");
        const target = String(args.target ?? "");
        const side = args.side;
        if (
          side !== "left" &&
          side !== "right" &&
          side !== "top" &&
          side !== "bottom" &&
          side !== "center"
        )
          throw new McpError(
            -32602,
            "Côté invalide : left, right, top, bottom ou center.",
          );
        const tab = runtime.workspace.tabForTile(tile);
        if (!tab) throw new McpError(-32602, `Tuile inconnue : ${tile}`);
        const targetTab = runtime.workspace.tabForTile(target);
        if (!targetTab || targetTab.id !== tab.id)
          throw new McpError(
            -32602,
            "La tuile cible doit être dans le même onglet.",
          );
        if (runtime.workspace.get().active !== tab.id)
          throw new McpError(
            -32603,
            "Activez l’onglet de la tuile avant de la déplacer.",
          );
        runLayoutCommand({ type: "move", tile, target, side });
        return toolResult({ tile, target, side, tab: tab.id });
      }
      case "spark_tile_resize": {
        const tile = String(args.tile ?? "");
        const width = args.width === undefined ? undefined : Number(args.width);
        const height =
          args.height === undefined ? undefined : Number(args.height);
        if (width === undefined && height === undefined)
          throw new McpError(
            -32602,
            "Indiquez width, height ou les deux (fractions de 0,05 à 1).",
          );
        for (const [name, value] of [
          ["width", width],
          ["height", height],
        ] as const) {
          if (value === undefined) continue;
          if (!Number.isFinite(value) || value < 0.05 || value > 1)
            throw new McpError(
              -32602,
              `${name} doit être une fraction entre 0,05 et 1.`,
            );
        }
        const tab = runtime.workspace.tabForTile(tile);
        if (!tab) throw new McpError(-32602, `Tuile inconnue : ${tile}`);
        if (runtime.workspace.get().active !== tab.id)
          throw new McpError(
            -32603,
            "Activez l’onglet de la tuile avant de la redimensionner.",
          );
        runLayoutCommand({ type: "resize", tile, width, height });
        return toolResult({ tile, width, height, tab: tab.id });
      }
      case "spark_undo": {
        runLayoutCommand({ type: "undo" });
        return toolResult({
          tab: runtime.workspace.get().active,
          action: "undo",
        });
      }
      case "spark_redo": {
        runLayoutCommand({ type: "redo" });
        return toolResult({
          tab: runtime.workspace.get().active,
          action: "redo",
        });
      }
      case "spark_events_since": {
        const seq = Number(args.seq);
        if (!Number.isFinite(seq))
          throw new McpError(-32602, "Séquence invalide.");
        const limit =
          typeof args.limit === "number" ? Math.min(args.limit, 100) : 20;
        const events = runtime.journal.since(seq, limit);
        return toolResult(events, { events });
      }
      default:
        throw new McpError(-32601, `Outil inconnu : ${name}`);
    }
  }

  async function callTool(
    params: Record<string, unknown>,
    connection: number,
  ) {
    try {
      const name = String(params.name ?? "");
      const session = sessionFor(connection);
      const call = { session, op: crypto.randomUUID() };
      const run = () => execute(name, object(params.arguments), call);
      return await (readOutput(name)
        ? run()
        : runtime.workspace.runAs("agent", run, {
            agent: session.id,
            op: call.op,
            // L'activité raconte l'onglet dans lequel l'agent travaillait,
            // même si l'effet touche une tuile d'un autre onglet.
            tabId: runtime.workspace.get().active,
          }));
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  }

  function resources() {
    return runtime.workspace.get().tabs.map((tab) => ({
      uri: `spark://tab/${tab.id}/brief`,
      name: `${tab.name} — brief`,
      mimeType: "text/plain",
    }));
  }

  function readResource(params: Record<string, unknown>) {
    const uri = String(params.uri ?? "");
    const match = /^spark:\/\/tab\/([^/]+)\/brief$/.exec(uri);
    if (!match) throw new McpError(-32602, `Ressource inconnue : ${uri}`);
    const brief = runtime.brief(decodeURIComponent(match[1]));
    return {
      contents: [{ uri, mimeType: "text/plain", text: brief.text }],
    };
  }

  async function dispatch(
    method: string,
    params: Record<string, unknown>,
    connection: number,
  ) {
    switch (method) {
      case "initialize": {
        // Nouvelle session d'agent : les guides sont de nouveau disponibles.
        deliveredGuides.clear();
        openSession(connection, params);
        return {
          protocolVersion:
            typeof params.protocolVersion === "string"
              ? params.protocolVersion
              : PROTOCOL,
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: "spark", version: "0.1.0" },
          instructions,
        };
      }
      case "ping":
        return {};
      case "notifications/initialized":
      case "notifications/cancelled":
      case "notifications/progress":
      case "notifications/roots/list_changed":
        return null;
      case "tools/list": {
        const list = tools().map(({ description, ...tool }) => {
          const outputSchema = readOutput(tool.name);
          return {
            ...tool,
            description:
              typeof description === "function" ? description() : description,
            ...(outputSchema && {
              outputSchema,
              annotations: { readOnlyHint: true },
            }),
          };
        });
        cacheTools?.(JSON.stringify(list));
        return { tools: list };
      }
      case "tools/call":
        return callTool(params, connection);
      case "resources/list":
        return { resources: resources() };
      case "resources/read":
        return readResource(params);
      default:
        throw new McpError(-32601, `Méthode inconnue : ${method}`);
    }
  }

  return {
    async handle(line: string, connection = 1): Promise<string | null> {
      let message: Message;
      try {
        message = JSON.parse(line) as Message;
      } catch {
        return problem(null, -32700, "JSON invalide.");
      }
      const { id, method } = message;
      if (typeof method !== "string")
        return id === undefined
          ? null
          : problem(id ?? null, -32600, "Requête invalide.");
      try {
        const result = await dispatch(
          method,
          message.params ?? {},
          connection,
        );
        return id === undefined ? null : answer(id ?? null, result);
      } catch (error) {
        // Une notification n'attend pas de réponse : on l'ignore sans alerter.
        if (id === undefined) return null;
        return problem(
          id ?? null,
          error instanceof McpError ? error.code : -32000,
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    close(connection: number) {
      sessions.delete(connection);
    },
  };
}

/** Relaie les messages du socket local vers la fenêtre et renvoie les réponses. */
export async function attachMcp(runtime: Runtime) {
  const server = createMcpServer(
    runtime,
    (snapshot) => {
      void invoke("mcp_cache_tools", { snapshot }).catch(report);
    },
    (session) => runtime.activity.registerAgent(session),
  );
  const unlisten = await listen<{ connection: number; line: string }>(
    "mcp:message",
    async (event) => {
      const { connection, line } = event.payload;
      const reply = await server.handle(line, connection);
      if (reply === null) return;
      try {
        await invoke("mcp_reply", { connection, line: reply });
      } catch (error) {
        report(error);
      }
    },
  );
  const closed = await listen<{ connection: number }>(
    "mcp:closed",
    ({ payload }) => server.close(payload.connection),
  );
  // Une extension activée ou retirée change les capacités : le client recharge
  // sa liste d'outils sans qu'on ait à le relancer.
  const unsubscribe = runtime.registry.subscribeTools(() => {
    void invoke("mcp_notify", {
      line: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/tools/list_changed",
      }),
    }).catch(report);
  });
  return () => {
    unsubscribe();
    unlisten();
    closed();
  };
}
