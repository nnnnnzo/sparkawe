import type { EventKey, ServiceKey, Tile } from "../../sdk/index.ts";

export interface MarkdownFile {
  token: string;
  path: string;
  directory: string;
  text: string;
}

export const markdownOpener: ServiceKey<{
  open(file: MarkdownFile, alongside?: string): Tile;
}> = { id: "markdown.open@1" };

export interface MarkdownDocument {
  id: string;
  path?: string;
  directory?: string;
  text: string;
  dirty: boolean;
}

export interface MarkdownDocuments {
  list(): MarkdownDocument[];
  getActive(): MarkdownDocument | undefined;
  get(id: string): MarkdownDocument | undefined;
  update(id: string, text: string): void;
  save(id: string): Promise<void>;
}

export const markdownDocuments: ServiceKey<MarkdownDocuments> = {
  id: "markdown.documents@1",
};
export const documentSaved: EventKey<MarkdownDocument> = {
  id: "markdown.document.saved",
};
