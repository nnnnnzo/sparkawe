import { Eye, FolderOpen, Save } from "lucide-react";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import {
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useSyncExternalStore } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import type { Tile } from "../../sdk/index.ts";
import {
  documentSaved,
  markdownDocuments,
  markdownOpener,
  type MarkdownFile,
  type MarkdownDocument,
} from "./api.ts";
import type {
  ExtensionAPI,
  ExtensionModule,
  TileViewProps,
} from "../../sdk/react.ts";
import manifest, { editorType, previewType } from "./manifest.ts";
import "./style.css";

type Document = MarkdownDocument & { token?: string; savedText: string };

const gfm = [remarkGfm];
const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--tile)",
    color: "var(--foreground)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "ui-monospace, Menlo, Consolas, monospace",
    fontSize: "13px",
    lineHeight: "1.65",
  },
  ".cm-content": { padding: "14px 0", caretColor: "var(--foreground)" },
  ".cm-line": { padding: "0 14px 0 8px" },
  ".cm-gutters": {
    backgroundColor: "var(--tile)",
    color: "var(--muted-foreground)",
    border: "none",
    paddingLeft: "5px",
  },
});
const baseName = (path?: string) =>
  path?.split(/[/\\]/).at(-1) ?? "Sans titre.md";

function restoredDocuments(snapshot: unknown): Document[] {
  if (!Array.isArray(snapshot)) return [];
  return snapshot.filter(
    (value) =>
      value &&
      typeof value.id === "string" &&
      typeof value.text === "string" &&
      typeof value.savedText === "string" &&
      typeof value.dirty === "boolean" &&
      (value.token === undefined || typeof value.token === "string") &&
      (value.path === undefined || typeof value.path === "string"),
  );
}

