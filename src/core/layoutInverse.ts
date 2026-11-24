/**
 * Retrouve la place d'une tuile avant un déplacement, à partir de la
 * disposition sérialisée de Dockview. Sert à rejouer l'inverse d'un `moveTo`
 * sans restaurer toute la disposition.
 */

import type { SerializedDockview } from "dockview-react";
import type { LayoutSide } from "./activity.ts";

interface GridLeaf {
  type: "leaf";
  data?: { views?: unknown };
  size?: number;
}

interface GridBranch {
  type: "branch";
  data?: GridNode[];
  size?: number;
}

type GridNode = GridLeaf | GridBranch;
type Orientation = "HORIZONTAL" | "VERTICAL";

interface Level {
  branch: GridBranch;
  index: number;
  orientation: Orientation;
}

const orthogonal = (orientation: Orientation): Orientation =>
  orientation === "HORIZONTAL" ? "VERTICAL" : "HORIZONTAL";

function viewsOf(node: GridNode): string[] {
  if (node.type !== "leaf") return [];
  const views = node.data?.views;
  return Array.isArray(views)
    ? views.filter((view): view is string => typeof view === "string")
    : [];
}

function firstView(node: GridNode): string | undefined {
  if (node.type === "leaf") return viewsOf(node)[0];
  for (const child of node.data ?? []) {
    const view = firstView(child);
    if (view) return view;
  }
  return undefined;
}

function locate(
  node: GridNode,
  tile: string,
  orientation: Orientation,
  path: Level[],
): { leaf: GridLeaf; path: Level[] } | undefined {
  if (node.type === "leaf") {
    return viewsOf(node).includes(tile) ? { leaf: node, path } : undefined;
  }
  for (const [index, child] of (node.data ?? []).entries()) {
    const found = locate(child, tile, orthogonal(orientation), [
      ...path,
      { branch: node, index, orientation },
    ]);
    if (found) return found;
  }
  return undefined;
}

export interface PreviousPlacement {
  target: string;
  side: LayoutSide;
}

/**
 * `null` quand la tuile était seule dans la disposition : il n'y a pas
 * d'ancrage vers lequel la ramener. Le menu proposera alors seulement de
 * restaurer la disposition de l'instant.
 */
export function previousPlacement(
  snapshot: unknown,
  tile: string,
): PreviousPlacement | null {
  const serialized = snapshot as Partial<SerializedDockview> | undefined;
  const root = serialized?.grid?.root as GridNode | undefined;
  if (!root) return null;
  const orientation: Orientation =
    serialized?.grid?.orientation === "VERTICAL" ? "VERTICAL" : "HORIZONTAL";
  const found = locate(root, tile, orientation, []);
  if (!found) return null;

  // La tuile était un onglet parmi d'autres : elle revient dans son groupe.
  const siblings = viewsOf(found.leaf).filter((view) => view !== tile);
  if (siblings.length) return { target: siblings[0], side: "center" };

  // La tuile était seule : on remonte jusqu'au premier frère.
  for (let level = found.path.length - 1; level >= 0; level -= 1) {
    const { branch, index, orientation: sideOrientation } = found.path[level];
    const children = branch.data ?? [];
    if (children.length < 2) continue;
    const before = index > 0 ? children[index - 1] : undefined;
    const after = index === 0 ? children[index + 1] : undefined;
    const sibling = index > 0 ? before : after;
    if (!sibling) continue;
    const target = firstView(sibling);
    if (!target) continue;
    const horizontal = sideOrientation === "HORIZONTAL";
    const side: LayoutSide =
      index > 0
        ? horizontal
          ? "right"
          : "bottom"
        : horizontal
          ? "left"
          : "top";
    return { target, side };
  }
  return null;
}
