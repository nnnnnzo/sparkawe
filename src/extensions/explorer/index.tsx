import {
  FileText,
  FolderOpen,
  FolderSearch,
  RefreshCw,
  Terminal,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@lab/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@lab/ui/components/empty";
import type {
  ExtensionAPI,
  ExtensionModule,
  TileViewProps,
} from "../../sdk/react.ts";
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

export default function createExplorer(): ExtensionModule {
  return {
    activate(api) {
      api.tiles.register({
        type: explorerType,
        title: manifest.name,
        icon: manifest.icon,
        view: (props) => <ExplorerView {...props} api={api} />,
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
    api.tiles.publish(tileId, {
      root: root.path,
      name: selected.name,
      kind: selected.kind,
      selection: selected.segments.length ? selected.segments.join("/") : ".",
    });
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
        {canOpen && !available && (
          <span
            className="truncate"
            title={
              folderSelected ? "Terminal indisponible" : "Markdown indisponible"
            }
          >
            {folderSelected ? "Terminal indisponible" : "Markdown indisponible"}
          </span>
        )}
      </div>
    </>
  );
}
