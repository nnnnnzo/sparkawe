import type { SerializedDockview } from "dockview-react";

/** Les anciens snapshots peuvent demander le calque flottant de Dockview.
 * Conserver groupes, tailles et sélection, mais hériter du rendu courant. */
export function inlineLayout(snapshot: SerializedDockview): SerializedDockview {
  const panels = Object.entries(snapshot.panels);
  if (!panels.some(([, panel]) => panel.renderer === "always")) return snapshot;
  return {
    ...snapshot,
    panels: Object.fromEntries(
      panels.map(([id, panel]) => [
        id,
        panel.renderer === "always" ? { ...panel, renderer: undefined } : panel,
      ]),
    ),
  };
}
