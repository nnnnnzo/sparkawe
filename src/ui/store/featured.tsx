import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { Manifest } from "../../sdk/index.ts";
import { SPECTRUM } from "../../shared/brand/index.tsx";
import { Icon } from "../icons.tsx";
import { CertifiedBadge } from "./certified-badge.tsx";
import { StoreCard } from "./card.tsx";
import { isCertified, TIER_LABEL, tierOf } from "./data.ts";

export function FeaturedHero({
  manifest,
  onOpen,
}: {
  manifest: Manifest;
  onOpen: (id: string) => void;
}) {
  const certified = isCertified(manifest);
  return (
    <button
      type="button"
      className="store-hero"
      style={
        {
          "--ext-color": manifest.color ?? SPECTRUM.blue,
        } as CSSProperties
      }
      aria-label={`Voir ${manifest.name}${certified ? ", certifiée par Spark" : ""}`}
      onClick={() => onOpen(manifest.id)}
    >
      <span className="store-hero-copy">
        <span className="store-hero-kicker">À la une</span>
        <span className="store-hero-title">
          {manifest.name}
          {certified && <CertifiedBadge size={16} focusable={false} decorative />}
        </span>
        <span className="store-hero-subtitle">
          {manifest.subtitle ?? manifest.category ?? TIER_LABEL[tierOf(manifest)]}
        </span>
        <span className="store-hero-summary">
          {manifest.summary ?? "Aucune description fournie."}
        </span>
        <span className="store-hero-foot">
          <span>{manifest.category ?? TIER_LABEL[tierOf(manifest)]}</span>
          <span className="store-hero-arrow">
            <ArrowUpRight aria-hidden />
          </span>
        </span>
      </span>
      <span className="store-hero-media">
        {manifest.screenshots?.[0] ? (
          <img
            src={manifest.screenshots[0]}
            alt=""
            loading="eager"
            draggable={false}
          />
        ) : (
          <span className="store-hero-fallback" aria-hidden>
            <Icon
              glyph={manifest.icon}
              extension={manifest}
              size={72}
              strokeWidth={1.3}
            />
          </span>
        )}
      </span>
    </button>
  );
}

export function Shelf({
  title,
  entries,
  onOpen,
}: {
  title: string;
  entries: Manifest[];
  onOpen: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(entries.length <= 1);

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
  }, [entries.length]);

  const move = (direction: -1 | 1) => {
    const element = ref.current;
    if (!element) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    element.scrollBy({
      left: direction * Math.max(312, element.clientWidth * 0.8),
      behavior: reduced ? "auto" : "smooth",
    });
  };

  return (
    <section className="store-shelf-section" aria-labelledby={`shelf-${title}`}>
      <header className="store-section-head">
        <h2 id={`shelf-${title}`} className="store-section-title">
          {title}
        </h2>
        {entries.length > 1 && (
          <div className="store-shelf-arrows">
            <button
              type="button"
              aria-label="Précédent"
              disabled={atStart}
              onClick={() => move(-1)}
            >
              <ChevronLeft />
            </button>
            <button
              type="button"
              aria-label="Suivant"
              disabled={atEnd}
              onClick={() => move(1)}
            >
              <ChevronRight />
            </button>
          </div>
        )}
      </header>
      <div
        ref={ref}
        className="store-shelf"
        role="region"
        aria-roledescription="carrousel"
        aria-label={title}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          move(event.key === "ArrowLeft" ? -1 : 1);
        }}
      >
        {entries.map((manifest) => (
          <StoreCard
            key={manifest.id}
            manifest={manifest}
            onOpen={onOpen}
            variant="shelf"
          />
        ))}
      </div>
    </section>
  );
}
