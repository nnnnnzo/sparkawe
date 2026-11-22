import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@spark/ui/components/tooltip";
import { useI18n } from "../../i18n/react.ts";

/**
 * Sceau de certification façon BadgeCheck : un trait plein, un check blanc.
 * Aucun libellé visible ; le texte vit dans le tooltip.
 */
function CertifiedMark({ size = 14 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
    >
      <path
        d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"
        fill="currentColor"
      />
      <path
        d="m9 12 2 2 4-4"
        fill="none"
        stroke="var(--certified-check, #fff)"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CertifiedBadge({
  size = 14,
  focusable = true,
  decorative = false,
}: {
  size?: number;
  /** Sur une carte déjà focusable, le badge ne doit pas créer un second arrêt. */
  focusable?: boolean;
  /** Pour un badge décoratif, le parent porte déjà l'information accessible. */
  decorative?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <span
          className="certified-badge"
          role={decorative ? undefined : "img"}
          aria-label={decorative ? undefined : t("store.certified.label")}
          aria-hidden={decorative || undefined}
          tabIndex={!decorative && focusable ? 0 : undefined}
        >
          <CertifiedMark size={size} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-56">
        <span className="font-medium">{t("store.certified.label")}</span>
        <span className="mt-0.5 block text-[11px] opacity-70">
          {t("store.certified.description")}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
