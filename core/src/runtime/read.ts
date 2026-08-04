import type { AgentPlugin } from "@yesimbot/agent-runtime";
import type { FilePart } from "ai";

import type { ArtifactStore, ArtifactOpenResult } from "../artifact.js";
import type { AssetStore } from "../asset.js";
import type { Config, ImageBudget } from "../config.js";
import type { ChannelScope } from "./storage.js";

export interface ResourceSchemeOpenHandler {
  (scope: ChannelScope, uri: string, options: { signal: AbortSignal; maxBytes: number }): Promise<ResourceOpenResult>;
}

export interface ResourceOpenResult {
  readonly bytes: Uint8Array;
  readonly mediaType?: string;
  readonly filename?: string;
}

export interface ResourceReadResult {
  readonly uri: string;
  readonly filename?: string;
  readonly mediaType?: string;
  readonly text?: string;
  readonly error?: string;
}

export interface ResourceReader {
  registerResourceScheme(scheme: string, prompt: string, open: ResourceSchemeOpenHandler): () => void;
  read(uri: string, signal?: AbortSignal): Promise<ResourceReadResult>;
  /** Runtime-internal: open raw bytes for media projection without persisting them. */
  openBytes(uri: string, signal?: AbortSignal): Promise<ResourceOpenResult | undefined>;
}

interface ResourceReaderOptions {
  readonly scope: ChannelScope;
  readonly assets: AssetStore;
  readonly artifacts: ArtifactStore;
  readonly registrations: Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>;
  readonly config: Config;
}

