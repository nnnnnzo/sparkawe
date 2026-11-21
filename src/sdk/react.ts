import type { ComponentType } from "react";
import type {
  Dispose,
  LabAPI,
  LabExtension,
  Tile,
  TileDefinition,
  TileSurface,
} from "./index.ts";

export interface TileViewProps {
  tile: Tile;
  active: boolean;
}

export type TileView = ComponentType<TileViewProps>;

export type ExtensionAPI = Omit<LabAPI, "tiles"> & {
  tiles: {
    register(definition: TileDefinition & { view: TileView }): Dispose;
    publish(tileId: string, surface: TileSurface): void;
  };
};

export interface ExtensionModule extends Pick<LabExtension, "deactivate"> {
  activate(api: ExtensionAPI): void | Promise<void>;
}
