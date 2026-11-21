/**
 * Pont impératif entre les outils MCP et l'onglet actif : déplacer ou
 * redimensionner une tuile demande l'API Dockview, qui vit dans le moteur de
 * disposition. Un seul onglet est monté à la fois, donc un seul gestionnaire.
 */

export type LayoutSide = "left" | "right" | "top" | "bottom" | "center";

export type LayoutCommand =
  | { type: "move"; tile: string; target: string; side: LayoutSide }
  | { type: "resize"; tile: string; width?: number; height?: number }
  | { type: "undo" }
  | { type: "redo" };

type Handler = (command: LayoutCommand) => void;

let handler: Handler | undefined;

export function registerLayoutHandler(next: Handler) {
  handler = next;
  return () => {
    if (handler === next) handler = undefined;
  };
}

export function runLayoutCommand(command: LayoutCommand) {
  if (!handler)
    throw new Error(
      "Aucun onglet actif n’est prêt pour la disposition. Activez l’onglet de la tuile.",
    );
  handler(command);
}