export function createResourceReader(options: ResourceReaderOptions): ResourceReader {
  const { scope, assets, artifacts, registrations, config } = options;

  const registerResourceScheme = (scheme: string, prompt: string, open: ResourceSchemeOpenHandler): (() => void) => {
    if (scheme === "asset" || scheme === "artifact") {
      throw new Error(`Scheme "${scheme}" is reserved`);
    }
    if (registrations.has(scheme)) {
      throw new Error(`Scheme "${scheme}" is already registered`);
    }
    registrations.set(scheme, { prompt, open });
    return () => {
      registrations.delete(scheme);
    };
  };

  const read = async (uri: string, signal?: AbortSignal): Promise<ResourceReadResult> => {
    const parsed = parseUri(uri);
    if (!parsed) return { uri, error: "invalid_resource_uri" };

    const { scheme, authority, path } = parsed;
    if (scheme === "asset") {
      if (authority === "" || path !== "") return { uri, error: "invalid_resource_uri" };
      return readAsset(uri, authority);
    }
    if (scheme === "artifact") {
      if (authority === "" || path === "") return { uri, error: "invalid_resource_uri" };
      return readArtifact(uri, `${authority}/${path}`);
    }
    if (scheme === "workspace" && authority !== "") {
      return { uri, error: "invalid_resource_uri" };
    }
    if (path === "") return { uri, error: "invalid_resource_uri" };

    const registration = registrations.get(scheme);
    if (!registration) return { uri, error: "resource_unavailable" };
    return readRegistered(uri, registration.open, signal);
  };

  const readAsset = async (uri: string, id: string): Promise<ResourceReadResult> => {
    if (!/^[a-f0-9]{32}$/.test(id)) return { uri, error: "invalid_resource_uri" };
    try {
      const bytes = await assets.get(id);
      const mediaType = effectiveMediaType(bytes);
      return { uri, mediaType, text: describeBytes(bytes, mediaType) };
    } catch {
      return { uri, error: "resource_not_found" };
    }
  };

  const readArtifact = async (uri: string, path: string): Promise<ResourceReadResult> => {
    if (!/^[a-zA-Z0-9_-]+\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(path)) {
      return { uri, error: "invalid_resource_uri" };
    }
    try {
      const result = await artifacts.open(uri);
      const mediaType = effectiveMediaType(result.bytes, result.mediaType);
      return {
        uri,
        filename: result.filename,
        mediaType,
        text: describeBytes(result.bytes, mediaType),
      };
    } catch {
      return { uri, error: "resource_not_found" };
    }
  };

  const readRegistered = async (
    uri: string,
    open: ResourceSchemeOpenHandler,
    signal?: AbortSignal,
  ): Promise<ResourceReadResult> => {
    try {
      const result = await openWithDeadline(open, uri, signal);
      const mediaType = effectiveMediaType(result.bytes, result.mediaType);
      return {
        uri,
        filename: result.filename,
        mediaType,
        text: describeBytes(result.bytes, mediaType),
      };
    } catch (cause) {
      if (cause instanceof ResourceTimeoutError) return { uri, error: "timeout" };
      if (cause instanceof ResourceAbortedError) return { uri, error: "resource_read_aborted" };
      if (cause instanceof ResourceTooLargeError) return { uri, error: "resource_too_large" };
      return { uri, error: "resource_read_failed" };
    }
  };

  const openBytes = async (uri: string, signal?: AbortSignal): Promise<ResourceOpenResult | undefined> => {
    const parsed = parseUri(uri);
    if (!parsed) return undefined;
    const { scheme, authority, path } = parsed;
    try {
      if (scheme === "asset") {
        if (!/^[a-f0-9]{32}$/.test(authority) || path !== "") return undefined;
        return normalizeOpenResult({ bytes: await assets.get(authority) }, READ_MAX_BYTES);
      }
      if (scheme === "artifact") {
        if (authority === "" || path === "") return undefined;
        const result = await artifacts.open(uri);
        return normalizeOpenResult(result, READ_MAX_BYTES);
      }
      if (scheme === "workspace" && authority !== "") return undefined;
      if (path === "") return undefined;
      const registration = registrations.get(scheme);
      if (!registration) return undefined;
      return await openWithDeadline(registration.open, uri, signal);
    } catch {
      return undefined;
    }
  };

  return { registerResourceScheme, read, openBytes };

  async function openWithDeadline(
    open: ResourceSchemeOpenHandler,
    uri: string,
    signal?: AbortSignal,
  ): Promise<ResourceOpenResult> {
    const controller = new AbortController();
    let rejectDeadline!: (reason?: unknown) => void;
    const deadline = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject;
    });
    let rejectCancelled!: (reason?: unknown) => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectCancelled = reject;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (signal?.aborted) throw new ResourceAbortedError();
    let externalAbort = false;
    const onAbort = () => {
      externalAbort = true;
      controller.abort(signal?.reason);
      rejectCancelled(new ResourceAbortedError());
    };

    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      rejectDeadline(new ResourceTimeoutError());
    }, config.resourceReadTimeoutMs);

    try {
      const result = await Promise.race([
        open(scope, uri, { signal: controller.signal, maxBytes: READ_MAX_BYTES }),
        deadline,
        cancelled,
      ]);
      return normalizeOpenResult(result, READ_MAX_BYTES);
    } catch (cause) {
      if (externalAbort && !(cause instanceof ResourceTimeoutError)) throw new ResourceAbortedError();
      throw cause;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

/** ponytail: fixed 5 MiB read cap shared by every registered opener; per-scheme caps when a need appears. */
const READ_MAX_BYTES = 5 * 1024 * 1024;

function describeBytes(bytes: Uint8Array, mediaType: string | undefined): string {
  const detected = detectMediaType(bytes);
  if (detected) return `[图片资源，${detected}，${formatBytes(bytes.byteLength)}]`;
  if (isReadableText(bytes)) {
    const text = new TextDecoder().decode(bytes);
    if (text.length <= READ_MAX_TEXT_CHARS) return text;
    const marker = "\n[内容已截断]";
    return `${text.slice(0, READ_MAX_TEXT_CHARS - marker.length)}${marker}`;
  }
  return `[资源，${mediaType ?? "未知类型"}，${formatBytes(bytes.byteLength)}]`;
}

const READ_MAX_TEXT_CHARS = 30_000;

function isReadableText(bytes: Uint8Array): boolean {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return decoded.length > 0 && decoded.includes("\uFFFD") === false;
  } catch {
    return false;
  }
}

function formatBytes(length: number): string {
  if (length >= 1024 * 1024) return `${(length / (1024 * 1024)).toFixed(1)} MiB`;
  if (length >= 1024) return `${(length / 1024).toFixed(1)} KiB`;
  return `${length} B`;
}

