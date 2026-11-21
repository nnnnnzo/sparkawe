import {
  ArrowLeft,
  Blocks,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Compass,
  Library,
  PackageCheck,
  Pin,
  RefreshCw,
  Search,
  SearchX,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import type { Runtime } from "../../app/runtime.ts";
import type { Manifest } from "../../sdk/index.ts";
import { Button } from "@spark/ui/components/button";
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
import { report } from "../errors.ts";
import { Icon } from "../icons.tsx";
import { CertifiedBadge } from "./certified-badge.tsx";
import { StoreCard } from "./card.tsx";
import {
  FEATURED_IDS,
  TIER_LABEL,
  TIER_SECTION,
  isCertified,
  matchesQuery,
  stateLabel,
  storeOrder,
  tierOf,
  type StoreRoute,
} from "./data.ts";
import { FeaturedHero, Shelf } from "./featured.tsx";
import "./style.css";

const extensionColor = (manifest: Manifest) =>
  manifest.color ?? SPECTRUM.blue;

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
  busy,
  onOpen,
  onToggle,
  onPin,
}: {
  manifest: Manifest;
  active: boolean;
  pinned: boolean;
  busy: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onPin: () => void;
}) {
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
          aria-label={`${manifest.name}${manifest.subtitle ? `, ${manifest.subtitle}` : ""}${isCertified(manifest) ? ", certifiée par Spark" : ""}`}
          onClick={onOpen}
        >
          {manifest.name}
          {isCertified(manifest) && (
            <CertifiedBadge size={13} focusable={false} decorative />
          )}
        </button>
        <span className="store-row-meta">
          {manifest.subtitle ?? TIER_LABEL[tierOf(manifest)]} ·{" "}
          {manifest.version}
        </span>
      </span>
      <span className="store-row-state" data-active={active}>
        {active ? "Active" : "Inactive"}
      </span>
      {active && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-pressed={pinned}
          aria-label={`${pinned ? "Désépingler" : "Épingler"} ${manifest.name}`}
          title={pinned ? "Désépingler" : "Épingler"}
          onClick={onPin}
        >
          <Pin fill={pinned ? "currentColor" : "none"} />
        </Button>
      )}
      <Button variant="outline" size="sm" disabled={busy} onClick={onToggle}>
        {busy ? "…" : active ? "Désactiver" : "Activer"}
      </Button>
      <Button variant="ghost" size="sm" onClick={onOpen}>
        Détails
      </Button>
    </div>
  );
}

