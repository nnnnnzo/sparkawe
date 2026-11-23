import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  ExternalLink,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  FolderOpen,
  Globe,
  Link2,
  WrapText,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { toast } from "sonner";
import type {
  ExtensionAPI,
  ExtensionModule,
  TileViewProps,
} from "../../sdk/react.ts";
import type { IconComponent } from "../../sdk/index.ts";
import { localized } from "../../core/i18n.ts";
import { t as translateNow } from "../../i18n/index.ts";
import { useI18n } from "../../i18n/react.ts";
import {
  previewDrop,
  previewFetch,
  previewFromExplorer,
  previewOpener,
  previewPdf,
  previewSelect,
  previewSource,
  type PreviewFile,
  type PreviewInput,
} from "./api.ts";
import {
  fileNameOf,
  isPreviewable,
  kindOf,
  previewFamilies,
  type PreviewKind,
} from "./kind.ts";
import manifest, { previewType } from "./manifest.ts";
import { webBrowser } from "../web/api.ts";
import "./style.css";

/**
 * Le moteur PDF pèse plus lourd que le reste de la tuile : il n’est chargé
 * qu’au premier PDF, pas lors de l’activation de l’extension au lancement.
 */
let pdfjs: Promise<typeof import("pdfjs-dist")> | undefined;
function loadPdfjs() {
  pdfjs ??= import("pdfjs-dist").then((module) => {
    module.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    return module;
  });
  return pdfjs;
}

const familyIcons: Record<PreviewKind, IconComponent> = {
  pdf: FileText,
  image: FileImage,
  audio: FileAudio,
  video: FileVideo,
  text: FileCode,
  html: Globe,
};

function urlId(url: string) {
  let hash = 0;
  for (let index = 0; index < url.length; index++)
    hash = (hash * 31 + url.charCodeAt(index)) | 0;
  return `url-${Math.abs(hash).toString(36)}`;
}

function messageOf(failure: unknown) {
  return failure instanceof Error ? failure.message : String(failure);
}

function durationLabel(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function PdfPage({
  doc,
  number,
  scale,
}: {
  doc: PDFDocumentProxy;
  number: number;
  scale: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const element = host.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void doc
      .getPage(number)
      .then((page) => {
        if (cancelled || !canvas.current) return;
        const viewport = page.getViewport({ scale });
        const ratio = window.devicePixelRatio || 1;
        const element = canvas.current;
        element.width = Math.floor(viewport.width * ratio);
        element.height = Math.floor(viewport.height * ratio);
        element.style.width = `${Math.floor(viewport.width)}px`;
        element.style.height = `${Math.floor(viewport.height)}px`;
        const context = element.getContext("2d");
        if (!context) return;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        void page.render({ canvas: element, canvasContext: context, viewport })
          .promise;
      })
      .catch(() => {
        // Une page illisible ne doit pas vider la tuile.
      });
    return () => {
      cancelled = true;
    };
  }, [doc, number, scale, visible]);

  return (
    <div ref={host} className="preview-pdf-page">
      <canvas ref={canvas} />
    </div>
  );
}

function PdfViewer({
  url,
  scale,
  onPages,
}: {
  url: string;
  scale: number;
  onPages: (pages: number) => void;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let alive = true;
    let task: PDFDocumentLoadingTask | undefined;
    setDoc(undefined);
    setError(undefined);
    void (async () => {
      try {
        const response = await fetch(url);
        const data = await response.arrayBuffer();
        if (!alive) return;
        const pdfjs = await loadPdfjs();
        if (!alive) return;
        task = pdfjs.getDocument({ data });
        const loaded = await task.promise;
        if (!alive) {
          void task.destroy();
          return;
        }
        setDoc(loaded);
        onPages(loaded.numPages);
      } catch (failure) {
        if (alive) setError(messageOf(failure));
      }
    })();
    return () => {
      alive = false;
      void task?.destroy();
    };
  }, [url, onPages]);

  if (error)
    return (
      <div className="preview-error">
        <p>{error}</p>
      </div>
    );
  if (!doc)
    return <p className="preview-note">{translateNow("preview.loading")}</p>;
  return (
    <div className="preview-pdf-scroll">
      {Array.from({ length: doc.numPages }, (_, index) => (
        <PdfPage key={index} doc={doc} number={index + 1} scale={scale} />
      ))}
    </div>
  );
}

