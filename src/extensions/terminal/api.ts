import type { EventKey, ServiceKey, Tile } from "../../sdk/index.ts";

export const terminalLauncher: ServiceKey<{
  open(directory: string, alongside?: string): Tile;
}> = { id: "terminal.open@1" };

export interface TerminalSessions {
  get(id: string): { id: string; running: boolean } | undefined;
  list(): { id: string; running: boolean }[];
}

export const terminalSessions: ServiceKey<TerminalSessions> = {
  id: "terminal.sessions@1",
};
export const terminalClosed: EventKey<string> = {
  id: "terminal.session.closed",
};
