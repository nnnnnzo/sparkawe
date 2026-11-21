import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type {
  ExtensionAPI,
  ExtensionModule,
  TileViewProps,
} from "../../sdk/react.ts";
import { previewPdf } from "./api.ts";
import manifest, { pdfType } from "./manifest.ts";
import "./style.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

function urlId(url: string) {
  let hash = 0;
  for (let index = 0; index < url.length; index++)
    hash = (hash * 31 + url.charCodeAt(index)) | 0;
  return `url-${Math.abs(hash).toString(36)}`;
}

function fileName(url: string) {
  try {
    const path = new URL(url).pathname;
    const name = path.split("/").filter(Boolean).at(-1);
    return name ? decodeURIComponent(name) : "PDF";
  } catch {
    return "PDF";
  }
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

function PdfView({ api, tile }: TileViewProps & { api: ExtensionAPI }) {
  const [draft, setDraft] = useState("");
  const [doc, setDoc] = useState<PDFDocumentProxy>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [scale, setScale] = useState(1.1);
  const url = tile.data.url;

  useEffect(() => {
    if (!url) {
      setDoc(undefined);
      setError(undefined);
      setLoading(false);
      return;
    }
    let alive = true;
    let task: pdfjs.PDFDocumentLoadingTask | undefined;
    setLoading(true);
    setError(undefined);
    setDoc(undefined);
    void (async () => {
      try {
        const file = await invoke<{ path: string }>("pdf_fetch", {
          urls: [url],
          id: tile.data.id || urlId(url),
        });
        const response = await fetch(convertFileSrc(file.path));
        const data = await response.arrayBuffer();
        if (!alive) return;
        task = pdfjs.getDocument({ data });
        const loaded = await task.promise;
        if (!alive) {
          void task.destroy();
          return;
        }
        setDoc(loaded);
        setLoading(false);
        api.tiles.publish(tile.id, {
          title: (tile.data.title ?? "").slice(0, 200),
          pages: String(loaded.numPages),
        });
      } catch (failure) {
        if (!alive) return;
        setError(failure instanceof Error ? failure.message : String(failure));
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
      void task?.destroy();
    };
  }, [url, tile.data.id, tile.data.title, tile.id, api]);

  function openLink(event: FormEvent) {
    event.preventDefault();
    const value = draft.trim();
    if (!value) return;
    if (!/^https:\/\//i.test(value)) {
      setError("Le lien doit commencer par https://.");
      return;
    }
    setError(undefined);
    api.tabs.updateTileData(tile.id, {
      id: crypto.randomUUID(),
      title: fileName(value),
      url: value,
    });
  }

  if (!url) {
    return (
      <section className="preview-pdf" aria-label="Aperçu PDF">
        <form className="preview-pdf-empty" onSubmit={openLink}>
          <h2>Ouvrir un PDF</h2>
          <p>
            Collez le lien d’un PDF libre. La lecture se fait dans Spark, sans
            quitter l’espace.
          </p>
          <input
            type="url"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="https://… .pdf"
            aria-label="Lien du PDF"
          />
          <button type="submit" disabled={!draft.trim()}>
            Ouvrir
          </button>
          {error && <p className="preview-pdf-error">{error}</p>}
        </form>
      </section>
    );
  }

  return (
    <section className="preview-pdf" aria-label="Aperçu PDF">
      <div className="preview-pdf-toolbar">
        <span className="preview-pdf-title">
          {tile.data.title || fileName(url)}
        </span>
        <div className="preview-pdf-actions">
          <button
            type="button"
            aria-label="Réduire"
            onClick={() => setScale((value) => Math.max(0.5, value - 0.15))}
          >
            −
          </button>
          <span className="preview-pdf-meta">{Math.round(scale * 100)} %</span>
          <button
            type="button"
            aria-label="Agrandir"
            onClick={() => setScale((value) => Math.min(3, value + 0.15))}
          >
            +
          </button>
          {doc && <span className="preview-pdf-meta">{doc.numPages} p.</span>}
        </div>
      </div>
      <div className="preview-pdf-scroll">
        {loading && <p className="preview-pdf-note">Lecture du PDF…</p>}
        {error && (
          <div className="preview-pdf-error">
            <p>{error}</p>
            <p className="preview-pdf-meta">{url}</p>
            <button
              type="button"
              onClick={() => api.tabs.updateTileData(tile.id, {})}
            >
              Choisir un autre lien
            </button>
          </div>
        )}
        {doc &&
          Array.from({ length: doc.numPages }, (_, index) => (
            <PdfPage key={index} doc={doc} number={index + 1} scale={scale} />
          ))}
      </div>
    </section>
  );
}

export default function createPreview(): ExtensionModule {
  return {
    activate(api) {
      api.services.provide(previewPdf, {
        async open(source, alongside) {
          const urls = source.urls.filter((value) =>
            /^https:\/\//i.test(value),
          );
          if (!urls.length) throw new Error("Aucun lien PDF proposé.");
          const url = await invoke<string | null>("pdf_probe", { urls });
          if (!url)
            throw new Error(
              "Aucun lien PDF libre ne répond pour ce document. Consultez le DOI.",
            );
          return api.tabs.openTile(
            pdfType,
            { id: source.id, title: source.title ?? "", url },
            alongside,
          );
        },
      });
      api.tiles.register({
        type: pdfType,
        title: "PDF",
        icon: manifest.icon,
        view: (props) => <PdfView {...props} api={api} />,
        dataKeys: ["id", "title", "url"],
        guide:
          "Visualiseur PDF. Ouvrez un lien https:// vers un PDF ; Spark le télécharge et le met en cache. Aucune action d’écriture et aucun accès MCP au contenu du fichier ; la surface expose seulement le titre et le nombre de pages.",
        describe: (tile) =>
          tile.data.title
            ? `PDF · ${tile.data.title}`
            : tile.data.url
              ? `PDF · ${fileName(tile.data.url)}`
              : "aucun PDF",
      });
      api.commands.register({
        id: "preview.open",
        title: "Ouvrir un PDF",
        icon: manifest.icon,
        tileType: pdfType,
        keywords: ["pdf", "aperçu", "lien", "document"],
        run: () => api.tabs.openTile(pdfType),
      });
    },
  };
}
