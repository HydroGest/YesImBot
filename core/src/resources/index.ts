import { URL } from "node:url";

import { h, type Element } from "koishi";

import type { ChannelScope } from "../channels/index.js";
import type { ImageBudget } from "../config.js";
import { ChannelArtifactStore, type ArtifactStore } from "./artifact.js";
import { ChannelAssetStore, type AssetStore } from "./asset.js";
const READ_MAX_BYTES = 5 * 1024 * 1024;
const COMPLETE_ASSET_ID = /^[a-f0-9]{32}$/;
const URI_SHAPE = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)(?:\/([^?#]*))?$/;
const RESOURCE_SOURCE = /^(asset|artifact|workspace):\/\//;
export type Disposer = () => void;
export type ResourceReadErrorCode =
  | "invalid_resource_uri"
  | "resource_unavailable"
  | "resource_not_found"
  | "timeout"
  | "resource_read_aborted"
  | "resource_too_large"
  | "resource_read_failed";
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
  setup(resources: ChannelResources, uri: URL, options: ResourceOpenOptions): Promise<ResourceOpenResult>;
}
export interface Resources {
  get(scope: ChannelScope): Promise<ChannelResources>;
  use(reader: ResourceReader): Disposer;
}
export class ResourceReadError extends Error {
  public constructor(public readonly code: ResourceReadErrorCode) {
    super(code);
  }
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
    try {
      return await this.openStrict(uri, signal);
    } catch (cause) {
      if (cause instanceof ResourceReadError) return undefined;
      throw cause;
    }
  }

  /** Strict raw-open used by tool factories: throws a typed error instead of collapsing to undefined. */
  public async openStrict(uri: string, signal?: AbortSignal): Promise<ResourceOpenResult> {
    const parsed = parseUri(uri);
    if (!parsed) throw new ResourceReadError("invalid_resource_uri");

    try {
      if (parsed.protocol === "asset:") {
        if (!COMPLETE_ASSET_ID.test(parsed.hostname) || parsed.pathname !== "") throw new ResourceReadError("invalid_resource_uri");
        try {
          return normalize({ bytes: await this.assets.get(parsed.hostname) });
        } catch {
          throw new ResourceReadError("resource_not_found");
        }
      }
      if (parsed.protocol === "artifact:") {
        if (!parsed.hostname || parsed.pathname === "/") throw new ResourceReadError("invalid_resource_uri");
        try {
          return normalize(await this.artifacts.open(uri));
        } catch {
          throw new ResourceReadError("resource_not_found");
        }
      }
      if (parsed.protocol === "workspace:" && parsed.hostname) throw new ResourceReadError("invalid_resource_uri");
      if (parsed.pathname === "" || parsed.pathname === "/") throw new ResourceReadError("invalid_resource_uri");

      const reader = this.readers.get(parsed.protocol.slice(0, -1));
      if (!reader) throw new ResourceReadError("resource_unavailable");
      return await this.openReader(reader, parsed, signal);
    } catch (cause) {
      if (cause instanceof ResourceReadError) throw cause;
      throw new ResourceReadError("resource_read_failed");
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
    if (signal?.aborted) throw new ResourceReadError("resource_read_aborted");
    const controller = new AbortController();
    let timeout: NodeJS.Timeout | undefined;
    const timed = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort(new Error("Resource read timed out"));
        reject(new ResourceReadError("timeout"));
      }, this.readTimeoutMs);
    });
    let rejectAborted!: (reason?: unknown) => void;
    const cancelled = new Promise<never>((_, reject) => {
      rejectAborted = reject;
    });
    const onAbort = () => {
      controller.abort(signal?.reason);
      rejectAborted(new ResourceReadError("resource_read_aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const result = await Promise.race([reader.setup(this, uri, { signal: controller.signal, maxBytes: READ_MAX_BYTES }), timed, cancelled]);
      if (signal?.aborted) throw new ResourceReadError("resource_read_aborted");
      return normalize(result);
    } catch (cause) {
      if (cause instanceof ResourceReadError) throw cause;
      if (signal?.aborted) throw new ResourceReadError("resource_read_aborted");
      throw new ResourceReadError("resource_read_failed");
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}
export async function prepareOutputSegments(
  segments: readonly (readonly Element[])[],
  resources: ChannelResources,
  signal?: AbortSignal,
): Promise<Element[][]> {
  const prepared: Element[][] = [];
  for (const segment of segments) {
    const next = await Promise.all(segment.map((element) => prepareElement(element, resources, signal)));
    const filtered = next.filter((element): element is Element => element !== undefined);
    if (filtered.length) prepared.push(filtered);
  }
  return prepared;
}
async function prepareElement(element: Element, resources: ChannelResources, signal?: AbortSignal): Promise<Element | undefined> {
  if (element.children.length)
    return h(
      element.type,
      element.attrs,
      (await Promise.all(element.children.map((child) => prepareElement(child, resources, signal)))).filter((child): child is Element => child !== undefined),
    );
  const src = element.attrs.src;
  if (typeof src !== "string" || !RESOURCE_SOURCE.test(src) || (element.type !== "img" && element.type !== "file")) return element;
  if (element.type === "img" && !/^asset:\/\/[a-f0-9]{32}$/.test(src)) {
    // ponytail: full 32-hex ID required for output resolution; prefix/short IDs are not resolvable
    const scheme = src.slice(0, src.indexOf(":"));
    if (scheme === "asset") return undefined;
  }
  const opened = await resources.open(src, signal);
  if (!opened) return undefined;
  const detected = detectMediaType(opened.bytes);
  if (element.type === "img" && !detected) return undefined;
  const mediaType = detected ?? opened.mediaType ?? "application/octet-stream";
  return h(element.type, { ...element.attrs, src: `data:${mediaType};base64,${Buffer.from(opened.bytes).toString("base64")}` });
}
function detectMediaType(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  )
    return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "image/webp";
  return undefined;
}
function parseUri(value: string): URL | undefined {
  const match = URI_SHAPE.exec(value);
  if (!match) return undefined;
  const scheme = match[1]!.toLowerCase();
  const authority = match[2] ?? "";
  const rawPath = match[3] ?? "";
  if (
    value.includes("?") ||
    value.includes("#") ||
    authority.includes("@") ||
    authority.includes(":") ||
    rawPath.includes("%") ||
    rawPath.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return undefined;
  }
  const uri = new URL(`${scheme}://${authority}${rawPath ? `/${rawPath}` : ""}`);
  if (uri.search || uri.hash || uri.username || uri.password || uri.port) return undefined;
  if (uri.pathname.split("/").some((part) => part === "." || part === "..")) return undefined;
  return uri;
}
function normalize(value: unknown): ResourceOpenResult {
  if (!value || typeof value !== "object" || !("bytes" in value)) throw new Error("Invalid resource result");
  const result = value as Partial<ResourceOpenResult>;
  if (!(result.bytes instanceof Uint8Array)) throw new Error("Invalid resource bytes");
  if (result.bytes.byteLength > READ_MAX_BYTES) throw new ResourceReadError("resource_too_large");
  if (result.mediaType !== undefined && !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(result.mediaType))
    throw new Error("Invalid resource media type");
  if (result.filename !== undefined && (result.filename.length === 0 || /[\\/\0]/.test(result.filename))) throw new Error("Invalid resource filename");
  return result as ResourceOpenResult;
}
export { type ArtifactOpenResult, type ArtifactStore, type ArtifactWriter } from "./artifact.js";
export { type AssetStore } from "./asset.js";
export { persistElements } from "./input.js";
