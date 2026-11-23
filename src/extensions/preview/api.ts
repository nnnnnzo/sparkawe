import { invoke } from "@tauri-apps/api/core";
import type { ServiceKey, Tile } from "../../sdk/index.ts";
import type { PreviewKind } from "./kind.ts";

export interface PdfSource {
  /** Clé de cache stable : identifiant du travail, URL, UUID. */
  id: string;
  title?: string;
  /** URL candidates, essayées dans l'ordre jusqu'à la première qui répond. */
  urls: string[];
}

export interface PdfViewer {
  /** Vérifie une URL libre puis ouvre la tuile d'aperçu. */
  open(source: PdfSource, alongside?: string): Promise<Tile>;
}

export interface PreviewFile {
  /** Jeton du grant local ; vide pour un fichier du cache. */
  token: string;
  name: string;
  path: string;
  kind: PreviewKind;
  bytes: number;
  source: string;
  text?: string;
  truncated: boolean;
}

export type PreviewInput =
  | { type: "url"; id: string; title?: string; urls: string[] }
  | { type: "file"; file: PreviewFile }
  | { type: "explorer"; token: string; segments: string[]; name?: string };

export interface FilePreviewer {
  /** Ouvre une source dans une nouvelle tuile Aperçu. */
  open(input: PreviewInput, alongside?: string): Promise<Tile>;
  /** Indique si un nom de fichier est pris en charge par l'aperçu. */
  supports(name: string): boolean;
}

export const previewPdf: ServiceKey<PdfViewer> = { id: "preview.pdf@1" };
export const previewOpener: ServiceKey<FilePreviewer> = {
  id: "preview.open@1",
};

export const previewSelect = (filter?: PreviewKind | "all") =>
  invoke<PreviewFile | null>("preview_select", { filter: filter ?? null });

export const previewSource = (token: string) =>
  invoke<PreviewFile>("preview_source", { token });

export const previewFromExplorer = (token: string, segments: string[]) =>
  invoke<PreviewFile>("preview_from_explorer", { token, segments });

export const previewFetch = (urls: string[], id: string, kind?: string) =>
  invoke<PreviewFile>("preview_fetch", { urls, id, kind: kind ?? null });

export const previewDrop = (paths: string[]) =>
  invoke<PreviewFile[]>("preview_drop", { paths });