function ImageViewer({
  url,
  fit,
  onDimensions,
}: {
  url: string;
  fit: boolean;
  onDimensions: (size: string) => void;
}) {
  return (
    <div className="preview-image">
      <img
        src={url}
        alt=""
        className={fit ? "is-fit" : undefined}
        onLoad={(event) =>
          onDimensions(
            `${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`,
          )
        }
      />
    </div>
  );
}

function MediaViewer({
  kind,
  url,
  onDuration,
}: {
  kind: "audio" | "video";
  url: string;
  onDuration: (duration: string) => void;
}) {
  const onLoadedMetadata = (event: { currentTarget: HTMLMediaElement }) =>
    onDuration(durationLabel(event.currentTarget.duration));
  return (
    <div className={`preview-media preview-media-${kind}`}>
      {kind === "video" ? (
        <video controls src={url} onLoadedMetadata={onLoadedMetadata} />
      ) : (
        <audio controls src={url} onLoadedMetadata={onLoadedMetadata} />
      )}
    </div>
  );
}

function TextViewer({ text, wrap }: { text: string; wrap: boolean }) {
  return (
    <pre className={wrap ? "preview-text is-wrap" : "preview-text"}>{text}</pre>
  );
}

function EmptyState({
  picking,
  error,
  draft,
  setDraft,
  pick,
  openLink,
}: {
  picking: boolean;
  error?: string;
  draft: string;
  setDraft: (value: string) => void;
  pick: (filter: PreviewKind | "all") => Promise<void>;
  openLink: (event: FormEvent) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="preview-empty">
      <div className="preview-empty-inner">
        <h2 className="preview-empty-title">{t("manifest.preview.name")}</h2>
        <div className="preview-families">
          {previewFamilies.map((kind) => {
            const Icon = familyIcons[kind];
            return (
              <button
                key={kind}
                type="button"
                className="preview-family"
                disabled={picking}
                onClick={() => void pick(kind)}
              >
                <span className="preview-family-icon">
                  <Icon aria-hidden />
                </span>
                <span className="preview-family-text">
                  <strong>{t(`preview.format.${kind}`)}</strong>
                  <span>{t(`preview.format.${kind}.hint`)}</span>
                </span>
              </button>
            );
          })}
        </div>
        <form className="preview-url" onSubmit={openLink}>
          <Link2 aria-hidden />
          <input
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t("preview.empty.placeholder")}
            aria-label={t("preview.empty.url")}
          />
          <button type="submit" disabled={!draft.trim()}>
            {t("preview.empty.submit")}
          </button>
        </form>
        <div className="preview-empty-foot">
          <button
            type="button"
            className="preview-choose"
            disabled={picking}
            onClick={() => void pick("all")}
          >
            <FolderOpen aria-hidden />
            {t("preview.empty.choose")}
          </button>
          <span className="preview-drop-hint">{t("preview.empty.drop")}</span>
        </div>
        {error && <p className="preview-error-text">{error}</p>}
      </div>
    </div>
  );
}

