import type { ServiceKey, Tile } from "../../sdk/index.ts";

export interface WebBrowser {
  /** Ouvre une adresse publique dans une tuile navigateur. */
  open(url: string, alongside?: string): Tile;
}

export const webBrowser: ServiceKey<WebBrowser> = { id: "web.open@1" };
