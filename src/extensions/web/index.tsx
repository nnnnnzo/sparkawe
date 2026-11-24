import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ArrowLeft, ArrowRight, Globe, RotateCw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { FormEvent } from "react";
import { localized } from "../../core/i18n.ts";
import { t as translateNow } from "../../i18n/index.ts";
import { useI18n } from "../../i18n/react.ts";
import type { Tile } from "../../sdk/index.ts";
import type {
  ExtensionAPI,
  ExtensionModule,
  TileViewProps,
} from "../../sdk/react.ts";
import {
  layoutIsDragging,
  layoutIsMoving,
  subscribeLayoutChange,
  subscribeLayoutDrag,
  subscribeLayoutMotion,
} from "../../ui/layoutSignal.ts";
import { openAsTab } from "../../ui/layoutPlacement.ts";
import { webBrowser } from "./api.ts";
import manifest, { pageType } from "./manifest.ts";
import {
  type Bounds,
  closePage,
  historyPage,
  hostOf,
  isPublic,
  navigatePage,
  normalize,
  noteShown,
  openPage,
  placePage,
  readPage,
  reloadPage,
  showPage,
  snapshotPage,
} from "./pages.ts";
import "./style.css";

let api: ExtensionAPI;
let appearance: MutationObserver | undefined;

/** Pousse le schéma couleur de Spark aux vues web : les pages passent en
 * sombre avec le thème sombre, sans dépendre de l’apparence du système. */
function watchAppearance() {
  const root = document.documentElement;
  const push = () => {
    void invoke("web_appearance", {
      dark: root.classList.contains("dark"),
    }).catch(() => {});
  };
  push();
  appearance?.disconnect();
  appearance = new MutationObserver(push);
  appearance.observe(root, { attributes: true, attributeFilter: ["class"] });
}

interface PageState {
  url: string;
  title: string;
  loading: boolean;
}

interface StateEvent {
  tile: string;
  url?: string;
  title?: string;
  loading?: boolean;
  notice?: string;
}

interface PopupEvent {
  tile: string;
  url: string;
}

