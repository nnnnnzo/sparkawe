import { AppWindow } from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "../shared/utils.ts";
import type { IconComponent, Manifest } from "../sdk/index.ts";

export function Icon({
  glyph: Glyph = AppWindow,
  extension,
  size = 16,
  strokeWidth = 1.7,
  tone = "ink",
  className,
}: {
  glyph?: IconComponent;
  extension?: Manifest;
  size?: number;
  strokeWidth?: number;
  /** `ink` garde le contraste en thème clair ; `color` sert aux filigranes. */
  tone?: "ink" | "color";
  className?: string;
}) {
  const style = extension?.color
    ? ({
        "--extension-color": extension.color,
        "--extension-ink": `color-mix(in srgb, ${extension.color} 56%, #151719)`,
      } as CSSProperties)
    : undefined;
  return (
    <Glyph
      aria-hidden
      size={size}
      strokeWidth={strokeWidth}
      className={cn(
        style && (tone === "color" ? "extension-color" : "extension-icon"),
        className,
      )}
      style={style}
    />
  );
}
