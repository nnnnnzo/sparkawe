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
import type { Data, Tile } from "../../sdk/index.ts";
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
      (value.path === undefined || typeof value.path === "string") &&
      (value.by === undefined || value.by === "agent" || value.by === "human"),
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
  function createFromText(text: string) {
    return put({
      id: crypto.randomUUID(),
      text,
      savedText: text,
      dirty: false,
      by: "agent",
    });
  }
  /** Valide l'ouverture d'un document : identifiant existant, ou texte neuf. */
  function prepareDocument(data: Data): Data {
    if (data.document !== undefined && data.text !== undefined)
      throw new Error("Choisissez data.document ou data.text, pas les deux.");
    if (data.document !== undefined) {
      if (!documents.has(data.document))
        throw new Error(
          "Document inconnu. Pour créer une note, passez data.text sans data.document.",
        );
      return { document: data.document };
    }
    return {
      document: data.text !== undefined ? createFromText(data.text) : create(),
    };
  }
  function preparePreview(data: Data): Data {
    if (data.document !== undefined && data.text !== undefined)
      throw new Error("Choisissez data.document ou data.text, pas les deux.");
    if (data.document !== undefined) {
      if (!documents.has(data.document))
        throw new Error(
          "Document inconnu. Pour créer une note, passez data.text sans data.document.",
        );
      return { document: data.document };
    }
    return {
      document:
        data.text !== undefined
          ? createFromText(data.text)
          : (activeId() ?? create()),
    };
  }
  function update(id: string, text: string, by: "agent" | "human" = "human") {
    const doc = documents.get(id);
    if (doc && doc.text !== text)
      put({ ...doc, text, dirty: text !== doc.savedText, by });
  }
  /** Un agent ne touche librement qu'à un document qu'il a créé. */
  const agentOwned = (doc: Document) =>
    !doc.path && (doc.by === "agent" || doc.text.length === 0);
  function edit(tile: Tile, change: (lines: string[]) => string[]) {
    const doc = documents.get(tile.data.document);
    if (!doc) throw new Error("Document indisponible.");
    const lines = change(doc.text.split("\n"));
    const text = lines.join("\n");
    update(doc.id, text, "agent");
    return { ref: tile.id, lines: lines.length, characters: text.length };
  }
  function range(total: number, from: number, to: number) {
    if (!Number.isInteger(from) || !Number.isInteger(to))
      throw new Error("Les lignes doivent être des entiers.");
    if (from < 1 || to < from || to > total)
      throw new Error(`Plage invalide : ${from}–${to} (${total} lignes).`);
    return [from - 1, to] as const;
  }
  function readable(tile: Tile) {
    const doc = documents.get(tile.data.document);
    if (!doc) throw new Error("Document indisponible.");
    return doc;
  }
  function guarded(tile: Tile) {
    const doc = documents.get(tile.data.document);
    return !doc || !agentOwned(doc);
  }
  function describeDocument(tile: Tile) {
    const doc = documents.get(tile.data.document);
    if (!doc) return "document inconnu";
    return `${baseName(doc.path)}${doc.text ? "" : " · vide"}${doc.dirty ? " · non enregistré" : ""}`;
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
    // Un document créé par un agent, sans fichier, lui appartient : il peut le
    // refermer sans demander à une personne d'abandonner son travail.
    if (doc?.by === "agent" && !doc.path) return true;
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
      // Référence orpheline (tuile restaurée d'un ancien bug) : on repart sur
      // un document neuf plutôt que d'afficher « Document indisponible ».
      if (!doc) api.tabs.updateTileData(tile.id, { document: create() });
    }, [api, doc, tile.id]);
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
    useEffect(() => {
      if (!doc) api.tabs.updateTileData(tile.id, { document: create() });
    }, [api, doc, tile.id]);
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
    async activate(spark) {
      api = spark;
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
        guide:
          "Document Markdown éditable. Pour créer une note, ouvrez la tuile avec data.text ; ne passez jamais un titre dans data.document. Pour modifier : read { from, to } renvoie des lignes numérotées (100 max) ; append ajoute à la fin ; insert { line, text } insère avant une ligne (total + 1 = fin) ; replace { from, to, text } et delete { from, to } agissent sur une plage inclusive. write remplace tout le texte : accepté sur un document créé par un agent, sinon confirmation dans l’interface. save est réservé à l’interface.",
        view: Editor,
        describe: describeDocument,
        prepare: prepareDocument,
        dataKeys: ["document", "text"],
        canClose,
        close,
        actions: {
          preview: {
            title: "Ouvrir l’aperçu",
            description:
              "Ouvre l’aperçu Markdown du document de cette tuile, à côté d’elle.",
            run: (tile) => {
              const doc = documents.get(tile.data.document);
              if (!doc) throw new Error("Document indisponible.");
              const created = api.tabs.openTile(
                previewType,
                { document: doc.id },
                tile.id,
              );
              return { ref: created.id, type: previewType };
            },
          },
          write: {
            title: "Écrire dans le document",
            description:
              "Remplace le contenu. Un agent réécrit librement un document qu’il a créé ; un document modifié par une personne ou lié à un fichier exige une confirmation dans l’interface.",
            input: {
              text: {
                type: "string",
                description: "Contenu Markdown complet.",
              },
            },
            mutates: guarded,
            run: (tile, input) => {
              const doc = documents.get(tile.data.document);
              if (!doc) throw new Error("Document indisponible.");
              const text = String(input.text);
              update(doc.id, text, "agent");
              return { ref: tile.id, characters: text.length };
            },
          },
          read: {
            title: "Lire le document",
            description:
              "Lit des lignes numérotées (100 lignes et 8 000 caractères au plus). Sert à préparer un patch.",
            input: {
              from: {
                type: "number",
                required: false,
                description: "Première ligne, à partir de 1.",
              },
              to: {
                type: "number",
                required: false,
                description: "Dernière ligne incluse.",
              },
            },
            run: (tile, input) => {
              const doc = readable(tile);
              const all = doc.text.split("\n");
              const from = Math.max(1, Number(input.from ?? 1));
              if (from > all.length)
                throw new Error(
                  `Ligne ${from} hors du document (${all.length} lignes).`,
                );
              const last = Math.min(
                all.length,
                Number(input.to ?? from + 99),
                from + 99,
              );
              const lines: { n: number; text: string }[] = [];
              let used = 0;
              let truncated = false;
              for (let index = from - 1; index < last; index++) {
                const text = all[index];
                if (used + text.length > 8000) {
                  truncated = true;
                  break;
                }
                used += text.length;
                lines.push({ n: index + 1, text });
              }
              const to = lines.at(-1)?.n ?? from;
              return { total: all.length, from, to, truncated, lines };
            },
          },
          append: {
            title: "Ajouter à la fin",
            description: "Ajoute des lignes à la fin du document.",
            input: {
              text: { type: "string", description: "Lignes à ajouter." },
            },
            mutates: guarded,
            run: (tile, input) =>
              edit(tile, (lines) => [
                ...lines,
                ...String(input.text).split("\n"),
              ]),
          },
          insert: {
            title: "Insérer des lignes",
            description: "Insère des lignes avant le numéro de ligne donné.",
            input: {
              line: {
                type: "number",
                description:
                  "Ligne d’insertion : 1 pour le début, total + 1 pour la fin.",
              },
              text: { type: "string", description: "Lignes à insérer." },
            },
            mutates: guarded,
            run: (tile, input) =>
              edit(tile, (lines) => {
                const line = Number(input.line);
                if (
                  !Number.isInteger(line) ||
                  line < 1 ||
                  line > lines.length + 1
                )
                  throw new Error(
                    `Ligne ${line} hors du document (1–${lines.length + 1}).`,
                  );
                lines.splice(line - 1, 0, ...String(input.text).split("\n"));
                return lines;
              }),
          },
          replace: {
            title: "Remplacer des lignes",
            description: "Remplace une plage de lignes, numéros inclus.",
            input: {
              from: { type: "number", description: "Première ligne." },
              to: { type: "number", description: "Dernière ligne incluse." },
              text: { type: "string", description: "Nouvelles lignes." },
            },
            mutates: guarded,
            run: (tile, input) =>
              edit(tile, (lines) => {
                const [start, end] = range(
                  lines.length,
                  Number(input.from),
                  Number(input.to),
                );
                lines.splice(
                  start,
                  end - start,
                  ...String(input.text).split("\n"),
                );
                return lines;
              }),
          },
          delete: {
            title: "Supprimer des lignes",
            description: "Supprime une plage de lignes, numéros inclus.",
            input: {
              from: { type: "number", description: "Première ligne." },
              to: { type: "number", description: "Dernière ligne incluse." },
            },
            mutates: guarded,
            run: (tile, input) =>
              edit(tile, (lines) => {
                const [start, end] = range(
                  lines.length,
                  Number(input.from),
                  Number(input.to),
                );
                lines.splice(start, end - start);
                return lines;
              }),
          },
          save: {
            title: "Enregistrer le document",
            description:
              "Écrit le document sur le disque. Action réservée à l’interface.",
            mutates: true,
            run: (tile) => save(tile.data.document),
          },
        },
      });
      api.tiles.register({
        type: previewType,
        title: "Aperçu Markdown",
        icon: Eye,
        guide:
          "Aperçu en lecture seule. Ouvrez la tuile avec data.document (identifiant existant) ou data.text pour un nouveau contenu. Aucune action d’écriture : pour modifier, utilisez la tuile Éditeur Markdown.",
        view: Preview,
        describe: describeDocument,
        prepare: preparePreview,
        dataKeys: ["document", "text"],
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