function text(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

function same(left: Bounds | undefined, right: Bounds) {
  return (
    left !== undefined &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

/** Couches flottantes de l’interface : elles s’affichent dans des portails et
 * doivent passer au-dessus de la page, qui est une vue native. */
const FLOATING = [
  ".spark-store",
  '[data-slot="dropdown-menu-content"]',
  '[data-slot="dropdown-menu-sub-menu-content"]',
  '[data-slot="dropdown-menu-content"]',
  '[data-slot="popover-content"]',
  '[data-slot="dialog-content"]',
  '[data-slot="sheet-content"]',
  '[data-sonner-toaster]',
  // Infobulle d’un onglet de navigateur : elle doit passer au-dessus de la page.
  "[data-spark-tab-hint]",
].join(",");

function overlaps(left: DOMRect, right: DOMRect) {
  return (
    left.right > right.left &&
    left.left < right.right &&
    left.bottom > right.top &&
    left.top < right.bottom
  );
}

interface Presentation {
  /** La page est réellement visible à l’écran. */
  shown: boolean;
  /** Une couche de l’interface la recouvre (menu, infobulle, Store). */
  blocked: boolean;
}

/**
 * Spark masque un onglet avec `visibility`, Dockview aussi. Un simple
 * rectangle non nul ne suffit donc pas à savoir si la page est présentée : une
 * vue native passe au-dessus du DOM, il faut aussi que rien ne la recouvre
 * (Store, menu, dialogue, infobulle) et qu’elle tienne dans la fenêtre.
 */
function presentation(element: HTMLElement): Presentation {
  if (!element.isConnected) return { shown: false, blocked: false };
  const rect = element.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) {
    return { shown: false, blocked: false };
  }
  if (
    rect.left < -1 ||
    rect.top < -1 ||
    rect.right > window.innerWidth + 1 ||
    rect.bottom > window.innerHeight + 1
  ) {
    return { shown: false, blocked: false };
  }
  if (typeof element.checkVisibility === "function") {
    if (
      !element.checkVisibility({
        checkVisibilityCSS: true,
        contentVisibilityAuto: true,
      })
    ) {
      return { shown: false, blocked: false };
    }
  } else {
    for (
      let node: HTMLElement | null = element;
      node;
      node = node.parentElement
    ) {
      const style = getComputedStyle(node);
      if (style.visibility === "hidden" || style.display === "none") {
        return { shown: false, blocked: false };
      }
    }
  }
  for (const layer of document.querySelectorAll<HTMLElement>(FLOATING)) {
    const box = layer.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    if (overlaps(box, rect)) return { shown: false, blocked: true };
  }
  const x = Math.round(rect.left + rect.width / 2);
  const y = Math.round(rect.top + rect.height / 2);
  const top = document.elementFromPoint(x, y);
  if (top !== null && !element.contains(top)) {
    return { shown: false, blocked: true };
  }
  return { shown: true, blocked: false };
}


/**
 * Boîte de la vue native. Pendant une animation de disposition, c’est le
 * conteneur du groupe qui bouge : l’overlay du panneau garde une géométrie
 * périmée jusqu’à la réparation. On se cale donc sur le conteneur et on y
 * reporte la position de la page.
 */
function boxOf(element: HTMLElement): Bounds | undefined {
  const rect = element.getBoundingClientRect();
  const container = element.closest(".dv-content-container");
  const overlay = element.closest(".dv-render-overlay");
  if (container && overlay) {
    const frame = container.getBoundingClientRect();
    const stale = overlay.getBoundingClientRect();
    return {
      x: Math.round(frame.left + (rect.left - stale.left)),
      y: Math.round(frame.top + (rect.top - stale.top)),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function Page({ tile, active, api }: TileViewProps & { api: ExtensionAPI }) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const box = useRef<Bounds | undefined>(undefined);
  const placed = useRef<Bounds | undefined>(undefined);
  const current = useRef<PageState>({
    url: tile.data.url ?? "",
    title: tile.data.title ?? "",
    loading: false,
  });
  const [page, setPage] = useState<PageState>(current.current);
  const [bounds, setBounds] = useState<Bounds>();
  const [draft, setDraft] = useState(current.current.url);
  const [shown, setShown] = useState(false);
  /** Une couche de l’interface recouvre la page : on la masque sans attendre. */
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  /** Image de la page pendant un glisser-déposer : dans le DOM, elle passe
   * sous la vignette et la cible de dépôt, contrairement à la vue native. */
  const [frozen, setFrozen] = useState<string>();
  /** Report du masquage : une mesure transitoire ne doit pas faire clignoter. */
  const hideTimer = useRef(0);

  const merge = useCallback((change: Partial<PageState>) => {
    current.current = { ...current.current, ...change };
    setPage(current.current);
  }, []);

  // Mesure du rectangle de la page : glisser, redimensionner, défiler, animer
  // une disposition et changer d’onglet changent tous sa position. Pendant une
  // animation, on suit le conteneur du groupe image par image : la page glisse
  // avec son cadre au lieu de disparaître ou de sauter à l’arrivée.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let scheduled = 0;
    let follow = 0;

    const measure = () => {
      scheduled = 0;
      const next = boxOf(element);
      if (!next) return;
      box.current = next;
      setBounds((previous) =>
        previous &&
        previous.width === next.width &&
        previous.height === next.height
          ? previous
          : next,
      );
      const state = presentation(element);
      setShown(state.shown);
      setBlocked(state.blocked);
      const last = placed.current;
      if (last && same(last, next)) return;
      placed.current = next;
      void placePage(tile.id, next).catch(() => {});
    };
    /**
     * La bascule d’un onglet du groupe est appliquée par Dockview dans son
     * propre cycle : une seule image peut mesurer un état encore périmé. On
     * mesure donc tout de suite, puis encore après la bascule.
     */
    const schedule = () => {
      measure();
      if (!scheduled) scheduled = requestAnimationFrame(measure);
      if (follow) window.clearTimeout(follow);
      follow = window.setTimeout(() => {
        follow = 0;
        measure();
      }, 90);
    };

    const motion = () => {
      // Le signal sert à remasurer : le masquage passe par `visible`.
      schedule();
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    // Le Store, la palette et les dialogues se posent au-dessus du DOM sans
    // redimensionner la tuile : leur apparition doit aussi provoquer une mesure.
    const overlays = new MutationObserver(schedule);
    overlays.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["inert", "aria-hidden"],
    });
    // Une bascule d’onglet du groupe change la visibilité de l’overlay et la
    // classe du groupe : on surveille la chaîne d’ancêtres, sinon la nouvelle
    // page reste cachée tant que quelqu’un ne retouche pas l’onglet.
    const ancestors = new MutationObserver(schedule);
    for (
      let node = element.parentElement;
      node && node !== document.documentElement;
      node = node.parentElement
    ) {
      ancestors.observe(node, {
        attributes: true,
        attributeFilter: ["class", "style", "hidden", "inert", "aria-hidden"],
      });
    }
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    const stopMotion = subscribeLayoutMotion(motion);
    const stopChange = subscribeLayoutChange(schedule);
    schedule();
    return () => {
      observer.disconnect();
      overlays.disconnect();
      ancestors.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      stopMotion();
      stopChange();
      if (scheduled) cancelAnimationFrame(scheduled);
      if (follow) window.clearTimeout(follow);
    };
  }, [tile.id]);

  useEffect(() => {
    return () => {
      if (hideTimer.current !== 0) window.clearTimeout(hideTimer.current);
    };
  }, []);

  // Pendant un glisser-déposer, la page devient une image : elle reste
  // visible, et l’interface du geste passe au-dessus.
  const dragging = useSyncExternalStore(subscribeLayoutDrag, layoutIsDragging);
  const moving = useSyncExternalStore(subscribeLayoutMotion, layoutIsMoving);
  useEffect(() => {
    if (!dragging) {
      setFrozen(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      const image = await snapshotPage(tile.id).catch(() => "");
      if (!cancelled && image) setFrozen(image);
    })();
    return () => {
      cancelled = true;
    };
  }, [dragging, tile.id]);

  // Ouvre ou rejoint la vue dès que la page est réellement présentée.
  const visible = Boolean(
    active &&
    shown &&
    !moving &&
    !frozen &&
    bounds &&
    bounds.width >= 8 &&
    bounds.height >= 8,
  );
  useEffect(() => {
    if (!visible) {
      // Pendant un glissement, la page se masque tout de suite, comme les
      // autres tuiles ; sinon un redimensionnement peut faire passer la tuile
      // par une géométrie intermédiaire et on laisse passer une image.
      if (moving || blocked) {
        if (hideTimer.current !== 0) {
          window.clearTimeout(hideTimer.current);
          hideTimer.current = 0;
        }
        void showPage(tile.id, false).catch(() => {});
        return;
      }
      if (hideTimer.current === 0) {
        hideTimer.current = window.setTimeout(() => {
          hideTimer.current = 0;
          void showPage(tile.id, false).catch(() => {});
        }, 130);
      }
      return;
    }
    if (hideTimer.current !== 0) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = 0;
    }
    const url = current.current.url;
    const target = box.current;
    if (!url || !target) return;
    let cancelled = false;
    void (async () => {
      try {
        await openPage(tile.id, url, target);
        if (cancelled) return;
        noteShown(tile.id);
        setError(undefined);
      } catch (cause) {
        if (!cancelled) setError(text(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tile.id, visible, moving, blocked]);

  // Surface bornée pour le brief et les agents : jamais le contenu de la page.
  useEffect(() => {
    api.tiles.publish(tile.id, {
      url: page.url,
      title: page.title,
      loading: page.loading ? "true" : "false",
    });
  }, [api, tile.id, page]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(undefined), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const disposers: (() => void)[] = [];
    let disposed = false;
    const keep = (dispose: () => void) => {
      if (disposed) dispose();
      else disposers.push(dispose);
    };
    void listen<StateEvent>("web-state", ({ payload }) => {
      if (payload.tile !== tile.id) return;
      merge({
        ...(payload.url !== undefined && { url: payload.url }),
        ...(payload.title !== undefined && { title: payload.title }),
        ...(payload.loading !== undefined && { loading: payload.loading }),
      });
      if (payload.url !== undefined) setDraft(payload.url);
      if (payload.notice !== undefined) setNotice(payload.notice);
      if (payload.url === undefined && payload.title === undefined) return;
      api.tabs.updateTileData(tile.id, {
        url: current.current.url,
        title: current.current.title,
      });
    }).then(keep);
    void listen<PopupEvent>("web-popup", ({ payload }) => {
      if (payload.tile !== tile.id) return;
      if (!isPublic(payload.url)) {
        setNotice("insecure");
        return;
      }
      const opened = api.tabs.openTile(pageType, { url: payload.url }, tile.id);
      openAsTab(opened.id, tile.id);
    }).then(keep);
    return () => {
      disposed = true;
      for (const dispose of disposers) dispose();
    };
  }, [api, merge, tile.id]);

  async function open(url: string) {
    const target = normalize(url);
    if (!target) return;
    if (!isPublic(target)) {
      setError(t("web.error.insecure"));
      return;
    }
    setDraft(target);
    const frame = box.current;
    if (!frame) return;
    try {
      const created = await openPage(tile.id, target, frame);
      noteShown(tile.id);
      // Une vue existante ne navigue pas d’elle-même : on le fait ici.
      if (!created) await navigatePage(tile.id, target);
      merge({ url: target });
      setError(undefined);
    } catch (cause) {
      setError(text(cause));
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void open(draft);
  }

  async function step(moveBy: number) {
    try {
      await historyPage(tile.id, moveBy);
    } catch (cause) {
      setError(text(cause));
    }
  }

  async function reload() {
    try {
      await reloadPage(tile.id);
    } catch (cause) {
      setError(text(cause));
    }
  }

  return (
    <section className="web-page">
      <form className="web-bar" onSubmit={submit}>
        <button
          type="button"
          className="web-step"
          title={t("web.back")}
          aria-label={t("web.back")}
          disabled={!page.url}
          onClick={() => void step(-1)}
        >
          <ArrowLeft size={14} strokeWidth={1.7} />
        </button>
        <button
          type="button"
          className="web-step"
          title={t("web.forward")}
          aria-label={t("web.forward")}
          disabled={!page.url}
          onClick={() => void step(1)}
        >
          <ArrowRight size={14} strokeWidth={1.7} />
        </button>
        <button
          type="button"
          className="web-step"
          title={t("web.reload")}
          aria-label={t("web.reload")}
          disabled={!page.url}
          onClick={() => void reload()}
        >
          <RotateCw
            size={14}
            strokeWidth={1.7}
            className={page.loading ? "web-spin" : undefined}
          />
        </button>
        <input
          className="web-address"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label={t("web.address")}
          placeholder={t("web.address.placeholder")}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </form>
      <div className="web-viewport" ref={host}>
        {frozen && <img className="web-frozen" src={frozen} alt="" />}
        {!page.url && (
          <div className="web-empty">
            <Globe size={28} strokeWidth={1.2} aria-hidden />
            <p className="web-empty-title">{t("web.empty.title")}</p>
            <p className="web-empty-hint">{t("web.empty.hint")}</p>
          </div>
        )}
      </div>
      {error && (
        <p className="web-error" role="alert">
          {error}
        </p>
      )}
      {notice === "download" && (
        <p className="web-notice">{t("web.notice.download")}</p>
      )}
      {notice === "insecure" && (
        <p className="web-notice">{t("web.error.insecure")}</p>
      )}
    </section>
  );
}

export default function createWeb(): ExtensionModule {
  return {
    activate(extension) {
      api = extension;
      watchAppearance();
      extension.services.provide(webBrowser, {
        open: (url, alongside) =>
          extension.tabs.openTile(pageType, { url }, alongside),
      });
      extension.tiles.register({
        type: pageType,
        title: localized("manifest.web.name"),
        icon: manifest.icon,
        view: (props) => <Page {...props} api={extension} />,
        dataKeys: ["url", "title"],
        guide: localized("web.guide"),
        tabTitle: (tile) => tile.data.title,
        prepare(data) {
          const url = normalize(data.url ?? "");
          return url ? { ...data, url } : data;
        },
        describe(tile, surface) {
          const url = surface.url || tile.data.url;
          if (!url) return translateNow("web.describe.none");
          const title = surface.title || tile.data.title;
          return title ? `${title} — ${hostOf(url)}` : hostOf(url);
        },
        actions: {
          navigate: {
            title: localized("web.action.navigate"),
            description: localized("web.action.navigate.hint"),
            mutates: true,
            inverse: {
              capture: (tile) =>
                tile.data.url
                  ? { url: tile.data.url, title: tile.data.title ?? "" }
                  : undefined,
              restore: async (tile, snapshot) => {
                const value = snapshot as
                  | { url?: string; title?: string }
                  | undefined;
                if (!value?.url) return { url: "" };
                extension.tabs.updateTileData(tile.id, {
                  url: value.url,
                  title: value.title ?? "",
                });
                await navigatePage(tile.id, value.url).catch(() => {});
                return { url: value.url };
              },
            },
            input: {
              url: { type: "string", description: "https://example.org/" },
            },
            run: async (tile, input) => {
              const url = normalize(String(input.url ?? ""));
              if (!url) throw new Error(translateNow("web.error.address"));
              if (!isPublic(url))
                throw new Error(translateNow("web.error.insecure"));
              // La tuile retient l’adresse même si sa vue n’est pas encore
              // affichée : elle s’ouvrira dessus à la première présentation.
              extension.tabs.updateTileData(tile.id, { url, title: "" });
              await navigatePage(tile.id, url).catch(() => {});
              return { url };
            },
          },
          back: {
            title: localized("web.action.back"),
            run: (tile) => historyPage(tile.id, -1),
          },
          forward: {
            title: localized("web.action.forward"),
            run: (tile) => historyPage(tile.id, 1),
          },
          reload: {
            title: localized("web.action.reload"),
            run: (tile) => reloadPage(tile.id),
          },
          read_text: {
            title: localized("web.action.read"),
            description: localized("web.action.read.hint"),
            run: (tile) => readPage(tile.id),
          },
        },
        close: (tile: Tile) => closePage(tile.id).catch(() => {}),
      });
      extension.commands.register({
        id: "web.open",
        title: localized("web.command.open"),
        icon: manifest.icon,
        tileType: pageType,
        keywords: ["web", "navigateur", "page", "url", "lien"],
        run: () => extension.tabs.openTile(pageType),
      });
    },
    async deactivate() {
      appearance?.disconnect();
      appearance = undefined;
      const pages = api.tabs
        .getAllTiles()
        .filter((tile) => tile.type === pageType);
      await Promise.all(
        pages.map((tile) => closePage(tile.id).catch(() => {})),
      );
    },
  };
}
