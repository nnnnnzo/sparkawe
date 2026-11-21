import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Data, Tile } from "../sdk/index.ts";
import { report } from "../ui/errors.ts";
import type { Runtime } from "./runtime.ts";

const PROTOCOL = "2025-06-18";

const instructions = [
  "Lab est un espace de travail à onglets. Chaque onglet est un contexte indépendant",
  "avec ses tuiles : terminal, fichiers, documents, recherches.",
  "Commencez par lab_brief pour voir l’onglet actif. Pour du contenu précis, lisez une",
  "tuile avec lab_tile_read, puis agissez avec lab_tile_call. Ne demandez pas de contenu",
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
const text = (value: string) => ({ content: [{ type: "text", text: value }] });
const failure = (value: string) => ({
  content: [{ type: "text", text: value }],
  isError: true,
});

function tileOf(runtime: Runtime, id: unknown): Tile {
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

export function createMcpServer(runtime: Runtime) {
  const tools = () => [
    {
      name: "lab_brief",
      description:
        "Résumé compact d’un onglet Lab : tuiles ouvertes, état de chacune, derniers événements. À appeler en premier.",
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
      name: "lab_tabs",
      description: "Liste les onglets et leur disposition (side ou tiling).",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "lab_tab_focus",
      description: "Active un onglet.",
      inputSchema: {
        type: "object",
        properties: { tab: { type: "string" } },
        required: ["tab"],
      },
    },
    {
      name: "lab_tile_open",
      description: "Ouvre une tuile d’extension et renvoie sa référence.",
      inputSchema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            description:
              "Type de tuile : explorer.tree, markdown.editor, markdown.preview, terminal.session.",
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
      name: "lab_tile_read",
      description:
        "Lit l’état déclaré d’une tuile : surface, données, actions disponibles. Ne transporte pas de contenu lourd.",
      inputSchema: {
        type: "object",
        properties: { tile: { type: "string" } },
        required: ["tile"],
      },
    },
    {
      name: "lab_tile_call",
      description:
        "Exécute une action déclarée par une tuile. Les actions qui modifient des données sont refusées.",
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
      name: "lab_tile_close",
      description: "Ferme une tuile.",
      inputSchema: {
        type: "object",
        properties: { tile: { type: "string" } },
        required: ["tile"],
      },
    },
    {
      name: "lab_events_since",
      description:
        "Événements du journal postérieurs à une séquence : ce qui vient de changer.",
      inputSchema: {
        type: "object",
        properties: { seq: { type: "number" }, limit: { type: "number" } },
        required: ["seq"],
      },
    },
  ];

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
    const tile = runtime.workspace.addTile(
      type,
      definition.prepare?.(data) ?? data,
      tab.id,
    );
    return { ref: tile.id, type, title: definition.title, tab: tab.id };
  }

  function readTile(args: Record<string, unknown>) {
    const tile = tileOf(runtime, args.tile);
    const definition = runtime.registry.getTile(tile.type);
    return {
      ref: tile.id,
      type: tile.type,
      title: definition?.title ?? tile.type,
      data: tile.data,
      surface: runtime.registry.surface(tile.id) ?? {},
      actions: Object.entries(definition?.actions ?? {}).map(
        ([name, action]) => ({
          name,
          title: action.title,
          description: action.description,
          input: action.input,
          mutates: action.mutates === true,
        }),
      ),
    };
  }

  async function callTile(args: Record<string, unknown>) {
    const tile = tileOf(runtime, args.tile);
    const name = String(args.action ?? "");
    const action = runtime.registry.getAction(tile.type, name);
    if (!action)
      throw new McpError(-32602, `Action indisponible : ${tile.type}.${name}`);
    if (action.mutates)
      throw new McpError(
        -32603,
        `L’action ${name} modifie des données. Confirmez-la dans l’interface de Lab.`,
      );
    const input = object(args.args) as Record<
      string,
      string | number | boolean
    >;
    return runtime.registry.callAction(tile.id, name, input, "agent");
  }

  async function closeTile(args: Record<string, unknown>) {
    const tile = tileOf(runtime, args.tile);
    const tab = runtime.workspace.tabForTile(tile.id);
    if (!tab) throw new McpError(-32602, `Tuile inconnue : ${tile.id}`);
    await runtime.closeTiles([tile.id], () =>
      runtime.workspace.removeTile(tab.id, tile.id),
    );
    return { closed: tile.id };
  }

  async function execute(name: string, args: Record<string, unknown>) {
    switch (name) {
      case "lab_brief": {
        const brief = runtime.brief(
          typeof args.tab === "string" ? args.tab : undefined,
        );
        return {
          content: [{ type: "text", text: brief.text }],
          structuredContent: { tab: brief.tab.id, lastSeq: brief.lastSeq },
        };
      }
      case "lab_tabs":
        return text(
          JSON.stringify(
            runtime.workspace.get().tabs.map((tab) => ({
              id: tab.id,
              name: tab.name,
              mode: tab.mode,
              active: tab.id === runtime.workspace.get().active,
              tiles: tab.tiles.length,
            })),
          ),
        );
      case "lab_tab_focus": {
        const tab = runtime.workspace
          .get()
          .tabs.find((candidate) => candidate.id === args.tab);
        if (!tab) throw new McpError(-32602, `Onglet inconnu : ${args.tab}`);
        runtime.workspace.activate(tab.id);
        return text(JSON.stringify({ active: tab.id }));
      }
      case "lab_tile_open":
        return text(JSON.stringify(openTile(args)));
      case "lab_tile_read":
        return text(JSON.stringify(readTile(args)));
      case "lab_tile_call":
        return text(JSON.stringify(await callTile(args)));
      case "lab_tile_close":
        return text(JSON.stringify(await closeTile(args)));
      case "lab_events_since": {
        const seq = Number(args.seq);
        if (!Number.isFinite(seq))
          throw new McpError(-32602, "Séquence invalide.");
        const limit =
          typeof args.limit === "number" ? Math.min(args.limit, 100) : 20;
        return text(JSON.stringify(runtime.journal.since(seq, limit)));
      }
      default:
        throw new McpError(-32601, `Outil inconnu : ${name}`);
    }
  }

  async function callTool(params: Record<string, unknown>) {
    try {
      return await execute(String(params.name ?? ""), object(params.arguments));
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  }

  function resources() {
    return runtime.workspace.get().tabs.map((tab) => ({
      uri: `lab://tab/${tab.id}/brief`,
      name: `${tab.name} — brief`,
      mimeType: "text/plain",
    }));
  }

  function readResource(params: Record<string, unknown>) {
    const uri = String(params.uri ?? "");
    const match = /^lab:\/\/tab\/([^/]+)\/brief$/.exec(uri);
    if (!match) throw new McpError(-32602, `Ressource inconnue : ${uri}`);
    const brief = runtime.brief(decodeURIComponent(match[1]));
    return {
      contents: [{ uri, mimeType: "text/plain", text: brief.text }],
    };
  }

  async function dispatch(method: string, params: Record<string, unknown>) {
    switch (method) {
      case "initialize":
        return {
          protocolVersion:
            typeof params.protocolVersion === "string"
              ? params.protocolVersion
              : PROTOCOL,
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: "lab", version: "0.1.0" },
          instructions,
        };
      case "ping":
        return {};
      case "tools/list": {
        const list = tools();
        void invoke("mcp_cache_tools", {
          snapshot: JSON.stringify(list),
        }).catch(report);
        return { tools: list };
      }
      case "tools/call":
        return callTool(params);
      case "resources/list":
        return { resources: resources() };
      case "resources/read":
        return readResource(params);
      default:
        throw new McpError(-32601, `Méthode inconnue : ${method}`);
    }
  }

  return {
    async handle(line: string): Promise<string | null> {
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
        const result = await dispatch(method, message.params ?? {});
        return id === undefined ? null : answer(id ?? null, result);
      } catch (error) {
        if (id === undefined) {
          report(error);
          return null;
        }
        return problem(
          id ?? null,
          error instanceof McpError ? error.code : -32000,
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  };
}

/** Relaie les messages du socket local vers la fenêtre et renvoie les réponses. */
export async function attachMcp(runtime: Runtime) {
  const server = createMcpServer(runtime);
  return listen<{ connection: number; line: string }>(
    "mcp:message",
    async (event) => {
      const { connection, line } = event.payload;
      const reply = await server.handle(line);
      if (reply === null) return;
      try {
        await invoke("mcp_reply", { connection, line: reply });
      } catch (error) {
        report(error);
      }
    },
  );
}
