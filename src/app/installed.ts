import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { IconComponent, Manifest, SparkExtension } from "../sdk/index.ts";
import type { ExtensionModule } from "../sdk/react.ts";
import type { TileViews } from "../ui/contracts.ts";

/** Manifeste sérialisable d’une extension importée. */
export interface InstalledManifest {
  schema: 2;
  id: string;
  name: string;
  version: string;
  subtitle?: string;
  summary?: string;
  description?: string;
  category?: string;
  /** Icône SVG du paquet, en masque teinté par `currentColor`. */
  icon?: string;
  /** Teinte de l’extension, `#rrggbb` ou `#rgb`. */
  color?: string;
  entry: string;
  style?: string;
  screenshots?: string[];
  tileTypes: string[];
}

export interface InstalledRecord {
  manifest: InstalledManifest;
  path: string;
  source?: string;
}

export interface SparkRuntime {
  React: typeof React;
  jsxRuntime: typeof jsxRuntime;
}

declare global {
  interface Window {
    SparkRuntime?: SparkRuntime;
    SparkExtensions?: Record<
      string,
      (runtime: SparkRuntime) => ExtensionModule
    >;
  }
}

const sparkRuntime: SparkRuntime = { React, jsxRuntime };
window.SparkRuntime = sparkRuntime;

/** Même contrat que `Icon` dans l’hôte : taille, classes et styles. */
type IconProps = React.SVGProps<SVGSVGElement> & { size?: number };

const icons = new Map<string, IconComponent>();

/**
 * Une icône de paquet est un masque CSS, jamais du markup interprété :
 * le SVG sert d’alpha et la teinte vient de `currentColor`, comme pour les
 * glyphes intégrés. Conséquence pour l’auteur : dessiner l’icône avec le bon
 * trait (viewBox 24, épaisseur 1.7), Spark ne peut pas le réappliquer.
 */
export function maskedIcon(url: string): IconComponent {
  const cached = icons.get(url);
  if (cached) return cached;
  const MaskedIcon = ({ size = 16, className, style, ...rest }: IconProps) => {
    const html = { ...rest } as Record<string, unknown>;
    // Une icône en masque ne se retrace pas : la largeur de trait est cuite.
    delete html.strokeWidth;
    const frame: React.CSSProperties = {
      display: "inline-block",
      flexShrink: 0,
      width: `${size}px`,
      height: `${size}px`,
      backgroundColor: "currentColor",
      maskImage: `url("${url}")`,
      WebkitMaskImage: `url("${url}")`,
      maskSize: "contain",
      maskRepeat: "no-repeat",
      maskPosition: "center",
      ...style,
    };
    return React.createElement("span", {
      ...(html as React.HTMLAttributes<HTMLSpanElement>),
      className,
      style: frame,
    });
  };
  icons.set(url, MaskedIcon);
  return MaskedIcon;
}

export function installedManifest(record: InstalledRecord): Manifest {
  const { manifest } = record;
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    subtitle: manifest.subtitle,
    summary: manifest.summary,
    description: manifest.description,
    category: manifest.category,
    icon: manifest.icon
      ? maskedIcon(convertFileSrc(`${record.path}/${manifest.icon}`))
      : undefined,
    color: manifest.color,
    tileTypes: manifest.tileTypes,
    tier: "community",
    screenshots: (manifest.screenshots ?? []).map((file) =>
      convertFileSrc(`${record.path}/${file}`),
    ),
  };
}

/**
 * Charge le bundle d’une extension importée. Le paquet est un script classique
 * qui s’enregistre dans `window.SparkExtensions` et reçoit React par l’hôte.
 */
export async function loadInstalledExtension(
  record: InstalledRecord,
  views: TileViews,
): Promise<SparkExtension> {
  const manifest = installedManifest(record);
  // Chaque activation repart du disque : la version servie change d’URL, donc
  // réinstaller un paquet met à jour le script et les styles sans redémarrer.
  const stamp = Date.now();
  for (const link of document.head.querySelectorAll(
    `link[data-spark-extension="${manifest.id}"]`,
  ))
    link.remove();
  for (const node of document.head.querySelectorAll(
    `script[data-spark-extension="${manifest.id}"]`,
  ))
    node.remove();
  const style = record.manifest.style;
  if (style) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `${convertFileSrc(`${record.path}/${style}`)}?v=${stamp}`;
    link.dataset.sparkExtension = manifest.id;
    document.head.append(link);
  }

  const source = `${convertFileSrc(`${record.path}/${record.manifest.entry}`)}?v=${stamp}`;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = source;
    script.async = true;
    script.dataset.sparkExtension = manifest.id;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error(`Chargement impossible : ${record.manifest.entry}`));
    document.head.append(script);
  });

  const factory = window.SparkExtensions?.[manifest.id];
  if (!factory)
    throw new Error(
      `Le paquet n’a pas enregistré l’extension ${manifest.id} dans SparkExtensions.`,
    );
  return views.adapt(manifest, factory(sparkRuntime));
}
