import { ChevronRight } from "lucide-react";
import type { CSSProperties } from "react";
import type { Manifest } from "../../sdk/index.ts";
import { SPECTRUM } from "../../shared/brand/index.tsx";
import { Icon } from "../icons.tsx";
import { CertifiedBadge } from "./certified-badge.tsx";
import { isCertified } from "./data.ts";

export function StoreCard({
  manifest,
  onOpen,
  variant = "grid",
}: {
  manifest: Manifest;
  onOpen: (id: string) => void;
  variant?: "grid" | "shelf";
}) {
  const certified = isCertified(manifest);
  return (
    <button
      type="button"
      className={`store-card store-card-${variant}`}
      style={
        {
          "--ext-color": manifest.color ?? SPECTRUM.blue,
        } as CSSProperties
      }
      aria-label={`${manifest.name}${manifest.subtitle ? `, ${manifest.subtitle}` : ""}${certified ? ", certifiée par Spark" : ""}`}
      onClick={() => onOpen(manifest.id)}
    >
      <span className="store-card-body">
        <span className="store-card-top">
          <span className="store-card-icon">
            <Icon
              glyph={manifest.icon}
              extension={manifest}
              size={26}
              strokeWidth={1.6}
            />
          </span>
          <span className="store-card-name">
            {manifest.name}
            {certified && (
              <CertifiedBadge size={14} focusable={false} decorative />
            )}
          </span>
        </span>
        <span className="store-card-subtitle">
          {manifest.subtitle ?? manifest.category ?? "Extension"}
        </span>
        <span className="store-card-foot">
          <ChevronRight className="store-card-chevron" aria-hidden />
        </span>
      </span>
    </button>
  );
}
