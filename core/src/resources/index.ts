import { URL } from "node:url";

import type { ImageBudget } from "../config.js";
import { ChannelArtifactStore, type ArtifactStore } from "./artifact.js";
import { ChannelAssetStore, type AssetStore } from "./asset.js";

const READ_MAX_BYTES = 5 * 1024 * 1024;

export type Disposer = () => void;

export interface ResourceOpenOptions {
  readonly signal: AbortSignal;
  readonly maxBytes: number;
}

export interface ResourceOpenResult {
  readonly bytes: Uint8Array;
  readonly mediaType?: string;
  readonly filename?: string;
}

export interface ResourceReader {
  readonly scheme: string;
  readonly prompt: string;
  init(resources: ChannelResources, uri: URL, options: ResourceOpenOptions): Promise<ResourceOpenResult>;
}

export class ChannelResources {
  public readonly assets: AssetStore;
  public readonly artifacts: ArtifactStore;

  private readonly readers = new Map<string, ResourceReader>();

  public constructor(
    public readonly path: string,
    public readonly imageBudget: ImageBudget | null = null,
    private readonly readTimeoutMs = 10_000,
  ) {
    this.assets = new ChannelAssetStore(path);
    this.artifacts = new ChannelArtifactStore(path);
  }

  public async open(uri: string, signal?: AbortSignal): Promise<ResourceOpenResult | undefined> {
    const parsed = parseUri(uri);
    if (!parsed) return undefined;
    try {
      if (parsed.protocol === "asset:") {
        if (!/^[a-f0-9]{32}$/.test(parsed.hostname) || parsed.pathname !== "") return undefined;
        return normalize({ bytes: await this.assets.get(parsed.hostname) });
      }
      if (parsed.protocol === "artifact:") {
        if (!parsed.hostname || parsed.pathname === "/") return undefined;
        return normalize(await this.artifacts.open(uri));
      }
      const reader = this.readers.get(parsed.protocol.slice(0, -1));
      if (!reader) return undefined;
      return await this.openReader(reader, parsed, signal);
    } catch {
      return undefined;
    }
  }

  public listReaders(): readonly ResourceReader[] {
    return [...this.readers.values()];
  }

  public use(reader: ResourceReader): Disposer {
    if (reader.scheme === "asset" || reader.scheme === "artifact") throw new Error(`Scheme "${reader.scheme}" is reserved`);
    if (this.readers.has(reader.scheme)) throw new Error(`Resource reader for scheme "${reader.scheme}" is already registered`);
    this.readers.set(reader.scheme, reader);
    return () => {
      if (this.readers.get(reader.scheme) === reader) this.readers.delete(reader.scheme);
    };
  }

  private async openReader(reader: ResourceReader, uri: URL, signal?: AbortSignal): Promise<ResourceOpenResult> {
    if (signal?.aborted) throw signal.reason;
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    let timeout: NodeJS.Timeout | undefined;
    const timed = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort(new Error("Resource read timed out"));
        reject(new Error("Resource read timed out"));
      }, this.readTimeoutMs);
    });
    try {
      return normalize(await Promise.race([reader.init(this, uri, { signal: controller.signal, maxBytes: READ_MAX_BYTES }), timed]));
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}

function parseUri(value: string): URL | undefined {
  try {
    const uri = new URL(value);
    if (uri.search || uri.hash || uri.username || uri.password || uri.port || uri.pathname.includes("%")) return undefined;
    if (uri.pathname.split("/").some((part) => part === "." || part === "..")) return undefined;
    return uri;
  } catch {
    return undefined;
  }
}

function normalize(value: unknown): ResourceOpenResult {
  if (!value || typeof value !== "object" || !("bytes" in value)) throw new Error("Invalid resource result");
  const result = value as Partial<ResourceOpenResult>;
  if (!(result.bytes instanceof Uint8Array) || result.bytes.byteLength > READ_MAX_BYTES) throw new Error("Invalid resource bytes");
  if (result.mediaType !== undefined && !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(result.mediaType)) throw new Error("Invalid resource media type");
  if (result.filename !== undefined && (result.filename.length === 0 || /[\\/\0]/.test(result.filename))) throw new Error("Invalid resource filename");
  return result as ResourceOpenResult;
}

export { type ArtifactOpenResult, type ArtifactStore, type ArtifactWriter } from "./artifact.js";
export { type AssetStore } from "./asset.js";
