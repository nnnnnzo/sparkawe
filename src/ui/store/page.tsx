import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Blocks,
  CheckCircle2,
  ChevronLeft,
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
  type ReactNode,
} from "react";
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
import {
  FEATURED_IDS,
  TIER_LABEL,
  TIER_SECTION,
  isCertified,
  matchesQuery,
  stateLabel,
  tierOf,
  type StoreRoute,
} from "./data.ts";
import { FeaturedShelf } from "./featured.tsx";
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

function StoreCard({
  manifest,
  active,
  installed,
  onOpen,
}: {
  manifest: Manifest;
  active: boolean;
  installed: boolean;
  onOpen: (id: string) => void;
}) {
  const certified = isCertified(manifest);
  const style = {
    "--ext-color": extensionColor(manifest),
  } as CSSProperties;
  return (
    <button
      type="button"
      className="store-card"
      style={style}
      aria-label={`${manifest.name}${certified ? ", certifiée par Spark" : ""}. ${stateLabel(manifest, active, installed)}.`}
      onClick={() => onOpen(manifest.id)}
    >
      <span className="store-card-top">
        <span className="store-icon">
          <Icon
            glyph={manifest.icon}
            extension={manifest}
            size={30}
            strokeWidth={1.6}
          />
        </span>
        <span className="store-card-heading">
          <span className="store-card-name">
            {manifest.name}
            {certified && (
              <CertifiedBadge size={14} focusable={false} decorative />
            )}
          </span>
          <span className="store-card-publisher">
            Spark · {manifest.version}
          </span>
        </span>
      </span>
      <span className="store-card-summary">
        {manifest.summary ?? "Aucune description fournie."}
      </span>
      <span className="store-card-foot">
        <span>{manifest.category ?? "Extension"}</span>
        <span className="store-card-state">
          {stateLabel(manifest, active, installed)}
        </span>
        <span className="store-card-more">
          Découvrir <ArrowRight />
        </span>
      </span>
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
          aria-label={`${manifest.name}${isCertified(manifest) ? ", certifiée par Spark" : ""}`}
          onClick={onOpen}
        >
          {manifest.name}
          {isCertified(manifest) && (
            <CertifiedBadge size={13} focusable={false} decorative />
          )}
        </button>
        <span className="store-row-meta">
          {TIER_LABEL[tierOf(manifest)]} · {manifest.version}
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

export function StorePage({
  runtime,
  onClose,
}: {
  runtime: Runtime;
  onClose: (restoreFocus?: boolean) => void;
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
  const [route, setRoute] = useState<StoreRoute>({ view: "home" });
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  const catalog = runtime.extensions.catalog;
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
  const featured = useMemo(
    () =>
      FEATURED_IDS.map((id) => byId.get(id)).filter(
        (manifest): manifest is Manifest => !!manifest,
      ),
    [byId],
  );
  const trimmedQuery = query.trim();
  const filtered = useMemo(
    () =>
      catalog
        .filter((manifest) => matchesQuery(manifest, trimmedQuery))
        .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    [catalog, trimmedQuery],
  );
  const sections = useMemo(
    () =>
      (["core", "official", "community"] as const)
        .map((tier) => ({
          tier,
          items: catalog.filter((manifest) => tierOf(manifest) === tier),
        }))
        .filter(({ items }) => items.length > 0),
    [catalog],
  );
  const installedItems = useMemo(
    () => catalog.filter((manifest) => installed.has(manifest.id)),
    [catalog, installed],
  );
  const installedCount = installedItems.length;

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

  const isView = (view: StoreRoute["view"]) =>
    route.view === view || (view === "home" && route.view === "detail");

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

  const renderHome = () => (
    <main className="store-main" ref={mainRef} tabIndex={-1}>
      <div className="store-content">
        {renderHeader()}
        {trimmedQuery ? (
          <>
            <h2 className="store-section-title">
              Résultats
              <span className="store-section-count">
                {filtered.length}{" "}
                {filtered.length > 1 ? "extensions" : "extension"}
              </span>
            </h2>
            {filtered.length ? (
              <div className="store-grid">
                {filtered.map((manifest) => (
                  <StoreCard
                    key={manifest.id}
                    manifest={manifest}
                    active={activeIds.has(manifest.id)}
                    installed={installed.has(manifest.id)}
                    onOpen={openDetail}
                  />
                ))}
              </div>
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
                  <Button variant="outline" onClick={() => setQuery("")}>
                    Tout afficher
                  </Button>
                </EmptyContent>
              </Empty>
            )}
          </>
        ) : (
          <>
            {featured.length > 1 && (
              <FeaturedShelf entries={featured} onOpen={openDetail} />
            )}
            {sections.map(({ tier, items }) => (
              <section className="store-section" key={tier}>
                <h2 className="store-section-title">{TIER_SECTION[tier]}</h2>
                <div className="store-grid">
                  {items.map((manifest) => (
                    <StoreCard
                      key={manifest.id}
                      manifest={manifest}
                      active={activeIds.has(manifest.id)}
                      installed={installed.has(manifest.id)}
                      onOpen={openDetail}
                    />
                  ))}
                </div>
              </section>
            ))}
            {catalog.length === 0 && (
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
                size={52}
                strokeWidth={1.5}
              />
            </span>
            <div className="store-detail-heading">
              <h1 className="store-detail-title">
                {manifest.name}
                {certified && <CertifiedBadge size={17} />}
              </h1>
              <p className="store-detail-meta">
                Spark · {manifest.version} ·{" "}
                {manifest.category ?? TIER_LABEL[tierOf(manifest)]}
              </p>
            </div>
            <div className="store-detail-actions">
              {active && command && (
                <Button onClick={() => openExtension(manifest.id)}>
                  Ouvrir <ArrowUpRight data-icon="inline-end" />
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
          <div className="store-detail-preview" style={style}>
            <span className="store-preview-glyph" aria-hidden>
              <Icon
                glyph={manifest.icon}
                extension={manifest}
                size={190}
                strokeWidth={1}
                tone="color"
              />
            </span>
            <span className="store-preview-kicker">
              {TIER_LABEL[tierOf(manifest)]}
            </span>
            <span className="store-preview-name">{manifest.name}</span>
            <span className="store-preview-tagline">
              {manifest.tagline ?? manifest.summary}
            </span>
          </div>
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
              . Les extensions désactivées gardent leurs tuiles.
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
              <Button variant="outline" onClick={() => setRoute({ view: "home" })}>
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
            <p className="store-subtitle">
              Les nouvelles versions apparaîtront ici, sans interrompre votre
              travail.
            </p>
          </div>
        </header>
        <Empty className="store-empty">
          <EmptyMedia variant="icon">
            <CheckCircle2 />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>Vous êtes à jour</EmptyTitle>
            <EmptyDescription>
              Le Store lit pour l’instant le catalogue livré avec Spark. Les
              dépôts distants seront branchés ensuite.
            </EmptyDescription>
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
            <p className="store-subtitle">
              D’où viennent les extensions proposées dans le Store.
            </p>
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
        <p className="store-note">
          Les dépôts distants, la signature des paquets et les mises à jour
          seront branchés à l’étape suivante. Le Store lit pour l’instant le
          catalogue livré avec Spark.
        </p>
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
            active={isView("home")}
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
