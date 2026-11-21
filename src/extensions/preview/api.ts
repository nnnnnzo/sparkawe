import type { ServiceKey, Tile } from "../../sdk/index.ts";

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

export const previewPdf: ServiceKey<PdfViewer> = { id: "preview.pdf@1" };