function ScreenshotGallery({ manifest }: { manifest: Manifest }) {
  const screenshots = manifest.screenshots ?? [];
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
        <span>{manifest.subtitle ?? manifest.name}</span>
      </div>
    );

  if (screenshots.length === 2)
    return (
      <section
        className="store-gallery"
        aria-label={`Aperçus de ${manifest.name}`}
      >
        <div className="store-gallery-head">
          <span className="store-gallery-label">Aperçus</span>
        </div>
        <div className="store-gallery-split">
          {screenshots.map((source, index) => (
            <figure className="store-gallery-item" key={source}>
              <img
                src={source}
                alt={`Aperçu ${index + 1} de ${manifest.name}`}
                loading={index === 0 ? "eager" : "lazy"}
                draggable={false}
              />
            </figure>
          ))}
        </div>
      </section>
    );

  return (
    <section className="store-gallery" aria-label={`Aperçus de ${manifest.name}`}>
      <div className="store-gallery-head">
        <span className="store-gallery-label">
          {screenshots.length > 1 ? "Aperçus" : "Aperçu"}
        </span>
        {screenshots.length > 2 && (
          <div className="store-gallery-arrows">
            <button
              type="button"
              aria-label="Aperçu précédent"
              disabled={atStart}
              onClick={() => move(-1)}
            >
              <ChevronLeft />
            </button>
            <button
              type="button"
              aria-label="Aperçu suivant"
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
              alt={`Aperçu ${index + 1} de ${manifest.name}`}
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
  const activeKey = useSyncExternalStore(
    runtime.registry.subscribeTools,
    () =>
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
  const [route, setRoute] = useState<StoreRoute>({ view: "home" });
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Tout");
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [source, setSource] = useState("");
  const [installing, setInstalling] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);

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
      "Tout",
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
            matchesQuery(manifest, trimmedQuery) &&
            (category === "Tout" || manifest.category === category),
        )
        .sort(storeOrder),
    [catalog, category, trimmedQuery],
  );
  const shelves = useMemo(
    () =>
      (["core", "official", "community"] as const)
        .map((tier) => ({
          tier,
          items: catalog
            .filter((manifest) => tierOf(manifest) === tier)
            .sort(storeOrder),
        }))
        .filter(({ items }) => items.length > 0),
    [catalog],
  );
  const installedItems = useMemo(
    () => catalog
        .filter((manifest) => installed.has(manifest.id))
        .sort(storeOrder),
    [catalog, installed],
  );
  const installedCount = installedItems.length;
  const featured = useMemo(
    () =>
      FEATURED_IDS.map((id) => byId.get(id)).find(
        (manifest): manifest is Manifest => !!manifest,
      ) ?? catalog[0],
    [byId, catalog],
  );

  const setEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      setPending((current) => new Set([...current, id]));
      try {
        await runtime.extensions.setEnabled(id, enabled);
      } catch (error) {
        report(error);
      } finally {
        setPending((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    },
    [runtime],
  );

  const installExtension = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const path = source.trim();
      if (!path || installing) return;
      setInstalling(true);
      try {
        const manifest = await runtime.extensions.install(path);
        setSource("");
        toast.success(`${manifest.name} installée`);
      } catch (error) {
        report(error);
      } finally {
        setInstalling(false);
      }
    },
    [installing, runtime, source],
  );

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

  const openDetail = useCallback((id: string) => {
    setRoute({ view: "detail", id });
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
    const target = route.view === "home" ? searchRef.current : mainRef.current;
    const frame = requestAnimationFrame(() => target?.focus());
    return () => cancelAnimationFrame(frame);
  }, [route]);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [route]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[data-slot="dialog-content"]')) return;
      if (route.view === "home") onClose();
      else setRoute({ view: "home" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, route.view]);

  const renderHeader = (subtitle?: string) => (
    <header className="store-header">
      <div>
        <h1 className="store-title">Extensions</h1>
        <p className="store-subtitle">
          {subtitle ?? "Découvrez et gérez les extensions de Spark."}
        </p>
      </div>
      <div className="store-search">
        <Search aria-hidden />
        <Input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher…"
          aria-label="Rechercher une extension"
          className="store-search-input"
        />
      </div>
    </header>
  );

  const renderChips = () => (
    <div className="store-chips" role="group" aria-label="Catégories">
      {categories.map((value) => (
        <button
          key={value}
          type="button"
          className="store-chip"
          aria-pressed={category === value}
          onClick={() => setCategory(value)}
        >
          {value}
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
            {items.length} {items.length > 1 ? "extensions" : "extension"}
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
            renderGrid(filtered, "Résultats")
          ) : (
            <Empty className="store-empty">
              <EmptyMedia variant="icon">
                <SearchX />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>Aucun résultat</EmptyTitle>
                <EmptyDescription>
                  Aucune extension ne correspond à « {query.trim()} ».
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    setCategory("Tout");
                  }}
                >
                  Tout afficher
                </Button>
              </EmptyContent>
            </Empty>
          )
        ) : category !== "Tout" ? (
          renderGrid(filtered, category)
        ) : (
          <>
            {featured && (
              <FeaturedHero manifest={featured} onOpen={openDetail} />
            )}
            {shelves.map(({ tier, items }) => (
              <Shelf
                key={tier}
                title={TIER_SECTION[tier]}
                entries={items}
                onOpen={openDetail}
              />
            ))}
            {!catalog.length && (
              <Empty className="store-empty">
                <EmptyMedia variant="icon">
                  <Blocks />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>Aucune extension</EmptyTitle>
                  <EmptyDescription>
                    Le catalogue livré avec Spark est vide.
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
    const manifest = byId.get(route.id);
    if (!manifest) {
      return (
        <main className="store-main" ref={mainRef} tabIndex={-1}>
          <div className="store-content">
            <button
              type="button"
              className="store-back"
              onClick={() => setRoute({ view: "home" })}
            >
              <ChevronLeft /> Extensions
            </button>
            <Empty className="store-empty">
              <EmptyMedia variant="icon">
                <PackageCheck />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>Extension introuvable</EmptyTitle>
                <EmptyDescription>
                  Cette extension ne fait plus partie du catalogue.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        </main>
      );
    }

    const active = activeIds.has(manifest.id);
    const isInstalled = installed.has(manifest.id);
    const bundled = tierOf(manifest) !== "community";
    const busy = pending.has(manifest.id);
    const pinned = selected.has(manifest.id);
    const certified = isCertified(manifest);
    const command = runtime.registry
      .getCommands()
      .find(
        (candidate) =>
          candidate.tileType && candidate.owner.id === manifest.id,
      );
    const style = {
      "--ext-color": extensionColor(manifest),
    } as CSSProperties;

    return (
      <main className="store-main" ref={mainRef} tabIndex={-1}>
        <div className="store-content">
          <button
            type="button"
            className="store-back"
            onClick={() => setRoute({ view: "home" })}
          >
            <ChevronLeft /> Extensions
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
                {manifest.name}
                {certified && <CertifiedBadge size={17} />}
              </h1>
              <p className="store-detail-subtitle">
                {manifest.subtitle ?? TIER_LABEL[tierOf(manifest)]}
              </p>
              <p className="store-detail-meta">
                Spark · {manifest.version} ·{" "}
                {manifest.category ?? TIER_LABEL[tierOf(manifest)]}
              </p>
            </div>
            <div className="store-detail-actions">
              {active && command && (
                <Button onClick={() => openExtension(manifest.id)}>
                  Ouvrir
                </Button>
              )}
              {!active && (
                <Button
                  disabled={busy}
                  onClick={() => void setEnabled(manifest.id, true)}
                >
                  {busy
                    ? "Activation…"
                    : isInstalled || bundled
                      ? "Activer"
                      : "Installer"}
                </Button>
              )}
              {active && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void setEnabled(manifest.id, false)}
                >
                  {busy ? "Désactivation…" : "Désactiver"}
                </Button>
              )}
              {active && command && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-pressed={pinned}
                  aria-label={`${pinned ? "Désépingler" : "Épingler"} ${manifest.name}`}
                  title={pinned ? "Désépingler" : "Épingler"}
                  onClick={() => togglePin(manifest.id)}
                >
                  <Pin fill={pinned ? "currentColor" : "none"} />
                </Button>
              )}
            </div>
          </header>
          <ScreenshotGallery manifest={manifest} />
          <div className="store-detail-body">
            <section className="store-detail-section">
              <h2>À propos</h2>
              <p>
                {manifest.description ??
                  manifest.summary ??
                  "Aucune description fournie."}
              </p>
            </section>
            <section className="store-detail-section">
              <h2>Informations</h2>
              <dl className="store-meta-list">
                <div className="store-meta-row">
                  <dt>Éditeur</dt>
                  <dd>{certified ? "Spark" : "Tiers"}</dd>
                </div>
                <div className="store-meta-row">
                  <dt>Version</dt>
                  <dd>{manifest.version}</dd>
                </div>
                <div className="store-meta-row">
                  <dt>Catégorie</dt>
                  <dd>{manifest.category ?? "—"}</dd>
                </div>
                <div className="store-meta-row">
                  <dt>Type</dt>
                  <dd>{TIER_LABEL[tierOf(manifest)]}</dd>
                </div>
                <div className="store-meta-row">
                  <dt>État</dt>
                  <dd>{stateLabel(manifest, active, isInstalled)}</dd>
                </div>
                <div className="store-meta-row">
                  <dt>Identifiant</dt>
                  <dd className="store-mono">{manifest.id}</dd>
                </div>
                {manifest.tileTypes?.length ? (
                  <div className="store-meta-row">
                    <dt>Tuiles</dt>
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
            <h1 className="store-title">Installées</h1>
            <p className="store-subtitle">
              {installedCount}{" "}
              {installedCount > 1
                ? "extensions installées"
                : "extension installée"}
              .
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
                busy={pending.has(manifest.id)}
                onOpen={() => openDetail(manifest.id)}
                onToggle={() =>
                  void setEnabled(
                    manifest.id,
                    !activeIds.has(manifest.id),
                  )
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
              <EmptyTitle>Aucune extension installée</EmptyTitle>
              <EmptyDescription>
                Activez une extension depuis Découvrir pour la retrouver ici.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                variant="outline"
                onClick={() => setRoute({ view: "home" })}
              >
                Découvrir
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
            <h1 className="store-title">Mises à jour</h1>
          </div>
        </header>
        <Empty className="store-empty">
          <EmptyMedia variant="icon">
            <CheckCircle2 />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>Aucune mise à jour</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </div>
    </main>
  );

  const renderSources = () => (
    <main className="store-main" ref={mainRef} tabIndex={-1}>
      <div className="store-content">
        <header className="store-header">
          <div>
            <h1 className="store-title">Sources</h1>
          </div>
        </header>
        <div className="store-source-card">
          <span className="store-source-icon">
            <Blocks />
          </span>
          <span className="store-source-info">
            <span className="store-source-name">Catalogue Spark</span>
            <span className="store-source-meta">
              Intégré à l’application · {catalog.length}{" "}
              {catalog.length > 1 ? "extensions" : "extension"}
            </span>
          </span>
          <span className="store-source-badge">Officiel</span>
        </div>
        {dev && (
          <form className="store-install" onSubmit={installExtension}>
            <div className="store-install-text">
              <span className="store-install-title">
                Importer une extension
              </span>
              <span className="store-install-hint">
                Dossier contenant extension.json, index.js et éventuellement
                style.css.
              </span>
            </div>
            <Input
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="/chemin/vers/extension"
              aria-label="Dossier de l’extension à importer"
              className="store-install-input"
            />
            <Button
              type="submit"
              variant="outline"
              disabled={installing || !source.trim()}
            >
              {installing ? "Installation…" : "Installer"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );

  return (
    <section className="spark-store" aria-label="Store des extensions">
      <aside className="store-sidebar">
        <div className="store-brand">
          <Blocks />
          <span className="store-brand-label">Store</span>
        </div>
        <nav className="store-nav" aria-label="Sections du Store">
          <SidebarItem
            icon={<Compass />}
            label="Découvrir"
            active={route.view === "home" || route.view === "detail"}
            onClick={() => setRoute({ view: "home" })}
          />
          <SidebarItem
            icon={<RefreshCw />}
            label="Mises à jour"
            active={route.view === "updates"}
            onClick={() => setRoute({ view: "updates" })}
          />
          <SidebarItem
            icon={<PackageCheck />}
            label="Installées"
            count={installedCount}
            active={route.view === "installed"}
            onClick={() => setRoute({ view: "installed" })}
          />
          <SidebarItem
            icon={<Library />}
            label="Sources"
            active={route.view === "sources"}
            onClick={() => setRoute({ view: "sources" })}
          />
        </nav>
        <div className="store-sidebar-foot">
          <button
            type="button"
            className="store-nav-item"
            aria-label="Retour à l’espace"
            title="Retour à l’espace"
            onClick={() => onClose()}
          >
            <ArrowLeft />
            <span className="store-nav-label">Retour à l’espace</span>
          </button>
        </div>
      </aside>
      {route.view === "home" && renderHome()}
      {route.view === "detail" && renderDetail()}
      {route.view === "installed" && renderInstalled()}
      {route.view === "updates" && renderUpdates()}
      {route.view === "sources" && renderSources()}
    </section>
  );
}