export default function createMarkdown(): ExtensionModule {
  const documents = new Map<string, Document>();
  const listeners = new Set<() => void>();
  const saves = new Map<string, Promise<void>>();
  let api: ExtensionAPI;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  function persist() {
    api.state.save([...documents.values()]);
  }
  function put(doc: Document) {
    documents.set(doc.id, doc);
    for (const listener of listeners) listener();
    persist();
    return doc.id;
  }
  function create(selection?: MarkdownFile) {
    const text = selection?.text ?? "";
    return put({
      ...selection,
      id: crypto.randomUUID(),
      text,
      savedText: text,
      dirty: false,
    });
  }
  function update(id: string, text: string) {
    const doc = documents.get(id);
    if (doc && doc.text !== text)
      put({ ...doc, text, dirty: text !== doc.savedText });
  }
  function describeDocument(tile: Tile) {
    const doc = documents.get(tile.data.document);
    if (!doc) return "document inconnu";
    return `${baseName(doc.path)}${doc.dirty ? " · non enregistré" : ""}`;
  }
  const isDocumentTile = (tile: Tile) =>
    tile.type === editorType || tile.type === previewType;
  function activeId() {
    const focused = api.tabs.getFocusedTile();
    return (
      (focused && isDocumentTile(focused)
        ? focused.data.document
        : undefined) ?? api.tabs.getTiles().find(isDocumentTile)?.data.document
    );
  }
  function save(id: string, choosePath = false) {
    const existing = saves.get(id);
    if (existing) return existing;
    const saving = (async () => {
      const doc = documents.get(id);
      if (!doc) return;
      const selection =
        !doc.token || choosePath
          ? await invoke<MarkdownFile | null>("markdown_select", {
              save: true,
              name: baseName(doc.path),
            })
          : doc;
      if (!selection) return;
      const owner = [...documents.values()].find(
        (other) => other.id !== id && other.token === selection.token,
      );
      if (owner)
        throw new Error("Ce fichier est déjà ouvert dans un autre document.");
      const latest = documents.get(id);
      if (!latest) return;
      const text = latest.text;
      await invoke("markdown_write", {
        token: selection.token,
        text,
        expected: selection.token === doc.token ? doc.savedText : null,
      });
      const current = documents.get(id);
      if (!current) return;
      const saved = {
        ...current,
        token: selection.token,
        path: selection.path,
        directory: selection.directory,
        savedText: text,
        dirty: current.text !== text,
      };
      put(saved);
      api.events.emit(documentSaved, saved);
    })().finally(() => {
      saves.delete(id);
    });
    saves.set(id, saving);
    return saving;
  }
  async function open() {
    const selection = await invoke<MarkdownFile | null>("markdown_select", {
      save: false,
    });
    if (selection) return openFile(selection);
  }
  function openFile(selection: MarkdownFile, alongside?: string) {
    if (
      alongside &&
      !api.tabs.getAllTiles().some((tile) => tile.id === alongside)
    ) {
      throw new Error("La tuile d’origine a été fermée.");
    }
    const doc = [...documents.values()].find(
      (doc) => doc.token === selection.token,
    );
    let id = doc?.id;
    if (doc && !doc.dirty && !saves.has(doc.id)) {
      put({ ...doc, ...selection, savedText: selection.text });
    }
    id ??= create(selection);
    return api.tabs.openTile(editorType, { document: id }, alongside);
  }
  function preview() {
    return api.tabs.openTile(previewType, {
      document: activeId() ?? create(),
    });
  }
  async function canClose(tile: Tile, closing: ReadonlySet<string>) {
    const id = tile.data.document;
    await saves.get(id);
    const doc = documents.get(id);
    const views = api.tabs
      .getAllTiles()
      .filter((other) => isDocumentTile(other) && other.data.document === id);
    if (
      !doc?.dirty ||
      views[0]?.id !== tile.id ||
      views.some((other) => !closing.has(other.id))
    )
      return true;
    return invoke<boolean>("markdown_confirm_close", {
      name: baseName(doc.path),
    });
  }
  function close(tile: Tile) {
    const id = tile.data.document;
    if (
      api.tabs
        .getAllTiles()
        .some((other) => isDocumentTile(other) && other.data.document === id)
    )
      return;
    if (documents.delete(id)) persist();
  }
  function useDocument(id: string) {
    return useSyncExternalStore(subscribe, () => documents.get(id));
  }
  function DocumentBar({ doc, editor }: { doc: Document; editor?: boolean }) {
    function saveFromButton() {
      void save(doc.id).catch((error) => toast.error(String(error)));
    }
    return (
      <div className="markdown-document-bar">
        <span className="truncate" title={doc.path}>
          {baseName(doc.path)}
        </span>
        {doc.dirty && (
          <span
            className="markdown-unsaved"
            aria-label="Modifications non enregistrées"
          />
        )}
        {editor && (
          <button className="markdown-document-action" onClick={saveFromButton}>
            Enregistrer
          </button>
        )}
      </div>
    );
  }
  function Editor({ tile }: TileViewProps) {
    const id = tile.data.document;
    const doc = useDocument(id);
    const host = useRef<HTMLDivElement>(null);
    const editor = useRef<EditorView | null>(null);
    useEffect(() => {
      const view = new EditorView({
        parent: host.current!,
        state: EditorState.create({
          doc: documents.get(id)?.text ?? "",
          extensions: [
            lineNumbers(),
            history(),
            markdownLanguage(),
            editorTheme,
            EditorView.lineWrapping,
            syntaxHighlighting(defaultHighlightStyle),
            keymap.of([
              {
                key: "Mod-s",
                run: () => {
                  void save(id).catch((error) => toast.error(String(error)));
                  return true;
                },
              },
              indentWithTab,
              ...defaultKeymap,
              ...historyKeymap,
            ]),
            EditorView.updateListener.of((change) => {
              if (
                change.docChanged &&
                change.transactions.some(
                  (transaction) => !transaction.annotation(Transaction.remote),
                )
              ) {
                update(id, change.state.doc.toString());
              }
            }),
          ],
        }),
      });
      editor.current = view;
      return () => {
        view.destroy();
        editor.current = null;
      };
    }, [id]);
    useEffect(() => {
      const view = editor.current;
      const text = documents.get(id)?.text;
      if (view && text !== undefined && view.state.doc.toString() !== text) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
          annotations: [
            Transaction.addToHistory.of(false),
            Transaction.remote.of(true),
          ],
        });
      }
    }, [doc, id]);
    return (
      <div className="markdown-editor">
        {doc && <DocumentBar doc={doc} editor />}
        {!doc && <p className="tile-message">Document indisponible</p>}
        <div className="markdown-editor-host" ref={host} hidden={!doc} />
      </div>
    );
  }
  function Preview({ tile }: TileViewProps) {
    const doc = useDocument(tile.data.document);
    return (
      <div className="markdown-editor">
        {doc && <DocumentBar doc={doc} />}
        <article className="markdown-preview">
          {doc ? (
            <ReactMarkdown
              remarkPlugins={gfm}
              skipHtml
              components={{
                a: ({ children, href }) => (
                  <a
                    href={href?.startsWith("#") ? href : undefined}
                    title={href}
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {doc.text}
            </ReactMarkdown>
          ) : (
            <p>Document indisponible</p>
          )}
        </article>
      </div>
    );
  }
  return {
    async activate(lab) {
      api = lab;
      for (const doc of restoredDocuments(api.state.read())) {
        documents.set(doc.id, doc);
      }
      await Promise.all(
        [...documents.values()].map(async (doc) => {
          if (!doc.token || doc.dirty) return;
          try {
            const text = await invoke<string>("markdown_read", {
              token: doc.token,
            });
            documents.set(doc.id, { ...doc, text, savedText: text });
          } catch (error) {
            toast.error(String(error));
          }
        }),
      );
      api.tiles.register({
        type: editorType,
        title: "Éditeur Markdown",
        icon: manifest.icon,
        view: Editor,
        describe: describeDocument,
        prepare: (data) => ({ document: data.document ?? create() }),
        canClose,
        close,
      });
      api.tiles.register({
        type: previewType,
        title: "Aperçu Markdown",
        icon: Eye,
        view: Preview,
        describe: describeDocument,
        prepare: (data) => ({
          document: data.document ?? activeId() ?? create(),
        }),
        canClose,
        close,
      });
      api.commands.register({
        id: "markdown.new",
        title: "Nouvel éditeur Markdown",
        icon: manifest.icon,
        tileType: editorType,
        run: () => api.tabs.openTile(editorType),
      });
      api.commands.register({
        id: "markdown.preview",
        title: "Aperçu Markdown",
        icon: Eye,
        tileType: previewType,
        run: preview,
      });
      api.commands.register({
        id: "markdown.open",
        title: "Ouvrir un fichier Markdown",
        icon: FolderOpen,
        run: open,
      });
      api.commands.register({
        id: "markdown.save",
        title: "Enregistrer le document",
        icon: Save,
        run: () => {
          const id = activeId();
          if (id) return save(id);
        },
      });
      api.commands.register({
        id: "markdown.save-as",
        title: "Enregistrer le document sous…",
        icon: Save,
        run: () => {
          const id = activeId();
          if (id) return save(id, true);
        },
      });
      api.services.provide(markdownOpener, { open: openFile });
      api.services.provide(markdownDocuments, {
        list: () => [...documents.values()],
        get: (id) => documents.get(id),
        getActive: () => documents.get(activeId() ?? ""),
        update,
        save,
      });
    },
    async deactivate() {
      await Promise.allSettled(saves.values());
    },
  };
}
