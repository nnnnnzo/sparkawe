import {
  FileText,
  FolderOpen,
  FolderSearch,
  RefreshCw,
  Terminal,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@spark/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@spark/ui/components/empty";
import type {
  ExtensionAPI,
  ExtensionModule,
  TileViewProps,
} from "../../sdk/react.ts";
import type { Tile } from "../../sdk/index.ts";
import { localized } from "../../core/i18n.ts";
import { t as translateNow } from "../../i18n/index.ts";
import { useI18n } from "../../i18n/react.ts";
import { markdownOpener } from "../markdown/api.ts";
import { terminalLauncher } from "../terminal/api.ts";
import {
  isMarkdown,
  pickFolder,
  readMarkdown,
  resolveFolder,
  type ProjectFolder,
  type Selection,
} from "./files.ts";
import manifest, { explorerType } from "./manifest.ts";
import { FileTree } from "./tree.tsx";
import "./style.css";

/** Sélection courante de chaque arborescence, pour les actions déclarées. */
const selections = new Map<string, Selection>();

export default function createExplorer(): ExtensionModule {
  return {
    activate(api) {
      function selectionOf(tile: Tile): Selection {
        return (
          selections.get(tile.id) ?? {
            name: tile.data.name ?? translateNow("explorer.default.folder"),
            kind: "folder",
            segments: [],
          }
        );
      }
      function rootToken(tile: Tile) {
        const token = tile.data.token;
        if (!token) throw new Error(translateNow("explorer.error.noFolder"));
        return token;
      }
      /**
       * Cible d'une action : la sélection de l'interface, ou un chemin fourni
       * par l'agent. Un chemin absolu doit rester à l'intérieur du dossier.
       */
      function targetOf(tile: Tile, input: Record<string, unknown>): Selection {
        const wanted = typeof input.path === "string" ? input.path.trim() : "";
        if (!wanted) return selectionOf(tile);
        const root = tile.data.path ?? "";
        let relative = wanted;
        if (wanted.startsWith("/")) {
          if (!root || (wanted !== root && !wanted.startsWith(`${root}/`)))
            throw new Error(translateNow("explorer.error.outsideFolder"));
          relative = wanted.slice(root.length).replace(/^\//, "");
        }
        const segments = relative.split("/").filter(Boolean);
        if (!segments.length || segments.includes(".."))
          throw new Error(
            translateNow("explorer.error.invalidPath", { path: wanted }),
          );
        return {
          name: segments.at(-1) ?? "",
          kind: "file",
          segments,
        };
      }

      api.tiles.register({
        type: explorerType,
        title: manifest.name,
        icon: manifest.icon,
        guide: localized("explorer.guide"),
        view: (props) => <ExplorerView {...props} api={api} />,
        dataKeys: ["token", "name", "path"],
        actions: {
          "open-in-markdown": {
            title: localized("explorer.action.openInMarkdown"),
            description: localized(
              "explorer.action.openInMarkdown.description",
            ),
            input: {
              path: {
                type: "string",
                required: false,
                description: translateNow("explorer.input.path"),
              },
            },
            requires: [markdownOpener],
            run: async (tile, input) => {
              const entry = targetOf(tile, input);
              if (entry.kind === "folder" || !isMarkdown(entry))
                throw new Error(
                  translateNow("explorer.error.notMarkdown", {
                    name: entry.name,
                  }),
                );
              const file = await readMarkdown(rootToken(tile), entry.segments);
              const markdown = api.services.get(markdownOpener);
              if (!markdown)
                throw new Error(
                  translateNow("explorer.error.markdownUnavailable"),
                );
              const created = markdown.open(file, tile.id);
              return { ref: created.id, name: entry.name };
            },
          },
          "open-in-terminal": {
            title: localized("explorer.action.openInTerminal"),
            description: localized(
              "explorer.action.openInTerminal.description",
            ),
            input: {
              path: {
                type: "string",
                required: false,
                description: translateNow("explorer.input.path"),
              },
            },
            requires: [terminalLauncher],
            run: async (tile, input) => {
              const wanted =
                typeof input.path === "string" && input.path.trim() !== "";
              const entry = targetOf(tile, input);
              if (!wanted && entry.kind !== "folder")
                throw new Error(
                  translateNow("explorer.error.notFolder", {
                    name: entry.name,
                  }),
                );
              const directory = await resolveFolder(
                rootToken(tile),
                entry.segments,
              );
              const terminal = api.services.get(terminalLauncher);
              if (!terminal)
                throw new Error(
                  translateNow("explorer.error.terminalUnavailable"),
                );
              const created = terminal.open(directory, tile.id);
              return { ref: created.id, name: entry.name };
            },
          },
        },
        describe: (tile, surface) => {
          if (!surface.selection)
            return tile.data.path
              ? `${tile.data.name ?? translateNow("explorer.default.folder")} · ${tile.data.path}`
              : translateNow("explorer.describe.none");
          const path =
            surface.selection === "."
              ? (surface.root ?? tile.data.path)
              : `${surface.root ?? tile.data.path}/${surface.selection}`;
          return `${path} (${surface.kind ?? translateNow("explorer.default.element")})`;
        },
      });
      api.commands.register({
        id: "explorer.open",
        title: localized("explorer.command.open"),
        icon: manifest.icon,
        tileType: explorerType,
        keywords: ["dossier", "fichiers", "projet"],
        run: () => {
          const existing = api.tabs
            .getTiles()
            .find((tile) => tile.type === explorerType);
          if (existing) api.tabs.focusTile(existing.id);
          else api.tabs.openTile(explorerType);
        },
      });
    },
  };
}

function ExplorerView({ api, tile }: TileViewProps & { api: ExtensionAPI }) {
  const { t, text } = useI18n();
  const { token, name, path } = tile.data;
  const root = token && name && path ? { token, name, path } : undefined;
  const [picking, setPicking] = useState(false);

  async function chooseFolder() {
    setPicking(true);
    try {
      const folder = await pickFolder();
      if (folder) api.tabs.updateTileData(tile.id, { ...folder });
    } catch (error) {
      toast.error(t("explorer.error.picker"), {
        description: String(error),
      });
    } finally {
      setPicking(false);
    }
  }

  return (
    <section className="explorer" aria-label={text(manifest.name)}>
      {root ? (
        <ProjectTree
          key={root.token}
          root={root}
          api={api}
          tileId={tile.id}
          picking={picking}
          chooseFolder={() => void chooseFolder()}
        />
      ) : (
        <Empty className="explorer-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen aria-hidden />
            </EmptyMedia>
            <EmptyTitle role="heading" aria-level={2}>
              {t("explorer.empty.title")}
            </EmptyTitle>
            <EmptyDescription>
              {t("explorer.empty.description")}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              size="sm"
              disabled={picking}
              onClick={() => void chooseFolder()}
            >
              <FolderSearch data-icon="inline-start" />
              {picking ? t("explorer.picking") : t("explorer.chooseFolder")}
            </Button>
          </EmptyContent>
        </Empty>
      )}
    </section>
  );
}

function ProjectTree({
  root,
  api,
  tileId,
  picking,
  chooseFolder,
}: {
  root: ProjectFolder;
  api: ExtensionAPI;
  tileId: string;
  picking: boolean;
  chooseFolder: () => void;
}) {
  const { t } = useI18n();
  const rootSelection: Selection = {
    name: root.name,
    kind: "folder",
    segments: [],
  };
  const [selected, select] = useState<Selection>(rootSelection);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    selections.set(tileId, selected);
    api.tiles.publish(tileId, {
      root: root.path,
      name: selected.name,
      kind: selected.kind,
      selection: selected.segments.length ? selected.segments.join("/") : ".",
    });
    return () => {
      selections.delete(tileId);
    };
  }, [api, root.path, selected, tileId]);
  const markdown = api.services.get(markdownOpener);
  const terminal = api.services.get(terminalLauncher);
  const folderSelected = selected.kind === "folder";
  const action = folderSelected
    ? t("explorer.action.openInTerminal")
    : t("explorer.action.openInMarkdown");
  const ActionIcon = folderSelected ? Terminal : FileText;
  const available = folderSelected ? !!terminal : !!markdown;
  const canOpen = folderSelected || isMarkdown(selected);

  async function open(entry: Selection) {
    if (pending || picking) return;
    const folder = entry.kind === "folder";
    if (folder ? !terminal : !markdown) return;
    setPending(true);
    try {
      if (folder) {
        const directory = await resolveFolder(root.token, entry.segments);
        api.services.get(terminalLauncher)?.open(directory, tileId);
      } else {
        const file = await readMarkdown(root.token, entry.segments);
        api.services.get(markdownOpener)?.open(file, tileId);
      }
    } catch (error) {
      toast.error(
        translateNow("explorer.error.openEntry", { name: entry.name }),
        {
          description: String(error),
        },
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="explorer-toolbar">
        <button
          type="button"
          className="explorer-project"
          title={root.path}
          aria-label={t("explorer.selectRoot", { name: root.name })}
          aria-pressed={!selected.segments.length}
          onClick={() => select(rootSelection)}
        >
          <span className="explorer-project-icon">
            <FolderOpen aria-hidden />
          </span>
          <span className="explorer-project-text">
            <strong className="truncate">{root.name}</strong>
            <span className="truncate">{root.path}</span>
          </span>
        </button>
        <div className="explorer-tools">
          <Button
            variant="ghost"
            size="icon-sm"
            title={t("explorer.refresh")}
            aria-label={t("explorer.refresh")}
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title={t("explorer.changeFolder")}
            aria-label={t("explorer.changeFolder")}
            onClick={chooseFolder}
            disabled={picking || pending}
          >
            <FolderSearch />
          </Button>
        </div>
      </div>
      <FileTree
        token={root.token}
        revision={revision}
        selected={selected}
        select={select}
        openMarkdown={(entry) => void open(entry)}
      />
      <div className="explorer-footer">
        <span
          className="truncate"
          title={selected.segments.join("/") || root.path}
        >
          {selected.name}
        </span>
        {canOpen && available && (
          <Button
            variant="secondary"
            size="xs"
            aria-label={action}
            title={action}
            onClick={() => void open(selected)}
            disabled={pending || picking}
          >
            <ActionIcon data-icon="inline-start" />
            <span className="explorer-action-label">{action}</span>
          </Button>
        )}
      </div>
    </>
  );
}
