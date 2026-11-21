import { AppWindow } from "lucide-react";
import type { CSSProperties } from "react";
import type { IconComponent, Manifest } from "../sdk/index.ts";

export function Icon({
  glyph: Glyph = AppWindow,
  extension,
}: {
  glyph?: IconComponent;
  extension?: Manifest;
}) {
  const style = extension?.color
    ? ({
        "--extension-color": extension.color,
        "--extension-ink": `color-mix(in srgb, ${extension.color} 56%, #121621)`,
      } as CSSProperties)
    : undefined;
  return (
    <Glyph
      aria-hidden
      size={16}
      strokeWidth={1.7}
      className={style ? "extension-icon" : undefined}
      style={style}
    />
  );
}
