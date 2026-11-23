import { invoke } from "@tauri-apps/api/core";
import type { Locale } from "../../core/i18n.ts";
import type { MarkdownFile } from "../markdown/api.ts";

export interface ProjectFolder {
  token: string;
  name: string;
  path: string;
}

export interface Entry {
  name: string;
  kind: "folder" | "file" | "link";
}

export interface Selection extends Entry {
  segments: string[];
}

const collators = new Map<Locale, Intl.Collator>();
function collatorFor(locale: Locale) {
  let collator = collators.get(locale);
  if (!collator) {
    collator = new Intl.Collator(locale, {
      numeric: true,
      sensitivity: "base",
    });
    collators.set(locale, collator);
  }
  return collator;
}
const paths = (token: string, segments: string[]) => ({ token, segments });

/** Dossiers d’abord, puis noms triés dans la langue de l’interface. */
export function sortEntries(entries: Entry[], locale: Locale): Entry[] {
  const collator = collatorFor(locale);
  return entries.sort((a, b) => {
    return (
      Number(b.kind === "folder") - Number(a.kind === "folder") ||
      collator.compare(a.name, b.name) ||
      a.name.localeCompare(b.name)
    );
  });
}

export const isMarkdown = (entry: Entry) =>
  entry.kind === "file" && /\.(?:md|markdown)$/i.test(entry.name);

export const pickFolder = () => invoke<ProjectFolder | null>("explorer_select");

export async function listFolder(
  token: string,
  segments: string[],
  locale: Locale,
) {
  const entries = await invoke<Entry[]>(
    "explorer_list",
    paths(token, segments),
  );
  return sortEntries(entries, locale);
}

export const readMarkdown = (token: string, segments: string[]) =>
  invoke<MarkdownFile>("explorer_open_markdown", paths(token, segments));

export const resolveFolder = (token: string, segments: string[]) =>
  invoke<string>("explorer_directory", paths(token, segments));
