import type { Dispose, SparkExtension, Manifest } from "../sdk/index.ts";
import type { ExtensionModule, TileView } from "../sdk/react.ts";

export class TileViews {
  private readonly views = new Map<string, TileView>();
  get = (type: string) => this.views.get(type);

  adapt(manifest: Manifest, extension: ExtensionModule): SparkExtension {
    const disposers = new Set<Dispose>();
    return {
      manifest,
      activate: (api) =>
        extension.activate({
          ...api,
          tiles: {
            ...api.tiles,
            register: ({ view, ...definition }) => {
              // Un paquet importé ne fournit pas d’icône par tuile : celle du
              // manifeste sert alors aussi dans la barre d’onglet.
              const remove = api.tiles.register({
                ...definition,
                icon: definition.icon ?? manifest.icon,
              });
              this.views.set(definition.type, view);
              const dispose = () => {
                if (!disposers.delete(dispose)) return;
                this.views.delete(definition.type);
                remove();
              };
              disposers.add(dispose);
              return dispose;
            },
          },
        }),
      async deactivate() {
        try {
          await extension.deactivate?.();
        } finally {
          for (const dispose of disposers) dispose();
        }
      },
    };
  }
}
