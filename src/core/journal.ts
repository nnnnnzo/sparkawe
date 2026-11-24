/**
 * Journal du workspace : une suite ordonnée d'événements, lisible par un
 * humain comme par un agent. Il ne remplace pas l'état, il raconte ce qui
 * vient de changer, ce que l'état seul ne peut pas dire.
 */

export type JournalSource = "human" | "agent" | "system";

export interface JournalEntry {
  seq: number;
  at: number;
  source: JournalSource;
  /** Appel MCP qui regroupe plusieurs effets d'une même action. */
  op?: string;
  /** Session MCP à l'origine de l'action. */
  agent?: string;
  /** Onglet dans lequel l'agent travaillait, même si l'effet est ailleurs. */
  activityTabId?: string;
  kind: string;
  tabId?: string;
  tileId?: string;
  data?: unknown;
}

export type JournalRecord = Omit<
  JournalEntry,
  "seq" | "at" | "source"
> & {
  source?: JournalSource;
};

export const JOURNAL_CAPACITY = 512;

export class Journal {
  private entries: JournalEntry[] = [];
  private nextSeq = 1;
  private readonly capacity: number;
  private readonly listeners = new Set<() => void>();
  private readonly recorders = new Set<(entry: JournalEntry) => void>();

  constructor(capacity = JOURNAL_CAPACITY) {
    this.capacity = capacity;
  }

  record = (record: JournalRecord): JournalEntry => {
    const entry: JournalEntry = {
      seq: this.nextSeq++,
      at: Date.now(),
      source: record.source ?? "human",
      ...record,
    };
    this.entries.push(entry);
    const overflow = this.entries.length - this.capacity;
    if (overflow > 0) this.entries.splice(0, overflow);
    for (const listener of this.recorders) {
      try {
        listener(entry);
      } catch (error) {
        // Le journal ne doit jamais casser une écriture du workspace.
        console.error(error);
      }
    }
    for (const listener of this.listeners) listener();
    return entry;
  };

  /** Reçoit chaque entrée au moment où elle est écrite. */
  onRecord = (listener: (entry: JournalEntry) => void) => {
    this.recorders.add(listener);
    return () => {
      this.recorders.delete(listener);
    };
  };

  /** Dernières entrées, de la plus ancienne à la plus récente. */
  list = (limit = 50) => this.entries.slice(-Math.max(0, limit));

  /** Entrées postérieures à `seq`, dans l'ordre, pour une reprise paginée. */
  since = (seq: number, limit = 50) =>
    this.entries
      .filter((entry) => entry.seq > seq)
      .slice(0, Math.max(0, limit));

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get lastSeq() {
    return this.nextSeq - 1;
  }
}

const MAX_STRING = 160;

/**
 * Réduit une valeur à un résumé de taille bornée. Le journal et le brief ne
 * doivent jamais embarquer un document entier ni une sortie de terminal.
 */
export function summarize(value: unknown, depth = 2): unknown {
  if (value === null || typeof value !== "object") {
    return typeof value === "string" && value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}… (${value.length} caractères)`
      : value;
  }
  if (depth <= 0) return Array.isArray(value) ? `[${value.length}]` : "{…}";
  if (Array.isArray(value))
    return value.length > 5
      ? [`${value.length} entrées`]
      : value.map((item) => summarize(item, depth - 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      summarize(item, depth - 1),
    ]),
  );
}
