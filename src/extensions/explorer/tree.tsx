import {
  ChevronRight,
  File,
  FileText,
  FolderClosed,
  FolderOpen,
  Link2,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Button } from "@spark/ui/components/button";
import { useI18n } from "../../i18n/react.ts";
import { isMarkdown, listFolder, type Entry, type Selection } from "./files.ts";

const rootSegments: string[] = [];

interface TreeProps {
  token: string;
  revision: number;
  selected: Selection;
  select: (entry: Selection) => void;
  openMarkdown: (entry: Selection) => void;
}

export function FileTree(props: TreeProps) {
  const { t } = useI18n();
  return (
    <div
      className="explorer-tree"
      role="region"
      aria-label={t("explorer.tree.label")}
    >
      <FolderContents {...props} segments={rootSegments} />
    </div>
  );
}

function FolderContents({
  segments,
  ...props
}: TreeProps & { segments: string[] }) {
  const { t } = useI18n();
  const { token, revision } = props;
  const [entries, setEntries] = useState<Entry[]>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    void listFolder(token, segments).then(
      (result) => {
        if (!current) return;
        setEntries(result);
        setError(undefined);
      },
      (failure: unknown) => {
        if (!current) return;
        setEntries(undefined);
        setError(String(failure));
      },
    );
    return () => {
      current = false;
    };
  }, [token, revision, segments, retry]);

  const indent = {
    "--explorer-depth": Math.min(segments.length, 6),
  } as CSSProperties;
  if (error)
    return (
      <div className="explorer-tree-message" style={indent}>
        <p role="status">{error}</p>
        <Button
          variant="outline"
          size="xs"
          onClick={() => setRetry((value) => value + 1)}
        >
          {t("explorer.retry")}
        </Button>
      </div>
    );
  if (!entries?.length)
    return (
      <p className="explorer-tree-message" style={indent} role="status">
        {entries ? t("explorer.emptyFolder") : t("explorer.loading")}
      </p>
    );
  return (
    <ul className="explorer-list" aria-label={segments.at(-1)}>
      {entries.map((entry) => (
        <FileRow
          key={entry.name}
          {...props}
          entry={entry}
          parent={segments}
          indent={indent}
        />
      ))}
    </ul>
  );
}

function FileRow({
  entry,
  parent,
  indent,
  ...props
}: TreeProps & { entry: Entry; parent: string[]; indent: CSSProperties }) {
  const [expanded, setExpanded] = useState(false);
  const segments = useMemo(() => [...parent, entry.name], [parent, entry.name]);
  const folder = entry.kind === "folder";
  const markdown = isMarkdown(entry);
  const selected =
    segments.length === props.selected.segments.length &&
    segments.every(
      (segment, index) => segment === props.selected.segments[index],
    );
  const icon = folder
    ? expanded
      ? FolderOpen
      : FolderClosed
    : entry.kind === "link"
      ? Link2
      : markdown
        ? FileText
        : File;
  const Glyph = icon;
  const target = { ...entry, segments };
  return (
    <li>
      <button
        type="button"
        className="explorer-row"
        style={indent}
        data-selected={selected || undefined}
        data-folder={folder || undefined}
        title={entry.name}
        aria-expanded={folder ? expanded : undefined}
        aria-current={selected ? "true" : undefined}
        onClick={() => {
          props.select(target);
          if (folder) setExpanded((value) => !value);
        }}
        onDoubleClick={markdown ? () => props.openMarkdown(target) : undefined}
      >
        <ChevronRight aria-hidden className="explorer-disclosure" />
        <Glyph aria-hidden className="explorer-file-icon" />
        <span className="truncate">{entry.name}</span>
      </button>
      {folder && expanded && <FolderContents {...props} segments={segments} />}
    </li>
  );
}
