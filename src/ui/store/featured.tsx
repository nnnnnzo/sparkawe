import {
  ArrowRight,
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
import { isCertified, TIER_LABEL, tierOf } from "./data.ts";

function FeaturedCard({
  manifest,
  onOpen,
}: {
  manifest: Manifest;
  onOpen: (id: string) => void;
}) {
  const style = {
    "--ext-color": manifest.color ?? SPECTRUM.blue,
  } as CSSProperties;
  const certified = isCertified(manifest);
  return (
    <button
      type="button"
      className="store-shelf-card"
      style={style}
      aria-label={`Découvrir ${manifest.name}${certified ? ", certifiée par Spark" : ""}`}
      onClick={() => onOpen(manifest.id)}
    >
      <span className="store-shelf-ghost" aria-hidden>
        <Icon
          glyph={manifest.icon}
          extension={manifest}
          size={148}
          strokeWidth={1.1}
          tone="color"
        />
      </span>
      <span className="store-shelf-kicker">{TIER_LABEL[tierOf(manifest)]}</span>
      <span className="store-shelf-name">
        {manifest.name}
        {certified && (
          <CertifiedBadge size={14} focusable={false} decorative />
        )}
      </span>
      <span className="store-shelf-tagline">
        {manifest.tagline ?? manifest.summary}
      </span>
      <span className="store-shelf-foot">
        <span>{manifest.category ?? "Extension"}</span>
        <span className="store-shelf-more">
          Découvrir <ArrowRight />
        </span>
      </span>
    </button>
  );
}

export function FeaturedShelf({
  entries,
  onOpen,
}: {
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
      left: direction * Math.max(304, element.clientWidth * 0.8),
      behavior: reduced ? "auto" : "smooth",
    });
  };

  return (
    <section className="store-shelf-section" aria-labelledby="store-featured">
      <header className="store-section-head">
        <h2 id="store-featured" className="store-section-title">
          À la une
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
        className="store-shelf-wrap"
        data-at-start={atStart}
        data-at-end={atEnd}
      >
        <div
          ref={ref}
          className="store-shelf"
          role="region"
          aria-roledescription="carrousel"
          aria-label="À la une"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
              return;
            event.preventDefault();
            move(event.key === "ArrowLeft" ? -1 : 1);
          }}
        >
          {entries.map((manifest) => (
            <FeaturedCard
              key={manifest.id}
              manifest={manifest}
              onOpen={onOpen}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