function normalizeOpenResult(value: unknown, maxBytes: number): ResourceOpenResult {
  if (!value || typeof value !== "object" || !("bytes" in value)) throw new Error("Invalid resource result");
  const result = value as { bytes?: unknown; mediaType?: unknown; filename?: unknown };
  if (!(result.bytes instanceof Uint8Array)) throw new Error("Invalid resource bytes");
  if (result.bytes.byteLength > maxBytes) throw new ResourceTooLargeError();
  if (
    result.mediaType !== undefined &&
    (typeof result.mediaType !== "string" || !SAFE_MEDIA_TYPE.test(result.mediaType))
  ) {
    throw new Error("Invalid resource media type");
  }
  if (result.filename !== undefined && (typeof result.filename !== "string" || !isSafeBasename(result.filename))) {
    throw new Error("Invalid resource filename");
  }
  return {
    bytes: result.bytes,
    ...(result.mediaType === undefined ? {} : { mediaType: result.mediaType }),
    ...(result.filename === undefined ? {} : { filename: result.filename }),
  };
}

function effectiveMediaType(bytes: Uint8Array, hint?: string): string | undefined {
  const detected = detectMediaType(bytes);
  if (detected) return detected;
  return hint?.startsWith("image/") ? undefined : hint;
}

function isSafeBasename(filename: string): boolean {
  return filename.length > 0 && filename !== "." && filename !== ".." && !/[\\/\0]/.test(filename);
}

const SAFE_MEDIA_TYPE = /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/;

class ResourceTimeoutError extends Error {}
class ResourceAbortedError extends Error {}
class ResourceTooLargeError extends Error {}

function parseUri(uri: string): { scheme: string; authority: string; path: string } | undefined {
  const match = uri.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)(?:\/([^?#]*))?$/);
  if (!match) return undefined;
  const scheme = match[1]!.toLowerCase();
  const authority = match[2] ?? "";
  const rawPath = match[3] ?? "";
  if (
    uri.includes("?") ||
    uri.includes("#") ||
    authority.includes("@") ||
    authority.includes(":") ||
    rawPath.includes("%") ||
    rawPath.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return undefined;
  }
  return { scheme, authority, path: rawPath };
}

export function createReadProjectionPlugin(
  reader: ResourceReader,
  imageCapable: boolean,
  imageBudget: ImageBudget | null,
): AgentPlugin {
  return {
    name: "core.read-projection",
    enforce: "post",
    prepareStep: async (messages, context) => {
      if (!imageCapable || !imageBudget) return messages;
      const message = messages.at(-1);
      if (!message || message.role !== "tool" || !Array.isArray(message.content)) return messages;
      const part = message.content.at(-1);
      if (!part || part.type !== "tool-result" || part.toolName !== "read") return messages;
      const result = unwrapReadResult(part.output);
      if (!result || result.error || !result.uri) return messages;

      const opened = await reader.openBytes(result.uri, context.signal);
      if (!opened) return messages;
      const mediaType = detectMediaType(opened.bytes);
      if (!mediaType) return messages;
      if (
        opened.bytes.byteLength > imageBudget.maxBytesPerImage ||
        opened.bytes.byteLength > imageBudget.maxTotalBytes ||
        imageBudget.maxCount < 1
      ) {
        return messages;
      }
      const file: FilePart = { type: "file", data: opened.bytes, mediaType };
      return [...messages, { role: "user", content: [file] }];
    },
  };
}

function unwrapReadResult(output: unknown): ResourceReadResult | undefined {
  if (!output || typeof output !== "object") return undefined;
  let value: unknown = output;
  if ("type" in output && output.type === "json" && "value" in output) value = output.value;
  if (!value || typeof value !== "object" || !("uri" in value)) return undefined;
  const result = value as { uri?: unknown; filename?: unknown; mediaType?: unknown; text?: unknown; error?: unknown };
  if (typeof result.uri !== "string") return undefined;
  return {
    uri: result.uri,
    ...(typeof result.filename === "string" ? { filename: result.filename } : {}),
    ...(typeof result.mediaType === "string" ? { mediaType: result.mediaType } : {}),
    ...(typeof result.text === "string" ? { text: result.text } : {}),
    ...(typeof result.error === "string" ? { error: result.error } : {}),
  };
}

export function detectMediaType(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return undefined;
}
