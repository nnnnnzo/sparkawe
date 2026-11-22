import { ChevronRight } from "lucide-react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n/react.ts";
import type { Manifest } from "../../sdk/index.ts";
import { SPECTRUM } from "../../shared/brand/index.tsx";
import { Icon } from "../icons.tsx";
import { CertifiedBadge } from "./certified-badge.tsx";
import { categoryLabel, isCertified } from "./data.ts";

export function StoreCard({
  manifest,
  onOpen,
  variant = "grid",
}: {
  manifest: Manifest;
  onOpen: (id: string) => void;
  variant?: "grid" | "shelf";
}) {
  const { t, text } = useI18n();
  const certified = isCertified(manifest);
  const name = text(manifest.name);
  const subtitle = text(manifest.subtitle);
  const category = categoryLabel(manifest.category, t);
  const label = subtitle ? t("store.list.item", { name, subtitle }) : name;
  return (
    <button
      type="button"
      className={`store-card store-card-${variant}`}
      style={
        {
          "--ext-color": manifest.color ?? SPECTRUM.blue,
        } as CSSProperties
      }
      aria-label={certified ? `${label}${t("store.certified.suffix")}` : label}
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
            {name}
            {certified && (
              <CertifiedBadge size={14} focusable={false} decorative />
            )}
          </span>
        </span>
        <span className="store-card-subtitle">
          {subtitle || category || t("store.card.fallback")}
        </span>
        <span className="store-card-foot">
          <ChevronRight className="store-card-chevron" aria-hidden />
        </span>
      </span>
    </button>
  );
}
