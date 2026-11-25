import {
  ArrowLeft,
  Blocks,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Compass,
  FolderSearch,
  Library,
  LoaderCircle,
  PackageCheck,
  Pin,
  RefreshCw,
  Search,
  SearchX,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { motion, useIsPresent, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import type { RemoteExtension } from "../../app/marketplace.ts";
import type { Runtime } from "../../app/runtime.ts";
import { useI18n } from "../../i18n/react.ts";
import type { Manifest } from "../../sdk/index.ts";
import { Button } from "@spark/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@spark/ui/components/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@spark/ui/components/empty";
import { Input } from "@spark/ui/components/input";
import { SPECTRUM } from "../../shared/brand/index.tsx";
import { pickFolder } from "../../extensions/explorer/files.ts";
import { report } from "../errors.ts";
import { Icon } from "../icons.tsx";
import { CertifiedBadge } from "./certified-badge.tsx";
import { StoreCard } from "./card.tsx";
import {
  ALL_CATEGORIES,
  FEATURED_IDS,
  TIER_LABEL_KEY,
  TIER_SECTION_KEY,
  activeStoreView,
  backRoute,
  categoryLabel,
  isCertified,
  matchesQuery,
  stateOf,
  storeOrder,
  tierOf,
  type StoreRoute,
  type StoreState,
} from "./data.ts";
import { FeaturedHero, Shelf } from "./featured.tsx";
import "./style.css";

const extensionColor = (manifest: Manifest) => manifest.color ?? SPECTRUM.blue;

function StoreAction({
  busy,
  confirmed,
  children,
  onClick,
  ...props
}: ComponentProps<typeof Button> & { busy?: boolean; confirmed?: boolean }) {
  return (
    <>
      <Button
        {...props}
        aria-busy={busy || undefined}
        aria-disabled={busy || undefined}
        onClick={(event) => {
          if (busy) event.preventDefault();
          else onClick?.(event);
        }}
      >
        <span className="store-action-icon" aria-hidden>
          {busy ? (
            <LoaderCircle className="store-action-spinner" />
          ) : confirmed ? (
            <CheckCircle2 />
          ) : null}
        </span>
        {children}
      </Button>
      <span className="sr-only" role="status">
        {busy ? children : null}
      </span>
    </>
  );
}

const STATE_KEY: Record<StoreState, string> = {
  active: "store.state.active",
  inactive: "store.state.inactive",
  "not-installed": "store.state.not-installed",
};

function SidebarItem({
  icon,
  label,
  active,
  count,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="store-nav-item"
      aria-current={active ? "page" : undefined}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {icon}
      <span className="store-nav-label">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="store-nav-count">{count}</span>
      )}
    </button>
  );
}

function StoreRow({
  manifest,
  active,
  pinned,
  pendingEnabled,
  onOpen,
  onToggle,
  onPin,
}: {
  manifest: Manifest;
  active: boolean;
  pinned: boolean;
  pendingEnabled?: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onPin: () => void;
}) {
  const { t, text } = useI18n();
  const name = text(manifest.name);
  const subtitle = text(manifest.subtitle);
  const tier = t(TIER_LABEL_KEY[tierOf(manifest)]);
  const label = subtitle ? t("store.list.item", { name, subtitle }) : name;
  return (
    <div className="store-row">
      <span className="store-row-icon">
        <Icon
          glyph={manifest.icon}
          extension={manifest}
          size={24}
          strokeWidth={1.6}
        />
      </span>
      <span className="store-row-info">
        <button
          type="button"
          className="store-row-open"
          aria-label={
            isCertified(manifest)
              ? `${label}${t("store.certified.suffix")}`
              : label
          }
          onClick={onOpen}
        >
          {name}
          {isCertified(manifest) && (
            <CertifiedBadge size={13} focusable={false} decorative />
          )}
        </button>
        <span className="store-row-meta">
          {subtitle || tier} · {manifest.version}
        </span>
      </span>
      <span className="store-row-state" data-active={active}>
        {active ? t("store.state.active") : t("store.state.inactive")}
      </span>
      {active && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-pressed={pinned}
          aria-label={t(pinned ? "store.row.unpinAria" : "store.row.pinAria", {
            name,
          })}
          title={t(pinned ? "store.row.unpin" : "store.row.pin")}
          onClick={onPin}
        >
          <Pin fill={pinned ? "currentColor" : "none"} />
        </Button>
      )}
      <StoreAction
        variant="outline"
        size="sm"
        busy={pendingEnabled !== undefined}
        onClick={onToggle}
      >
        {pendingEnabled === undefined
          ? t(active ? "store.row.disable" : "store.row.enable")
          : t(
              pendingEnabled
                ? "store.detail.enabling"
                : "store.detail.disabling",
            )}
      </StoreAction>
      <Button
        variant="ghost"
        size="sm"
        data-store-key={`row:${manifest.id}`}
        onClick={onOpen}
      >
        {t("store.row.details")}
      </Button>
    </div>
  );
}

