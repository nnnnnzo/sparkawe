import { invoke } from "@tauri-apps/api/core";
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

const collator = new Intl.Collator("fr", {
  numeric: true,
  sensitivity: "base",
});
const paths = (token: string, segments: string[]) => ({ token, segments });

export const isMarkdown = (entry: Entry) =>
  entry.kind === "file" && /\.(?:md|markdown)$/i.test(entry.name);

export const pickFolder = () => invoke<ProjectFolder | null>("explorer_select");

export async function listFolder(token: string, segments: string[]) {
  const entries = await invoke<Entry[]>(
    "explorer_list",
    paths(token, segments),
  );
  return entries.sort((a, b) => {
    return (
      Number(b.kind === "folder") - Number(a.kind === "folder") ||
      collator.compare(a.name, b.name) ||
      a.name.localeCompare(b.name)
    );
  });
}

export const readMarkdown = (token: string, segments: string[]) =>
  invoke<MarkdownFile>("explorer_open_markdown", paths(token, segments));

export const resolveFolder = (token: string, segments: string[]) =>
  invoke<string>("explorer_directory", paths(token, segments));
