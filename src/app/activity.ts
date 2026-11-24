import { invoke } from "@tauri-apps/api/core";
import type { ActivityPersistence, ActivityStep, InverseEffect } from "../core/activity.ts";
import { t as translateNow } from "../i18n/index.ts";
import { runLayoutCommand } from "../ui/layoutBridge.ts";
import type { Runtime } from "./runtime.ts";

/** Adaptateur SQLite : le noyau ne connaît que cette petite interface. */
export function activityPersistence(): ActivityPersistence {
  return {
    async load(tabId, limit) {
      return invoke<{ steps: unknown[]; lastSeenAt: number }>("activity_load", {
        tab: tabId,
        limit,
      });
    },
    append(step) {
      return invoke("activity_append", { payload: JSON.stringify(step) });
    },
    revert(id, at) {
      return invoke("activity_revert", { id, at });
    },
    forget(id) {
      return invoke("activity_forget", { id });
    },
    seen(tabId, at) {
      return invoke("activity_seen", { tab: tabId, at });
    },
    clear() {
      return invoke("activity_clear");
    },
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Applique une étape d'historique, en vérifiant les objets encore présents. */
export async function revertStep(
  runtime: Runtime,
  step: ActivityStep,
  choice: "action" | "instant",
) {
  const state = runtime.workspace.get();
  const tab = state.tabs.find((candidate) => candidate.id === step.tabId);
  if (!tab) throw new Error(translateNow("activity.error.tabMissing"));
  if (state.active !== step.tabId)
    throw new Error(translateNow("activity.error.activeTab"));
  const effects =
    choice === "instant"
      ? step.inverse.filter((effect) => effect.type === "layoutRestore")
      : step.inverse
          .filter((effect) => effect.type !== "layoutRestore")
          .reverse();
  if (!effects.length) throw new Error(translateNow("activity.error.noInverse"));
  if (
    step.mode &&
    tab.mode !== step.mode &&
    effects.some((effect) => effect.type.startsWith("layout"))
  )
    throw new Error(
      translateNow("activity.reason.mode", {
        mode: translateNow(`shell.command.${step.mode}`),
      }),
    );
  for (const effect of effects) await apply(runtime, effect);
  runtime.activity.markReverted(step);
}

async function apply(runtime: Runtime, effect: InverseEffect) {
  const { workspace, registry } = runtime;
  switch (effect.type) {
    case "layoutMove":
      runLayoutCommand({
        type: "move",
        tile: effect.tile,
        target: effect.target,
        side: effect.side,
        record: false,
      });
      return;
    case "layoutResize":
      runLayoutCommand({
        type: "resize",
        tile: effect.tile,
        width: effect.width,
        height: effect.height,
        record: false,
      });
      return;
    case "layoutRestore":
      runLayoutCommand({
        type: "restore",
        snapshot: effect.snapshot,
        record: false,
      });
      return;
    case "closeTile": {
      const tab = workspace.tabForTile(effect.tile);
      if (!tab) throw new Error(translateNow("activity.error.tileMissing"));
      const closed = await runtime.closeTiles([effect.tile], () =>
        workspace.removeTile(tab.id, effect.tile),
      );
      if (!closed) throw new Error(translateNow("activity.error.unsaved"));
      return;
    }
    case "reopenTile": {
      if (!workspace.get().tabs.some((tab) => tab.id === effect.tabId))
        throw new Error(translateNow("activity.error.tabMissing"));
      workspace.addTile(effect.tile.type, effect.tile.data, effect.tabId);
      return;
    }
    case "closeTab": {
      const tab = workspace
        .get()
        .tabs.find((candidate) => candidate.id === effect.tabId);
      if (!tab) throw new Error(translateNow("activity.error.tabMissing"));
      const closed = await runtime.closeTiles(
        tab.tiles.map((tile) => tile.id),
        () => workspace.remove(tab.id),
      );
      if (!closed) throw new Error(translateNow("activity.error.unsaved"));
      return;
    }
    case "reopenTab": {
      const tab = workspace.create(effect.tab.name, effect.tab.mode, true);
      for (const tile of effect.tab.tiles)
        workspace.addTile(tile.type, tile.data, tab.id);
      return;
    }
    case "action":
      await registry.restoreInverse(
        effect.tileId,
        effect.action,
        effect.snapshot,
        effect.result,
      );
      return;
  }
}

export function revertFailure(error: unknown) {
  return errorMessage(error);
}