function RemoteCard({
  remote,
  onOpen,
}: {
  remote: RemoteExtension;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="store-card store-card-grid"
      aria-label={t("store.card.open", { name: remote.extension.name })}
      data-store-key={`remote:${remote.source.url}:${remote.extension.id}`}
      onClick={onOpen}
    >
      <span className="store-card-body">
        <span className="store-card-top">
          <span className="store-card-icon">
            <Blocks size={26} strokeWidth={1.6} />
          </span>
          <span className="store-card-name">{remote.extension.name}</span>
        </span>
        <span className="store-card-subtitle">
          {remote.extension.publisher ?? remote.source.name}
        </span>
        <span className="store-card-foot">
          <ChevronRight className="store-card-chevron" aria-hidden />
        </span>
      </span>
    </button>
  );
}

function ScreenshotGallery({ manifest }: { manifest: Manifest }) {
  const { t, text } = useI18n();
  const screenshots = manifest.screenshots ?? [];
  const name = text(manifest.name);
  const ref = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(screenshots.length <= 1);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      setAtStart(element.scrollLeft <= 2);
      setAtEnd(
        element.scrollLeft + element.clientWidth >= element.scrollWidth - 2,
      );
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [screenshots.length]);

  const move = (direction: -1 | 1) => {
    const element = ref.current;
    if (!element) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    element.scrollBy({
      left: direction * element.clientWidth * 0.8,
      behavior: reduced ? "auto" : "smooth",
    });
  };

  if (!screenshots.length)
    return (
      <div className="store-gallery store-gallery-empty" aria-hidden>
        <Icon
          glyph={manifest.icon}
          extension={manifest}
          size={64}
          strokeWidth={1.3}
        />
        <span>{text(manifest.subtitle) || name}</span>
      </div>
    );

  if (screenshots.length === 2)
    return (
      <section
        className="store-gallery"
        aria-label={t("store.gallery.aria", { name })}
      >
        <div className="store-gallery-head">
          <span className="store-gallery-label">
            {t("store.gallery.label")}
          </span>
        </div>
        <div className="store-gallery-split">
          {screenshots.map((source, index) => (
            <figure className="store-gallery-item" key={source}>
              <img
                src={source}
                alt={t("store.gallery.alt", { index: index + 1, name })}
                loading={index === 0 ? "eager" : "lazy"}
                draggable={false}
              />
            </figure>
          ))}
        </div>
      </section>
    );

  return (
    <section
      className="store-gallery"
      aria-label={t("store.gallery.aria", { name })}
    >
      <div className="store-gallery-head">
        <span className="store-gallery-label">
          {screenshots.length > 1
            ? t("store.gallery.label")
            : t("store.gallery.labelOne")}
        </span>
        {screenshots.length > 2 && (
          <div className="store-gallery-arrows">
            <button
              type="button"
              aria-label={t("store.gallery.previous")}
              disabled={atStart}
              onClick={() => move(-1)}
            >
              <ChevronLeft />
            </button>
            <button
              type="button"
              aria-label={t("store.gallery.next")}
              disabled={atEnd}
              onClick={() => move(1)}
            >
              <ChevronRight />
            </button>
          </div>
        )}
      </div>
      <div
        ref={ref}
        className="store-gallery-track"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          move(event.key === "ArrowLeft" ? -1 : 1);
        }}
      >
        {screenshots.map((source, index) => (
          <figure className="store-gallery-item" key={source}>
            <img
              src={source}
              alt={t("store.gallery.alt", { index: index + 1, name })}
              loading={index === 0 ? "eager" : "lazy"}
              draggable={false}
            />
          </figure>
        ))}
      </div>
    </section>
  );
}

