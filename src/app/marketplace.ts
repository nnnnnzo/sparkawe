import { invoke } from "@tauri-apps/api/core";
import type { Manifest } from "../sdk/index.ts";
import { compareVersions, latestVersion } from "../core/version.ts";
import { t as translateNow } from "../i18n/index.ts";

export interface RegistryVersion {
  version: string;
  url: string;
  sha256: string;
  size?: number;
  engine?: string;
  publishedAt?: string;
}

export interface RegistryExtension {
  id: string;
  name: string;
  publisher?: string;
  subtitle?: string;
  summary?: string;
  description?: string;
  category?: string;
  repository?: string;
  icon?: string;
  versions: RegistryVersion[];
}

export interface RegistryIndex {
  schema: 1;
  name: string;
  updatedAt?: string;
  extensions: RegistryExtension[];
}

export interface MarketSource {
  url: string;
  name: string;
}

export interface RemoteExtension {
  source: MarketSource;
  extension: RegistryExtension;
  version: RegistryVersion;
}

function normalizeVersion(value: RegistryVersion): RegistryVersion | undefined {
  if (
    !value ||
    typeof value.version !== "string" ||
    typeof value.url !== "string" ||
    typeof value.sha256 !== "string"
  )
    return undefined;
  return value;
}

function normalizeIndex(value: RegistryIndex): RegistryIndex | undefined {
  if (
    !value ||
    value.schema !== 1 ||
    !Array.isArray(value.extensions) ||
    typeof value.name !== "string"
  )
    return undefined;
  return {
    ...value,
    extensions: value.extensions
      .filter(
        (extension) =>
          extension &&
          typeof extension.id === "string" &&
          typeof extension.name === "string" &&
          Array.isArray(extension.versions),
      )
      .map((extension) => ({
        ...extension,
        versions: extension.versions
          .map(normalizeVersion)
          .filter((version): version is RegistryVersion => !!version),
      }))
      .filter((extension) => extension.versions.length > 0),
  };
}

export class Marketplace {
  private sources: MarketSource[] = [];
  private indexes = new Map<string, RegistryIndex>();
  private failures = new Map<string, string>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private loading = false;
  private installer?: (remote: RemoteExtension) => Promise<Manifest>;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get version() {
    return this.revision;
  }

  get sourceList(): MarketSource[] {
    return [...this.sources];
  }

  get errorFor() {
    return (url: string) => this.failures.get(url);
  }

  get entries(): RemoteExtension[] {
    const entries: RemoteExtension[] = [];
    for (const source of this.sources) {
      const index = this.indexes.get(source.url);
      if (!index) continue;
      for (const extension of index.extensions) {
        const version = latestVersion(extension.versions);
        if (version) entries.push({ source, extension, version });
      }
    }
    return entries;
  }

  setInstaller(installer: (remote: RemoteExtension) => Promise<Manifest>) {
    this.installer = installer;
  }

  private notify() {
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }

  async restore() {
    this.sources = await invoke<MarketSource[]>("extension_sources");
    await this.refresh();
  }

  async refresh() {
    if (this.loading) return;
    this.loading = true;
    try {
      const results = await Promise.all(
        this.sources.map(async (source) => {
          try {
            const index = normalizeIndex(
              await invoke<RegistryIndex>("registry_fetch", {
                url: source.url,
              }),
            );
            if (!index) throw new Error(translateNow("errors.invalidIndex"));
            return { source, index };
          } catch (error) {
            return { source, error };
          }
        }),
      );
      this.indexes.clear();
      this.failures.clear();
      for (const result of results) {
        if ("index" in result && result.index)
          this.indexes.set(result.source.url, result.index);
        else
          this.failures.set(
            result.source.url,
            result.error instanceof Error
              ? result.error.message
              : String(result.error),
          );
      }
    } finally {
      this.loading = false;
      this.notify();
    }
  }

  async addSource(url: string, name: string) {
    this.sources = await invoke<MarketSource[]>("extension_source_add", {
      url,
      name,
    });
    await this.refresh();
  }

  async removeSource(url: string) {
    this.sources = await invoke<MarketSource[]>("extension_source_remove", {
      url,
    });
    this.indexes.delete(url);
    this.failures.delete(url);
    this.notify();
  }

  async install(remote: RemoteExtension) {
    if (!this.installer)
      throw new Error(translateNow("errors.installFromRepositoryUnavailable"));
    const manifest = await this.installer(remote);
    this.notify();
    return manifest;
  }

  updates(installed: Manifest[]): RemoteExtension[] {
    const versions = new Map(
      installed.map((manifest) => [manifest.id, manifest.version]),
    );
    return this.entries.filter((remote) => {
      const current = versions.get(remote.extension.id);
      return (
        current !== undefined &&
        compareVersions(remote.version.version, current) > 0
      );
    });
  }
}
