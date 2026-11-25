/** Workspace.reorder takes a final index, not the boundary between two tabs. */
export function tabDropTarget(
  tabs: readonly { id: string }[],
  source: string,
  hovered: string,
  edge: "before" | "after",
): string | undefined {
  const from = tabs.findIndex(({ id }) => id === source);
  const over = tabs.findIndex(({ id }) => id === hovered);
  if (from < 0 || over < 0 || from === over) return;
  const boundary = over + Number(edge === "after");
  const destination = boundary - Number(from < boundary);
  return destination === from ? undefined : tabs[destination]?.id;
}