function PreviewView({ api, tile }: TileViewProps & { api: ExtensionAPI }) {
  const { t } = useI18n();
  const root = useRef<HTMLElement>(null);
  const [source, setSource] = useState<PreviewFile>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [draft, setDraft] = useState("");
  const [meta, setMeta] = useState("");
  const [scale, setScale] = useState(1.1);
  const [fit, setFit] = useState(true);
  const [wrap, setWrap] = useState(true);
  const [pages, setPages] = useState<number>();
  const loadRef = useRef<(file: PreviewFile) => void>(() => {});
  const hasSource = Boolean(tile.data.token || tile.data.url);

  function loadFile(file: PreviewFile) {
    setError(undefined);
    setSource(file);
    setMeta("");
    api.tabs.updateTileData(tile.id, {
      kind: file.kind,
      title: file.name,
      token: file.token,
    });
  }
  loadRef.current = loadFile;

  useEffect(() => {
    const token = tile.data.token;
    const url = tile.data.url;
    const id = tile.data.id;
    const kind = tile.data.kind as PreviewKind | undefined;
    const title = tile.data.title;
    if (!token && !url) {
      setSource(undefined);
      setError(undefined);
      setLoading(false);
      setMeta("");
      return;
    }
    let alive = true;
    setLoading(true);
    setError(undefined);
    setSource(undefined);
    setMeta("");
    setPages(undefined);
    setScale(1.1);
    void (async () => {
      try {
        let next: PreviewFile;
        if (token) {
          next = await previewSource(token);
          if (next.kind !== kind) {
            api.tabs.updateTileData(tile.id, {
              ...tile.data,
              kind: next.kind,
              title: title || next.name,
            });
          }
        } else if (
          (kind === "audio" || kind === "video") &&
          /^https:\/\//i.test(url)
        ) {
          next = {
            token: "",
            name: title || fileNameOf(url),
            path: "",
            kind,
            bytes: 0,
            source: url,
            truncated: false,
          };
        } else {
          if (!/^https:\/\//i.test(url))
            throw new Error(translateNow("preview.error.url"));
          next = await previewFetch([url], id || urlId(url), kind);
          if (next.kind !== kind) {
            api.tabs.updateTileData(tile.id, {
              ...tile.data,
              kind: next.kind,
              title: title || fileNameOf(url) || next.name,
            });
          }
        }
        if (!alive) return;
        setSource(next);
        setLoading(false);
      } catch (failure) {
        if (!alive) return;
        setError(messageOf(failure));
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [api, tile.id, tile.data.token, tile.data.url, tile.data.id]);

  async function pick(filter: PreviewKind | "all") {
    if (picking) return;
    setPicking(true);
    setError(undefined);
    try {
      const file = await previewSelect(filter);
      if (file) loadFile(file);
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setPicking(false);
    }
  }

  function openLink(event: FormEvent) {
    event.preventDefault();
    const value = draft.trim();
    if (!/^https:\/\//i.test(value)) {
      setError(t("preview.error.url"));
      return;
    }
    const kind = kindOf(value);
    setError(undefined);
    api.tabs.updateTileData(tile.id, {
      kind: kind ?? "",
      title: fileNameOf(value),
      url: value,
      id: urlId(value),
    });
  }

  function changeSource() {
    setSource(undefined);
    setError(undefined);
    setMeta("");
    setPages(undefined);
    api.tabs.updateTileData(tile.id, {});
  }

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const element = root.current;
        if (!element) return;
        const payload = event.payload;
        if (payload.type === "leave") {
          setDragOver(false);
          return;
        }
        const rect = element.getBoundingClientRect();
        // wry fournit des points (CSS px) sur macOS et Linux, mais des pixels
        // physiques sur Windows. Normaliser évite de viser à côté.
        const ratio = /Windows/i.test(navigator.userAgent)
          ? window.devicePixelRatio || 1
          : 1;
        const x = payload.position.x / ratio;
        const y = payload.position.y / ratio;
        const inside =
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom;
        if (payload.type === "enter" || payload.type === "over") {
          setDragOver(inside);
          return;
        }
        setDragOver(false);
        if (!inside || payload.type !== "drop") return;
        const { paths } = payload;
        void (async () => {
          try {
            const files = await previewDrop(paths);
            if (disposed) return;
            loadRef.current(files[0]);
            if (paths.length > files.length)
              toast.info(
                translateNow("preview.drop.ignored", {
                  count: paths.length - files.length,
                }),
              );
          } catch (failure) {
            if (!disposed) setError(messageOf(failure));
          }
        })();
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [api, tile.id]);

  useEffect(() => {
    if (pages) setMeta(t("preview.pages", { count: pages }));
  }, [pages, t]);

  const title =
    tile.data.title ||
    source?.name ||
    (tile.data.url ? fileNameOf(tile.data.url) : "");
  const kind = (source?.kind ?? tile.data.kind) as PreviewKind | undefined;
  const assetUrl = source?.path ? convertFileSrc(source.path) : undefined;
  const mediaUrl =
    source?.kind === "audio" || source?.kind === "video"
      ? assetUrl || source.source
      : undefined;
  const browser = api.services.get(webBrowser);
  const remoteHtml =
    source?.kind === "html" &&
    /^https:\/\//i.test(source.source || tile.data.url);

  useEffect(() => {
    api.tiles.publish(tile.id, {
      kind: kind ?? "",
      title: (title ?? "").slice(0, 200),
      meta: meta.slice(0, 80),
      pages: pages ? String(pages) : "",
    });
  }, [api, tile.id, kind, title, meta, pages]);

  const overlay = dragOver ? (
    <div className="preview-drop-zone">
      <FolderOpen aria-hidden />
      <span>{t("preview.empty.dropActive")}</span>
    </div>
  ) : null;

  if (!hasSource) {
    return (
      <section
        ref={root}
        className="preview"
        aria-label={t("preview.section.label")}
      >
        <EmptyState
          picking={picking}
          error={error}
          draft={draft}
          setDraft={setDraft}
          pick={pick}
          openLink={openLink}
        />
        {overlay}
      </section>
    );
  }

  return (
    <section
      ref={root}
      className="preview"
      aria-label={t("preview.section.label")}
    >
      <div className="preview-toolbar">
        {kind &&
          (() => {
            const Icon = familyIcons[kind];
            return <Icon className="preview-kind" aria-hidden />;
          })()}
        <span className="preview-title" title={title}>
          {title}
        </span>
        {kind && (
          <span className="preview-meta">{t(`preview.format.${kind}`)}</span>
        )}
        <div className="preview-actions">
          {kind === "pdf" && (
            <>
              <button
                type="button"
                aria-label={t("preview.zoom.out")}
                onClick={() => setScale((value) => Math.max(0.5, value - 0.15))}
              >
                −
              </button>
              <span className="preview-meta">{Math.round(scale * 100)} %</span>
              <button
                type="button"
                aria-label={t("preview.zoom.in")}
                onClick={() => setScale((value) => Math.min(3, value + 0.15))}
              >
                +
              </button>
            </>
          )}
          {kind === "image" && (
            <button type="button" onClick={() => setFit((value) => !value)}>
              {fit ? t("preview.actual") : t("preview.fit")}
            </button>
          )}
          {kind === "text" && (
            <button
              type="button"
              aria-pressed={wrap}
              onClick={() => setWrap((value) => !value)}
            >
              <WrapText aria-hidden />
              {t("preview.wrap")}
            </button>
          )}
          {kind === "html" && remoteHtml && browser && (
            <button
              type="button"
              onClick={() =>
                browser.open(source?.source || tile.data.url || "", tile.id)
              }
            >
              <ExternalLink aria-hidden />
              {t("preview.openInBrowser")}
            </button>
          )}
          <button type="button" onClick={changeSource}>
            {t("preview.change")}
          </button>
        </div>
      </div>
      {error && (
        <div className="preview-error">
          <p>{error}</p>
          <button type="button" onClick={() => void pick("all")}>
            {t("preview.chooseAnother")}
          </button>
        </div>
      )}
      <div className="preview-body">
        {loading && <p className="preview-note">{t("preview.loading")}</p>}
        {!loading && source?.kind === "pdf" && assetUrl && (
          <PdfViewer url={assetUrl} scale={scale} onPages={setPages} />
        )}
        {!loading && source?.kind === "image" && assetUrl && (
          <ImageViewer
            url={assetUrl}
            fit={fit}
            onDimensions={(size) => setMeta(size)}
          />
        )}
        {!loading && source?.kind === "text" && source.text !== undefined && (
          <>
            <TextViewer text={source.text} wrap={wrap} />
            {source.truncated && (
              <p className="preview-note">{t("preview.truncated")}</p>
            )}
          </>
        )}
        {!loading && source?.kind === "html" && source.text !== undefined && (
          <>
            {!remoteHtml && (
              <p className="preview-note">{t("preview.localHtml")}</p>
            )}
            <TextViewer text={source.text} wrap={wrap} />
            {source.truncated && (
              <p className="preview-note">{t("preview.truncated")}</p>
            )}
          </>
        )}
        {!loading &&
          (source?.kind === "audio" || source?.kind === "video") &&
          mediaUrl && (
            <MediaViewer
              kind={source.kind}
              url={mediaUrl}
              onDuration={setMeta}
            />
          )}
        {!loading && source && kind === undefined && (
          <p className="preview-note">{t("preview.error.unsupported")}</p>
        )}
      </div>
      {overlay}
    </section>
  );
}

export default function createPreview(): ExtensionModule {
  return {
    activate(api) {
      function openFile(file: PreviewFile, alongside?: string) {
        return api.tabs.openTile(
          previewType,
          { kind: file.kind, title: file.name, token: file.token },
          alongside,
        );
      }

      async function openInput(input: PreviewInput, alongside?: string) {
        if (input.type === "file") return openFile(input.file, alongside);
        if (input.type === "explorer") {
          const file = await previewFromExplorer(input.token, input.segments);
          return openFile(file, alongside);
        }
        const url = input.urls.find((value) => /^https:\/\//i.test(value));
        if (!url) throw new Error(translateNow("preview.error.noLink"));
        const kind = kindOf(url);
        return api.tabs.openTile(
          previewType,
          {
            kind: kind ?? "",
            title: input.title || fileNameOf(url),
            url,
            id: input.id || urlId(url),
          },
          alongside,
        );
      }

      api.services.provide(previewOpener, {
        open: openInput,
        supports: (name) => isPreviewable(name),
      });

      api.services.provide(previewPdf, {
        async open(source, alongside) {
          const urls = source.urls.filter((value) =>
            /^https:\/\//i.test(value),
          );
          if (!urls.length)
            throw new Error(translateNow("preview.error.noLink"));
          const url = await invoke<string | null>("preview_probe", { urls });
          if (!url) throw new Error(translateNow("preview.error.noFreeLink"));
          return api.tabs.openTile(
            previewType,
            {
              kind: "pdf",
              title: source.title || fileNameOf(url),
              url,
              id: source.id,
            },
            alongside,
          );
        },
      });

      api.tiles.register({
        type: previewType,
        title: manifest.name,
        icon: manifest.icon,
        view: (props) => <PreviewView {...props} api={api} />,
        dataKeys: ["kind", "title", "token", "url", "id"],
        guide: localized("preview.guide"),
        tabTitle: (tile) =>
          tile.data.title ||
          (tile.data.url ? fileNameOf(tile.data.url) : undefined),
        describe: (tile, surface) => {
          const title =
            tile.data.title || (tile.data.url ? fileNameOf(tile.data.url) : "");
          if (!title) return translateNow("preview.describe.none");
          const kind = surface.kind || tile.data.kind;
          const label = kind
            ? translateNow(`preview.format.${kind}`)
            : translateNow("manifest.preview.name");
          const name = title.slice(0, 200);
          return `${label} · ${name}${surface.meta ? ` · ${surface.meta}` : ""}`;
        },
      });

      api.commands.register({
        id: "preview.open",
        title: localized("preview.command.open"),
        icon: manifest.icon,
        tileType: previewType,
        keywords: [
          "aperçu",
          "preview",
          "pdf",
          "image",
          "photo",
          "audio",
          "vidéo",
          "fichier",
        ],
        run: () => {
          const empty = api.tabs
            .getTiles()
            .find(
              (tile) =>
                tile.type === previewType && !tile.data.token && !tile.data.url,
            );
          if (empty) api.tabs.focusTile(empty.id);
          else api.tabs.openTile(previewType);
        },
      });
    },
  };
}
