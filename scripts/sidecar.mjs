#!/usr/bin/env node
/**
 * Construit le pont MCP et le copie sous le nom attendu par Tauri :
 * `binaries/spark-mcp-<triple>` (`.exe` sur Windows).
 *
 * Tauri exige un binaire par plateforme cible pour `externalBin`, avec le
 * triple dans le nom. Le pont est livré avec l'application, pas installé à part.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const release = process.argv.includes("--release");
const profile = release ? "release" : "debug";

const triple = execFileSync("rustc", ["-vV"], { encoding: "utf8" })
  .split("\n")
  .find((line) => line.startsWith("host: "))
  ?.slice("host: ".length)
  .trim();
if (!triple) throw new Error("Triple cible introuvable (rustc -vV).");

execFileSync(
  "cargo",
  [
    "build",
    "--manifest-path",
    join(root, "src-tauri", "Cargo.toml"),
    "--bin",
    "spark-mcp",
    ...(release ? ["--release"] : []),
  ],
  { stdio: "inherit" },
);

const suffix = process.platform === "win32" ? ".exe" : "";
const source = join(root, "src-tauri", "target", profile, `spark-mcp${suffix}`);
if (!existsSync(source)) throw new Error(`Binaire introuvable : ${source}`);

const target = join(root, "src-tauri", "binaries", `spark-mcp-${triple}${suffix}`);
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
if (process.platform !== "win32") chmodSync(target, 0o755);
console.log(`Pont MCP prêt : ${target}`);
