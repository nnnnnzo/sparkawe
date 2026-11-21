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
            name: tile.data.name ?? "dossier",
            kind: "folder",
            segments: [],
          }
        );
      }
      function rootToken(tile: Tile) {
        const token = tile.data.token;
        if (!token) throw new Error("Aucun dossier ouvert dans cette tuile.");
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
            throw new Error(
              "Le chemin sort du dossier ouvert dans cette tuile.",
            );
          relative = wanted.slice(root.length).replace(/^\//, "");
        }
        const segments = relative.split("/").filter(Boolean);
        if (!segments.length || segments.includes(".."))
          throw new Error(`Chemin invalide : ${wanted}`);
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
        guide:
          "Arborescence d’un dossier. La surface indique la sélection (root, name, kind, selection). open-in-markdown { path } ouvre un fichier Markdown, open-in-terminal { path } ouvre un shell dans un dossier ; path est relatif à la racine ou absolu dans cette racine. Sans path, l’action utilise la sélection de l’interface.",
        view: (props) => <ExplorerView {...props} api={api} />,
        dataKeys: ["token", "name", "path"],
        actions: {
          "open-in-markdown": {
            title: "Ouvrir dans Markdown",
            description:
              "Ouvre un fichier Markdown dans un éditeur : le chemin fourni, sinon la sélection de l’interface.",
            input: {
              path: {
                type: "string",
                required: false,
                description:
                  "Chemin relatif au dossier ouvert, ou absolu dans ce dossier.",
              },
            },
            requires: [markdownOpener],
            run: async (tile, input) => {
              const entry = targetOf(tile, input);
              if (entry.kind === "folder" || !isMarkdown(entry))
                throw new Error(
                  `« ${entry.name} » n’est pas un fichier Markdown.`,
                );
              const file = await readMarkdown(rootToken(tile), entry.segments);
              const markdown = api.services.get(markdownOpener);
              if (!markdown) throw new Error("Markdown indisponible.");
              const created = markdown.open(file, tile.id);
              return { ref: created.id, name: entry.name };
            },
          },
          "open-in-terminal": {
            title: "Ouvrir un terminal",
            description:
              "Ouvre un terminal dans un dossier : le chemin fourni, sinon la sélection de l’interface.",
            input: {
              path: {
                type: "string",
                required: false,
                description:
                  "Chemin relatif au dossier ouvert, ou absolu dans ce dossier.",
              },
            },
            requires: [terminalLauncher],
            run: async (tile, input) => {
              const wanted =
                typeof input.path === "string" && input.path.trim() !== "";
              const entry = targetOf(tile, input);
              if (!wanted && entry.kind !== "folder")
                throw new Error(`« ${entry.name} » n’est pas un dossier.`);
              const directory = await resolveFolder(
                rootToken(tile),
                entry.segments,
              );
              const terminal = api.services.get(terminalLauncher);
              if (!terminal) throw new Error("Terminal indisponible.");
              const created = terminal.open(directory, tile.id);
              return { ref: created.id, name: entry.name };
            },
          },
        },
        describe: (tile, surface) => {
          if (!surface.selection)
            return tile.data.path
              ? `${tile.data.name ?? "dossier"} · ${tile.data.path}`
              : "aucun dossier";
          const path =
            surface.selection === "."
              ? (surface.root ?? tile.data.path)
              : `${surface.root ?? tile.data.path}/${surface.selection}`;
          return `${path} (${surface.kind ?? "élément"})`;
        },
      });
      api.commands.register({
        id: "explorer.open",
        title: "Ouvrir l’explorateur",
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
  const { token, name, path } = tile.data;
  const root = token && name && path ? { token, name, path } : undefined;
  const [picking, setPicking] = useState(false);

  async function chooseFolder() {
    setPicking(true);
    try {
      const folder = await pickFolder();
      if (folder) api.tabs.updateTileData(tile.id, { ...folder });
    } catch (error) {
      toast.error("Impossible d’ouvrir le sélecteur de dossier.", {
        description: String(error),
      });
    } finally {
      setPicking(false);
    }
  }

  return (
    <section className="explorer" aria-label={manifest.name}>
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
              Ouvrir un dossier
            </EmptyTitle>
            <EmptyDescription>
              Parcourez les fichiers du projet dans cet onglet.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              size="sm"
              disabled={picking}
              onClick={() => void chooseFolder()}
            >
              <FolderSearch data-icon="inline-start" />
              {picking ? "Sélection en cours…" : "Choisir un dossier"}
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
  const action = folderSelected ? "Ouvrir un terminal" : "Ouvrir dans Markdown";
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
      toast.error(`Impossible d’ouvrir « ${entry.name} ».`, {
        description: String(error),
      });
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
          aria-label={`Sélectionner le dossier racine ${root.name}`}
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
            title="Actualiser l’arborescence"
            aria-label="Actualiser l’arborescence"
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Changer de dossier"
            aria-label="Changer de dossier"
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
