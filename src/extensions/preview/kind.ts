export type PreviewKind = "pdf" | "image" | "audio" | "video" | "text" | "html";

const familyExtensions: Record<PreviewKind, readonly string[]> = {
  pdf: ["pdf"],
  image: ["png", "jpg", "jpeg", "webp", "gif", "avif"],
  audio: ["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus"],
  video: ["mp4", "webm", "mov", "m4v", "ogv"],
  text: [
    "txt",
    "json",
    "jsonc",
    "log",
    "csv",
    "tsv",
    "yaml",
    "yml",
    "toml",
    "xml",
    "svg",
    "ini",
    "conf",
    "cfg",
    "env",
    "sh",
    "bash",
    "zsh",
    "fish",
    "py",
    "rs",
    "ts",
    "tsx",
    "js",
    "jsx",
    "css",
    "scss",
    "less",
    "sql",
    "c",
    "h",
    "cpp",
    "hpp",
    "go",
    "java",
    "kt",
    "swift",
    "rb",
    "php",
    "lua",
    "r",
    "pl",
    "ex",
    "exs",
    "erl",
    "hs",
    "clj",
    "vue",
    "svelte",
  ],
  html: ["html", "htm"],
};

export const previewFamilies: readonly PreviewKind[] = [
  "pdf",
  "image",
  "audio",
  "video",
  "text",
  "html",
];

export function extensionOf(name: string): string {
  const clean = name.split(/[?#]/)[0];
  const base = clean.split(/[/\\]/).filter(Boolean).at(-1) ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function kindOf(name: string): PreviewKind | undefined {
  const extension = extensionOf(name);
  if (!extension) return undefined;
  return (Object.keys(familyExtensions) as PreviewKind[]).find((kind) =>
    familyExtensions[kind].includes(extension),
  );
}

export function isPreviewable(name: string): boolean {
  return kindOf(name) !== undefined;
}

export function fileNameOf(source: string): string {
  const clean = source.split(/[?#]/)[0];
  const base = clean.split(/[/\\]/).filter(Boolean).at(-1);
  if (!base) return "Aperçu";
  try {
    return decodeURIComponent(base);
  } catch {
    return base;
  }
}