export function StorePage({
  runtime,
  onClose,
  dev = false,
}: {
  runtime: Runtime;
  onClose: (restoreFocus?: boolean) => void;
  dev?: boolean;
}) {
  const workspace = runtime.workspace;
  const state = useSyncExternalStore(workspace.subscribe, workspace.get);
  const activeKey = useSyncExternalStore(runtime.registry.subscribeTools, () =>
    runtime.registry
      .getExtensions()
      .map(({ id }) => id)
      .sort()
      .join("|"),
  );
  const catalogVersion = useSyncExternalStore(
    runtime.extensions.subscribeCatalog,
    () => runtime.extensions.catalogVersion,
  );
  const marketRevision = useSyncExternalStore(
    runtime.marketplace.subscribe,
    () => runtime.marketplace.version,
  );
  const { locale, t, tp, text } = useI18n();
  const present = useIsPresent();
  const reduced = useReducedMotion();
  const [route, setRoute] = useState<StoreRoute>({ view: "home" });
  const previousRoute = useRef(route);
  /** Carte qui a ouvert la fiche ou le dépôt, et carte à refocaliser au retour. */
  const originKey = useRef<string | undefined>(undefined);
  const returnFocus = useRef<string | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(
    new Map(),
  );
  const [source, setSource] = useState("");
  const [installing, setInstalling] = useState(false);
  const [picking, setPicking] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Manifest | null>(null);
  const [removing, setRemoving] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [addingSource, setAddingSource] = useState(false);
  const [remoteBusy, setRemoteBusy] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    id: string;
    local: boolean;
  }>();
  const confirmationTimer = useRef<number | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const confirmInstall = useCallback((id: string, local: boolean) => {
    window.clearTimeout(confirmationTimer.current);
    setConfirmation({ id, local });
    confirmationTimer.current = window.setTimeout(
      () => setConfirmation(undefined),
      900,
    );
  }, []);
  useEffect(() => () => window.clearTimeout(confirmationTimer.current), []);
  const origin = activeStoreView(route);
  const back = useCallback(() => {
    returnFocus.current = originKey.current;
    setRoute(backRoute(route));
  }, [route]);
  const fromRepository =
    route.view === "detail" && typeof route.from === "object";
  const originLabel = fromRepository
    ? t("store.sources.repositoryFallback")
    : {
        home: t("store.title"),
        updates: t("store.nav.updates"),
        installed: t("store.nav.installed"),
        sources: t("store.nav.sources"),
      }[origin];

  const catalog = useMemo(
    () => runtime.extensions.catalog,
    [runtime, catalogVersion],
  );
  const activeIds = useMemo(
    () => new Set(activeKey ? activeKey.split("|") : []),
    [activeKey],
  );
  const installed = useMemo(
    () => new Set(state.installedExtensions ?? []),
    [state.installedExtensions],
  );
  const selected = useMemo(
    () => new Set(state.pinned ?? catalog.map(({ id }) => id)),
    [state.pinned, catalog],
  );
  const byId = useMemo(
    () => new Map(catalog.map((manifest) => [manifest.id, manifest])),
    [catalog],
  );
  const categories = useMemo(
    () => [
      ALL_CATEGORIES,
      ...Array.from(
        new Set(
          catalog
            .map(({ category }) => category)
            .filter((value): value is string => !!value),
        ),
      ),
    ],
    [catalog],
  );
  const trimmedQuery = query.trim();
  const filtered = useMemo(
    () =>
      catalog
        .filter(
          (manifest) =>
            matchesQuery(manifest, trimmedQuery, locale) &&
            (category === ALL_CATEGORIES || manifest.category === category),
        )
        .sort((first, second) => storeOrder(first, second, locale)),
    [catalog, category, locale, trimmedQuery],
  );
  const shelves = useMemo(
    () =>
      (["core", "official"] as const)
        .map((tier) => ({
          tier,
          items: catalog
            .filter((manifest) => tierOf(manifest) === tier)
            .sort((first, second) => storeOrder(first, second, locale)),
        }))
        .filter(({ items }) => items.length > 0),
    [catalog, locale],
  );
  const installedItems = useMemo(
    () =>
      catalog
        .filter((manifest) => installed.has(manifest.id))
        .sort((first, second) => storeOrder(first, second, locale)),
    [catalog, installed, locale],
  );
  const installedCount = installedItems.length;
  const installedManifests = useMemo(
    () =>
      catalog.filter(
        (manifest) =>
          installed.has(manifest.id) &&
          (manifest.tier ?? "core") === "community",
      ),
    [catalog, installed],
  );
  const remoteEntries = useMemo(
    () => runtime.marketplace.entries,
    [runtime, marketRevision],
  );
  const communityCatalog = useMemo(
    () =>
      catalog
        .filter((manifest) => tierOf(manifest) === "community")
        .sort((first, second) => storeOrder(first, second, locale)),
    [catalog, locale],
  );
  const communityRemote = useMemo(
    () =>
      remoteEntries
        .filter((remote) => !byId.has(remote.extension.id))
        .sort((first, second) =>
          first.extension.name.localeCompare(second.extension.name, locale),
        ),
    [byId, locale, remoteEntries],
  );
  const updates = useMemo(
    () => runtime.marketplace.updates(installedManifests),
    [installedManifests, marketRevision, runtime],
  );
  const featured = useMemo(
    () =>
      FEATURED_IDS.map((id) => byId.get(id)).find(
        (manifest): manifest is Manifest => !!manifest,
      ) ?? catalog[0],
    [byId, catalog],
  );

  const setEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      setPending((current) => new Map(current).set(id, enabled));
      try {
        await runtime.extensions.setEnabled(id, enabled);
      } catch (error) {
        const manifest = catalog.find((candidate) => candidate.id === id);
        toast.error(
          t(enabled ? "store.toast.enableFailed" : "store.toast.disableFailed", {
            name: manifest ? text(manifest.name) : id,
          }),
          { description: error instanceof Error ? error.message : String(error) },
        );
      } finally {
        setPending((current) => {
          const next = new Map(current);
          next.delete(id);
          return next;
        });
      }
    },
    [catalog, runtime, t, text],
  );

  const installExtension = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const path = source.trim();
      if (!path || installing) return;
      setConfirmation(undefined);
      setInstalling(true);
      try {
        const manifest = await runtime.extensions.install(path);
        setSource("");
        confirmInstall(manifest.id, true);
        toast.success(
          t("store.toast.installed", { name: text(manifest.name) }),
        );
      } catch (error) {
        report(error);
      } finally {
        setInstalling(false);
      }
    },
    [confirmInstall, installing, runtime, source, t, text],
  );

  const browseSource = useCallback(async () => {
    if (picking || installing) return;
    setPicking(true);
    try {
      const folder = await pickFolder();
      if (folder) setSource(folder.path);
    } catch (error) {
      report(error);
    } finally {
      setPicking(false);
    }
  }, [installing, picking]);

  async function uninstallExtension() {
    if (!removeTarget || removing) return;
    setRemoving(true);
    try {
      await runtime.extensions.uninstall(removeTarget.id);
      toast.success(
        t("store.toast.uninstalled", { name: text(removeTarget.name) }),
      );
      setRemoveTarget(null);
      setRoute({ view: "home" });
    } catch (error) {
      report(error);
    } finally {
      setRemoving(false);
    }
  }

  async function addRepository(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = sourceUrl.trim();
    if (!url || addingSource) return;
    setAddingSource(true);
    try {
      let name = sourceName.trim();
      if (!name) {
        try {
          name = new URL(url).hostname;
        } catch {
          name = t("store.sources.repositoryFallback");
        }
      }
      await runtime.marketplace.addSource(url, name);
      setSourceUrl("");
      setSourceName("");
      setRoute({ view: "repository", url });
      toast.success(t("store.toast.sourceAdded"));
    } catch (error) {
      report(error);
    } finally {
      setAddingSource(false);
    }
  }

  async function removeRepository(url: string) {
    try {
      await runtime.marketplace.removeSource(url);
    } catch (error) {
      report(error);
    }
  }

  async function refreshMarket() {
    try {
      await runtime.marketplace.restore();
    } catch (error) {
      report(error);
    }
  }

  async function installRemote(remote: (typeof remoteEntries)[number]) {
    if (remoteBusy) return;
    setRemoteBusy(remote.extension.id);
    try {
      const manifest = await runtime.marketplace.install(remote);
      confirmInstall(manifest.id, false);
      toast.success(t("store.toast.installed", { name: text(manifest.name) }));
    } catch (error) {
      report(error);
    } finally {
      setRemoteBusy(null);
    }
  }

  const togglePin = useCallback(
    (id: string) => {
      const current = workspace.get().pinned ?? catalog.map(({ id }) => id);
      const pinned = current.includes(id);
      workspace.patch({
        pinned: pinned
          ? current.filter((value) => value !== id)
          : [...current, id],
      });
    },
    [catalog, workspace],
  );

  const openRepository = useCallback((url: string) => {
    originKey.current = (document.activeElement as HTMLElement | null)?.dataset
      .storeKey;
    setRoute({ view: "repository", url });
  }, []);

  const openDetail = useCallback((id: string, source?: string) => {
    originKey.current = (document.activeElement as HTMLElement | null)?.dataset
      .storeKey;
    setRoute((current) => ({
      view: "detail",
      id,
      ...(source ? { source } : {}),
      from:
        current.view === "detail"
          ? (current.from ?? "home")
          : current.view === "repository"
            ? { view: "repository", url: current.url }
            : current.view,
    }));
  }, []);

  const openExtension = useCallback(
    (id: string) => {
      const command = runtime.registry
        .getCommands()
        .find((candidate) => candidate.tileType && candidate.owner.id === id);
      if (!command) return;
      onClose(false);
      void Promise.resolve()
        .then(() => command.run())
        .catch(report);
    },
    [onClose, runtime],
  );

  useEffect(() => {
    if (!present) return;
    const restore = returnFocus.current;
    returnFocus.current = undefined;
    const frame = requestAnimationFrame(() => {
      // Revenir doit rendre le focus à la carte d’origine, pas au début de
      // la vue : au clavier, on retrouve sa place dans la liste.
      const restored = restore
        ? [...document.querySelectorAll<HTMLElement>("[data-store-key]")].find(
            (element) => element.dataset.storeKey === restore,
          )
        : undefined;
      const target =
        restored ??
        (route.view === "home" ? searchRef.current : mainRef.current);
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [present, route]);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [route]);

  useLayoutEffect(() => {
    const changed = previousRoute.current !== route;
    previousRoute.current = route;
    if (!changed || reduced || !present) return;
    const animation = mainRef.current?.animate(
      [{ opacity: 0.35 }, { opacity: 1 }],
      { duration: 120, easing: "ease-out" },
    );
    return () => animation?.cancel();
  }, [present, reduced, route]);

  useEffect(() => {
    if (!present) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[data-slot="dialog-content"]')) return;
      if (route.view === "home") onClose();
      else back();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [back, onClose, present, route.view]);

  const renderHeader = (subtitle?: string) => (
    <header className="store-header">
      <div>
        <h1 className="store-title">{t("store.title")}</h1>
        <p className="store-subtitle">
          {subtitle ?? t("store.header.subtitle")}
        </p>
      </div>
      <div className="store-search">
        <Search aria-hidden />
        <Input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("store.search.placeholder")}
          aria-label={t("store.search.label")}
          className="store-search-input"
        />
      </div>
    </header>
  );

  const renderChips = () => (
    <div
      className="store-chips"
      role="group"
      aria-label={t("store.chips.label")}
    >
      {categories.map((value) => (
        <button
          key={value}
          type="button"
          className="store-chip"
          aria-pressed={category === value}
          onClick={() => setCategory(value)}
        >
          {value === ALL_CATEGORIES
            ? t("store.chips.all")
            : categoryLabel(value, t)}
        </button>
      ))}
    </div>
  );

  const renderGrid = (items: Manifest[], title?: string) => (
    <section className="store-section" aria-label={title}>
      {title && (
        <h2 className="store-section-title">
          {title}
          <span className="store-section-count">
            {tp("store.count.extension", items.length, {
              count: items.length,
            })}
          </span>
        </h2>
      )}
      <div className="store-grid">
        {items.map((manifest) => (
          <StoreCard
            key={manifest.id}
            manifest={manifest}
            onOpen={openDetail}
          />
        ))}
      </div>
    </section>
  );

  const renderHome = () => (
    <main className="store-main" ref={mainRef} tabIndex={-1}>
      <div className="store-content">
        {renderHeader()}
        {renderChips()}
        {trimmedQuery ? (
          filtered.length ? (
            renderGrid(filtered, t("store.results.title"))
          ) : (
            <Empty className="store-empty">
              <EmptyMedia variant="icon">
                <SearchX />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>{t("store.results.empty.title")}</EmptyTitle>
                <EmptyDescription>
                  {t("store.results.empty.description", {
                    query: query.trim(),
                  })}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    setCategory(ALL_CATEGORIES);
                  }}
                >
                  {t("store.results.empty.action")}
                </Button>
              </EmptyContent>
            </Empty>
          )
        ) : category !== ALL_CATEGORIES ? (
          renderGrid(filtered, categoryLabel(category, t))
        ) : (
          <>
            {featured && (
              <FeaturedHero manifest={featured} onOpen={openDetail} />
            )}
            {shelves.map(({ tier, items }) => (
              <Shelf
                key={tier}
                title={t(TIER_SECTION_KEY[tier])}
                entries={items}
                onOpen={openDetail}
              />
            ))}
            {(communityCatalog.length > 0 || communityRemote.length > 0) && (
              <section className="store-section">
                <h2 className="store-section-title">
                  {t("store.section.community")}
                </h2>
                <div className="store-grid">
                  {communityCatalog.map((manifest) => (
                    <StoreCard
                      key={manifest.id}
                      manifest={manifest}
                      onOpen={openDetail}
                    />
                  ))}
                  {communityRemote.map((remote) => (
                    <RemoteCard
                      key={`${remote.source.url}:${remote.extension.id}`}
                      remote={remote}
                      onOpen={() =>
                        openDetail(remote.extension.id, remote.source.url)
                      }
                    />
                  ))}
                </div>
              </section>
            )}
            {!catalog.length && (
              <Empty className="store-empty">
                <EmptyMedia variant="icon">
                  <Blocks />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>{t("store.catalog.empty.title")}</EmptyTitle>
                  <EmptyDescription>
                    {t("store.catalog.empty.description")}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </>
        )}
      </div>
    </main>
  );

  const renderDetail = () => {
    if (route.view !== "detail") return null;
    const local = byId.get(route.id);
    const remote =
      !local && route.source
        ? runtime.marketplace.entries.find(
            (entry) =>
              entry.source.url === route.source &&
              entry.extension.id === route.id,
          )
        : undefined;
    if (!local && !remote) {
      return (
        <main className="store-main" ref={mainRef} tabIndex={-1}>
          <div className="store-content">
            <button type="button" className="store-back" onClick={back}>
              <ChevronLeft /> {originLabel}
            </button>
            <Empty className="store-empty">
              <EmptyMedia variant="icon">
                <PackageCheck />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>{t("store.detail.notFound.title")}</EmptyTitle>
                <EmptyDescription>
                  {t("store.detail.notFound.description")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        </main>
      );
    }

    const manifest: Manifest = local ?? {
      id: remote!.extension.id,
      name: remote!.extension.name,
      version: remote!.version.version,
      subtitle: remote!.extension.subtitle,
      summary: remote!.extension.summary,
      description: remote!.extension.description,
      category: remote!.extension.category,
      tier: "community",
      tileTypes: [],
      screenshots: [],
    };
    const active = activeIds.has(manifest.id);
    const isInstalled = installed.has(manifest.id);
    const bundled = tierOf(manifest) !== "community";
    const pendingEnabled = pending.get(manifest.id);
    const busy = pendingEnabled !== undefined;
    const initiallyActive = busy ? !pendingEnabled : active;
    const pinned = selected.has(manifest.id);
    const certified = isCertified(manifest);
    const name = text(manifest.name);
    const subtitle = text(manifest.subtitle);
    const tier = t(TIER_LABEL_KEY[tierOf(manifest)]);
    const categoryName = manifest.category
      ? categoryLabel(manifest.category, t)
      : remote
        ? t("store.detail.remoteCategory")
        : tier;
    const publisher = remote
      ? (remote.extension.publisher ?? remote.source.name)
      : "Spark";
    const description =
      text(manifest.description) ||
      text(manifest.summary) ||
      t("store.detail.noDescription");
    const command = runtime.registry
      .getCommands()
      .find(
        (candidate) => candidate.tileType && candidate.owner.id === manifest.id,
      );
    const style = {
      "--ext-color": extensionColor(manifest),
    } as CSSProperties;

    return (
      <main className="store-main" ref={mainRef} tabIndex={-1}>
        <div className="store-content">
          <button type="button" className="store-back" onClick={back}>
            <ChevronLeft /> {originLabel}
          </button>
          <header className="store-detail-head" style={style}>
            <span className="store-detail-icon">
              <Icon
                glyph={manifest.icon}
                extension={manifest}
                size={48}
                strokeWidth={1.5}
              />
            </span>
            <div className="store-detail-heading">
              <h1 className="store-detail-title">
                {name}
                {certified && <CertifiedBadge size={17} />}
              </h1>
              <p className="store-detail-subtitle">{subtitle || tier}</p>
              <p className="store-detail-meta">
                {t("store.detail.meta", {
                  publisher,
                  version: manifest.version,
                  category: categoryName,
                })}
              </p>
            </div>
            <div className="store-detail-actions">
              {(remote || !initiallyActive || command) && (
                <StoreAction
                  busy={remoteBusy === manifest.id || pendingEnabled === true}
                  confirmed={confirmation?.id === manifest.id}
                  disabled={
                    (!!remote && !!remoteBusy && remoteBusy !== manifest.id) ||
                    pendingEnabled === false
                  }
                  onClick={() => {
                    if (remote) void installRemote(remote);
                    else if (active) openExtension(manifest.id);
                    else void setEnabled(manifest.id, true);
                  }}
                >
                  {remoteBusy === manifest.id
                    ? t("store.detail.installing")
                    : remote
                      ? t("store.detail.install")
                      : initiallyActive
                        ? t("store.detail.open")
                        : busy
                          ? t("store.detail.enabling")
                          : isInstalled || bundled
                            ? t("store.detail.enable")
                            : t("store.detail.install")}
                </StoreAction>
              )}
              {!remote && initiallyActive && (
                <StoreAction
                  variant="outline"
                  busy={pendingEnabled === false}
                  onClick={() => void setEnabled(manifest.id, false)}
                >
                  {pendingEnabled === false
                    ? t("store.detail.disabling")
                    : t("store.detail.disable")}
                </StoreAction>
              )}
              {!remote && active && command && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-pressed={pinned}
                  aria-label={t(
                    pinned ? "store.row.unpinAria" : "store.row.pinAria",
                    { name },
                  )}
                  title={t(pinned ? "store.row.unpin" : "store.row.pin")}
                  onClick={() => togglePin(manifest.id)}
                >
                  <Pin fill={pinned ? "currentColor" : "none"} />
                </Button>
              )}
              {!remote && manifest.tier === "community" && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("store.detail.uninstallAria", { name })}
                  title={t("store.detail.uninstall")}
                  onClick={() => setRemoveTarget(manifest)}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          </header>
          <ScreenshotGallery manifest={manifest} />
          <div className="store-detail-body">
            <section className="store-detail-section">
              <h2>{t("store.detail.about")}</h2>
              <p>{description}</p>
            </section>
            <section className="store-detail-section">
              <h2>{t("store.detail.info")}</h2>
              <dl className="store-meta-list">
                <div className="store-meta-row">
                  <dt>{t("store.detail.publisher")}</dt>
                  <dd>
                    {remote
                      ? publisher
                      : certified
                        ? "Spark"
                        : t("store.detail.thirdParty")}
                  </dd>
                </div>
                {remote && (
                  <div className="store-meta-row">
                    <dt>{t("store.detail.repository")}</dt>
                    <dd title={remote.source.url}>{remote.source.name}</dd>
                  </div>
                )}
                <div className="store-meta-row">
                  <dt>{t("store.detail.version")}</dt>
                  <dd>{manifest.version}</dd>
                </div>
                <div className="store-meta-row">
                  <dt>{t("store.detail.category")}</dt>
                  <dd>{categoryName}</dd>
                </div>
                <div className="store-meta-row">
                  <dt>{t("store.detail.type")}</dt>
                  <dd>{tier}</dd>
                </div>
                <div className="store-meta-row">
                  <dt>{t("store.detail.state")}</dt>
                  <dd>
                    {t(STATE_KEY[stateOf(manifest, active, isInstalled)])}
                  </dd>
                </div>
                <div className="store-meta-row">
                  <dt>{t("store.detail.id")}</dt>
                  <dd className="store-mono">{manifest.id}</dd>
                </div>
                {manifest.tileTypes?.length ? (
                  <div className="store-meta-row">
                    <dt>{t("store.detail.tiles")}</dt>
                    <dd className="store-mono">
                      {manifest.tileTypes.join(", ")}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>
          </div>
        </div>
      </main>
    );
  };

  const renderInstalled = () => (
    <main className="store-main" ref={mainRef} tabIndex={-1}>
      <div className="store-content">
        <header className="store-header">
          <div>
            <h1 className="store-title">{t("store.installed.title")}</h1>
            <p className="store-subtitle">
              {tp("store.count.installed", installedCount, {
                count: installedCount,
              })}
            </p>
          </div>
        </header>
        {installedItems.length ? (
          <div className="store-list">
            {installedItems.map((manifest) => (
              <StoreRow
                key={manifest.id}
                manifest={manifest}
                active={activeIds.has(manifest.id)}
                pinned={selected.has(manifest.id)}
                pendingEnabled={pending.get(manifest.id)}
                onOpen={() => openDetail(manifest.id)}
                onToggle={() =>
                  void setEnabled(manifest.id, !activeIds.has(manifest.id))
                }
                onPin={() => togglePin(manifest.id)}
              />
            ))}
          </div>
        ) : (
          <Empty className="store-empty">
            <EmptyMedia variant="icon">
              <PackageCheck />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>{t("store.installed.empty.title")}</EmptyTitle>
              <EmptyDescription>
                {t("store.installed.empty.description")}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                variant="outline"
                onClick={() => setRoute({ view: "home" })}
              >
                {t("store.nav.discover")}
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </div>
    </main>
  );

  const renderUpdates = () => (
    <main className="store-main" ref={mainRef} tabIndex={-1}>
      <div className="store-content">
        <header className="store-header">
          <div>
            <h1 className="store-title">{t("store.updates.title")}</h1>
            <p className="store-subtitle">
              {updates.length
                ? tp("store.count.toUpdate", updates.length, {
                    count: updates.length,
                  })
                : t("store.updates.hint")}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refreshMarket()}
          >
            <RefreshCw data-icon="inline-start" /> {t("store.updates.check")}
          </Button>
        </header>
        {updates.length ? (
          <div className="store-list">
            {updates.map((remote) => {
              const local = catalog.find(
                (manifest) => manifest.id === remote.extension.id,
              );
              const busy = remoteBusy === remote.extension.id;
              return (
                <div
                  className="store-row"
                  key={`${remote.source.url}:${remote.extension.id}`}
                >
                  <span className="store-row-icon">
                    <RefreshCw />
                  </span>
                  <span className="store-row-info">
                    <span className="store-row-open">
                      {remote.extension.name}
                    </span>
                    <span className="store-row-meta">
                      {local?.version ?? "?"} → {remote.version.version} ·{" "}
                      {remote.source.name}
                    </span>
                  </span>
                  <StoreAction
                    size="sm"
                    variant="outline"
                    busy={busy}
                    disabled={!!remoteBusy && !busy}
                    onClick={() => void installRemote(remote)}
                  >
                    {busy
                      ? t("store.updates.updating")
                      : t("store.updates.update")}
                  </StoreAction>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty className="store-empty">
            <EmptyMedia variant="icon">
              <CheckCircle2 />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>{t("store.updates.empty.title")}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </main>
  );

  const renderSources = () => (
    <main className="store-main" ref={mainRef} tabIndex={-1}>
      <div className="store-content">
        <header className="store-header">
          <div>
            <h1 className="store-title">{t("store.sources.title")}</h1>
          </div>
        </header>
        <div className="store-source-card">
          <span className="store-source-icon">
            <Blocks />
          </span>
          <span className="store-source-info">
            <span className="store-source-name">
              {t("store.sources.catalog")}
            </span>
            <span className="store-source-meta">
              {t("store.sources.builtin")} ·{" "}
              {tp("store.count.extension", catalog.length, {
                count: catalog.length,
              })}
            </span>
          </span>
          <span className="store-source-badge">
            {t("store.sources.official")}
          </span>
        </div>
        {dev && (
          <form className="store-install" onSubmit={installExtension}>
            <div className="store-install-text">
              <span className="store-install-title">
                {t("store.sources.import.title")}
              </span>
              <span className="store-install-hint">
                {t("store.sources.import.hint")}
              </span>
            </div>
            <Input
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder={t("store.sources.import.placeholder")}
              aria-label={t("store.sources.import.label")}
              className="store-install-input"
            />
            <Button
              type="button"
              variant="ghost"
              onClick={() => void browseSource()}
              disabled={picking || installing}
            >
              <FolderSearch data-icon="inline-start" />
              {picking
                ? t("store.sources.import.browsing")
                : t("store.sources.import.browse")}
            </Button>
            <StoreAction
              type="submit"
              variant="outline"
              busy={installing}
              confirmed={confirmation?.local}
              disabled={!installing && !source.trim()}
            >
              {installing
                ? t("store.detail.installing")
                : t("store.detail.install")}
            </StoreAction>
          </form>
        )}
        <section className="store-sources">
          <div className="store-section-head">
            <h2 className="store-section-title">
              {t("store.sources.repositories")}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refreshMarket()}
            >
              <RefreshCw data-icon="inline-start" /> {t("store.updates.check")}
            </Button>
          </div>
          <form className="store-source-add" onSubmit={addRepository}>
            <Input
              value={sourceName}
              onChange={(event) => setSourceName(event.target.value)}
              placeholder={t("store.sources.add.namePlaceholder")}
              aria-label={t("store.sources.add.nameLabel")}
            />
            <Input
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder={t("store.sources.add.urlPlaceholder")}
              aria-label={t("store.sources.add.urlLabel")}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={addingSource || !sourceUrl.trim()}
            >
              {addingSource
                ? t("store.sources.add.adding")
                : t("store.sources.add.submit")}
            </Button>
          </form>
          {runtime.marketplace.sourceList.length === 0 ? (
            <p className="store-source-empty">{t("store.sources.empty")}</p>
          ) : (
            <div className="store-source-list">
              {runtime.marketplace.sourceList.map((repository) => {
                const failure = runtime.marketplace.errorFor(repository.url);
                const count = remoteEntries.filter(
                  (remote) => remote.source.url === repository.url,
                ).length;
                return (
                  <div className="store-source-block" key={repository.url}>
                    <div className="store-source-card">
                      <button
                        type="button"
                        className="store-source-open"
                        aria-label={t("store.sources.open", {
                          name: repository.name,
                        })}
                        data-store-key={`repo:${repository.url}`}
                        onClick={() => openRepository(repository.url)}
                      >
                        <span className="store-source-icon">
                          <Library />
                        </span>
                        <span className="store-source-info">
                          <span className="store-source-name">
                            {repository.name}
                          </span>
                          <span className="store-source-meta">
                            {repository.url}
                          </span>
                        </span>
                        <span className="store-source-count">
                          {tp("store.count.repository", count, { count })}
                        </span>
                        <ChevronRight
                          className="store-source-chevron"
                          aria-hidden
                        />
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("store.sources.remove", {
                          name: repository.name,
                        })}
                        title={t("store.sources.removeTitle")}
                        onClick={() => void removeRepository(repository.url)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    {failure && <p className="store-source-error">{failure}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );

  const renderRepository = () => {
    if (route.view !== "repository") return null;
    const repository = runtime.marketplace.sourceList.find(
      (source) => source.url === route.url,
    );
    const failure = runtime.marketplace.errorFor(route.url);
    const entries = remoteEntries.filter(
      (remote) => remote.source.url === route.url,
    );
    return (
      <main className="store-main" ref={mainRef} tabIndex={-1}>
        <div className="store-content">
          <button type="button" className="store-back" onClick={back}>
            <ChevronLeft /> {t("store.nav.sources")}
          </button>
          <header className="store-header">
            <div>
              <h1 className="store-title">
                {repository?.name ?? t("store.sources.repositoryFallback")}
              </h1>
              <p className="store-subtitle">{route.url}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refreshMarket()}
            >
              <RefreshCw data-icon="inline-start" /> {t("store.updates.check")}
            </Button>
          </header>
          {failure && <p className="store-source-error">{failure}</p>}
          {entries.length ? (
            <div className="store-grid">
              {entries.map((remote) => (
                <RemoteCard
                  key={`${remote.source.url}:${remote.extension.id}`}
                  remote={remote}
                  onOpen={() =>
                    openDetail(remote.extension.id, remote.source.url)
                  }
                />
              ))}
            </div>
          ) : (
            !failure && (
              <Empty className="store-empty">
                <EmptyMedia variant="icon">
                  <Library />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>
                    {t("store.sources.repositoryEmpty.title")}
                  </EmptyTitle>
                  <EmptyDescription>
                    {t("store.sources.repositoryEmpty.description")}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )
          )}
        </div>
      </main>
    );
  };

  return (
    <motion.section
      className="spark-store"
      aria-label={t("store.a11y")}
      inert={!present || undefined}
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { duration: reduced ? 0 : 0.16, ease: "easeOut" },
      }}
      exit={{
        opacity: 0,
        transition: { duration: reduced ? 0 : 0.12, ease: "easeIn" },
      }}
    >
      <aside className="store-sidebar">
        <div className="store-brand">
          <Blocks />
          <span className="store-brand-label">{t("store.brand")}</span>
        </div>
        <nav className="store-nav" aria-label={t("store.nav.sections")}>
          <SidebarItem
            icon={<Compass />}
            label={t("store.nav.discover")}
            active={origin === "home"}
            onClick={() => setRoute({ view: "home" })}
          />
          <SidebarItem
            icon={<RefreshCw />}
            label={t("store.nav.updates")}
            active={origin === "updates"}
            onClick={() => setRoute({ view: "updates" })}
          />
          <SidebarItem
            icon={<PackageCheck />}
            label={t("store.nav.installed")}
            count={installedCount}
            active={origin === "installed"}
            onClick={() => setRoute({ view: "installed" })}
          />
          <SidebarItem
            icon={<Library />}
            label={t("store.nav.sources")}
            active={origin === "sources"}
            onClick={() => setRoute({ view: "sources" })}
          />
        </nav>
        <div className="store-sidebar-foot">
          <button
            type="button"
            className="store-nav-item"
            aria-label={t("store.nav.back")}
            title={t("store.nav.back")}
            onClick={() => onClose()}
          >
            <ArrowLeft />
            <span className="store-nav-label">{t("store.nav.back")}</span>
          </button>
        </div>
      </aside>
      {route.view === "home" && renderHome()}
      {route.view === "detail" && renderDetail()}
      {route.view === "installed" && renderInstalled()}
      {route.view === "updates" && renderUpdates()}
      {route.view === "sources" && renderSources()}
      {route.view === "repository" && renderRepository()}
      <Dialog
        open={present && !!removeTarget}
        onOpenChange={(open) => {
          if (!open && !removing) setRemoveTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("store.uninstall.title", {
                name: removeTarget
                  ? text(removeTarget.name)
                  : t("store.uninstall.this"),
              })}
            </DialogTitle>
            <DialogDescription>
              {t("store.uninstall.description")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={removing}
              onClick={() => setRemoveTarget(null)}
            >
              {t("store.uninstall.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={removing}
              onClick={() => void uninstallExtension()}
            >
              {removing
                ? t("store.uninstall.running")
                : t("store.uninstall.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.section>
  );
}
