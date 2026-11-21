import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Manifest, SparkExtension } from "../sdk/index.ts";
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
  for (const link of document.head.querySelectorAll(
    `link[data-spark-extension="${manifest.id}"]`,
  ))
    link.remove();
  const style = record.manifest.style;
  if (style) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = convertFileSrc(`${record.path}/${style}`);
    link.dataset.sparkExtension = manifest.id;
    document.head.append(link);
  }

  const source = convertFileSrc(`${record.path}/${record.manifest.entry}`);
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
