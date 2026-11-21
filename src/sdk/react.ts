import type { ComponentType } from "react";
import type {
  Dispose,
  SparkAPI,
  SparkExtension,
  Tile,
  TileDefinition,
  TileSurface,
} from "./index.ts";

export interface TileViewProps {
  tile: Tile;
  active: boolean;
}

export type TileView = ComponentType<TileViewProps>;

export type ExtensionAPI = Omit<SparkAPI, "tiles"> & {
  tiles: {
    register(definition: TileDefinition & { view: TileView }): Dispose;
    publish(tileId: string, surface: TileSurface): void;
  };
};

export interface ExtensionModule extends Pick<SparkExtension, "deactivate"> {
  activate(api: ExtensionAPI): void | Promise<void>;
}
