import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ModelMessageContext } from "@yesimbot/agent-runtime";
import type { FilePart } from "ai";
import { h, type Element } from "koishi";

import type { ChannelScope } from "../channel/index.js";
import { normalizeElements, unavailableImage } from "../event/element.js";
import { isInput, type Input } from "../event/index.js";
import type { ChannelStorage } from "../storage/index.js";

const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 10_000;
const IMAGE_DOWNLOAD_CONCURRENCY = 2;

export type ImageMime = (typeof IMAGE_MIME_TYPES)[number];

export interface UnifiedImagePolicy {
  readonly enabled: boolean;
  readonly maxCount: number;
  readonly maxBytesPerImage: number;
  readonly maxTotalBytes: number;
  readonly selection: "current-first" | "fifo" | "lifo";
}

export function detectImageMime(data: Uint8Array): ImageMime | undefined {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    data.length >= 6 &&
    data[0] === 0x47 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x38 &&
    (data[4] === 0x37 || data[4] === 0x39) &&
    data[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return "image/webp";
  }
  return undefined;
}

export interface AssetStoreOptions {
  readonly storage: ChannelStorage;
  readonly policy: UnifiedImagePolicy;
}

export class AssetStore {
  private policy: UnifiedImagePolicy;

  constructor(private readonly options: AssetStoreOptions) {
    this.policy = options.policy;
  }

  refreshPolicy(policy: UnifiedImagePolicy): void {
    this.policy = policy;
  }

  async put(
    scope: ChannelScope,
    data: Uint8Array,
  ): Promise<{ readonly assetId: string; readonly mime: ImageMime }> {
    if (!(data instanceof Uint8Array)) throw new Error("Asset data must be bytes");
    const mime = detectImageMime(data);
    if (!mime) throw new Error("Unsupported image MIME type");
    if (data.byteLength > this.policy.maxBytesPerImage) {
      throw new Error(`Image exceeds ${this.policy.maxBytesPerImage} bytes`);
    }

    const copied = data.slice();
    const hash = createHash("sha256").update(copied).digest("hex");
    const path = await this.assetPath(scope, hash);
    const temporary = join(dirname(path), `.${hash}.${randomUUID()}.tmp`);
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(temporary, copied, { flag: "wx" });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }

    return { assetId: `asset_${hash}`, mime };
  }

  async readByAssetId(scope: ChannelScope, assetId: string): Promise<Uint8Array> {
    const hash = assetId.startsWith("asset_") ? assetId.slice("asset_".length) : "";
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid platform asset id");

    const data = new Uint8Array(await readFile(await this.assetPath(scope, hash)));
    const actual = createHash("sha256").update(data).digest("hex");
    if (actual !== hash) throw new Error(`Platform asset ${assetId} failed integrity validation`);
    return data;
  }

  async clear(scope: ChannelScope): Promise<void> {
    await rm(await this.assetPath(scope), { recursive: true, force: true });
  }

  private async assetPath(scope: ChannelScope, hash?: string): Promise<string> {
    return hash
      ? this.options.storage.ensure(scope, "assets", hash)
      : this.options.storage.ensure(scope, "assets");
  }
}

export interface ImageFreezerOptions {
  readonly scope: ChannelScope;
  readonly assets: Pick<AssetStore, "put">;
  readonly policy: UnifiedImagePolicy;
}

export function createImageFreezer(options: ImageFreezerOptions) {
  let imageCount = 0;
  let totalBytes = 0;
  let active = 0;
  const waiting: Array<{ grant(): boolean }> = [];

  async function storeImage(data: Uint8Array, reserved: boolean): Promise<Element> {
    if (!reserved) imageCount += 1;
    if (
      imageCount > options.policy.maxCount ||
      !(data instanceof Uint8Array) ||
      data.byteLength > options.policy.maxBytesPerImage ||
      totalBytes + data.byteLength > options.policy.maxTotalBytes
    ) {
      return unavailableImage();
    }

    totalBytes += data.byteLength;
    try {
      const asset = await options.assets.put(options.scope, data);
      return h("img", { id: asset.assetId, mime: asset.mime });
    } catch {
      return unavailableImage();
    }
  }

  async function freezeImage(
    element: Element,
    load: (signal: AbortSignal, maxBytes: number) => Promise<{ data: Uint8Array; mime?: string }>,
  ): Promise<Element> {
    const normalized = normalizeElements([element])[0];
    if (!normalized) return unavailableImage();
    if (normalized.type === "quote" || normalized.type === "forward") return normalized;
    if (normalized.type !== "img" || typeof normalized.attrs.src !== "string") return normalized;
    if (imageCount >= options.policy.maxCount) return unavailableImage();
    imageCount += 1;

    const controller = new AbortController();
    let permit: ReturnType<typeof acquire> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        controller.abort(new DOMException("Image download timed out", "TimeoutError"));
        permit?.cancel();
        resolve("timeout");
      }, IMAGE_DOWNLOAD_TIMEOUT_MS);
    });
    permit = acquire();
    let releaseWhenSettled = true;
    let holdsPermit = false;
    try {
      const acquired = await Promise.race([permit.promise, deadline]);
      if (acquired !== true) return unavailableImage();
      holdsPermit = true;
      const maxBytes = Math.min(
        options.policy.maxBytesPerImage,
        options.policy.maxTotalBytes - totalBytes,
      );
      const loaded = Promise.resolve().then(() => load(controller.signal, maxBytes));
      try {
        const result = await Promise.race([loaded, deadline]);
        if (result === "timeout") {
          releaseWhenSettled = false;
          void loaded.then(release, release);
          return unavailableImage();
        }
        return await storeImage(result.data, true);
      } catch {
        return unavailableImage();
      }
    } finally {
      if (timer) clearTimeout(timer);
      if (holdsPermit && releaseWhenSettled) release();
    }
  }

  function acquire(): { readonly promise: Promise<boolean>; cancel(): void } {
    if (active < IMAGE_DOWNLOAD_CONCURRENCY) {
      active += 1;
      return { promise: Promise.resolve(true), cancel() {} };
    }
    let settled = false;
    let resolve: (granted: boolean) => void = () => undefined;
    const waiter = {
      grant: () => {
        if (settled) return false;
        settled = true;
        active += 1;
        resolve(true);
        return true;
      },
    };
    const promise = new Promise<boolean>((next) => {
      resolve = next;
    });
    waiting.push(waiter);
    return {
      promise,
      cancel() {
        if (settled) return;
        settled = true;
        const index = waiting.indexOf(waiter);
        if (index >= 0) waiting.splice(index, 1);
        resolve(false);
      },
    };
  }

  function release(): void {
    active -= 1;
    while (waiting.shift()?.grant() !== true && waiting.length > 0) {}
  }

  return { freezeImage };
}

export interface MediaSelectionOptions {
  readonly scope: ChannelScope;
  readonly assetStore: Pick<AssetStore, "readByAssetId">;
  readonly imageInput: boolean;
  readonly policy: UnifiedImagePolicy;
  readonly onAssetFailure?: (assetId: string, cause: unknown) => void;
}

export class UnsupportedImageMimeError extends Error {
  readonly name = "UnsupportedImageMimeError";

  constructor() {
    super("Stored asset bytes do not match an allowed image MIME type");
  }
}

function reportAssetFailure(options: MediaSelectionOptions, assetId: string, cause: unknown): void {
  try {
    options.onAssetFailure?.(assetId, cause);
  } catch (diagnosticFailure) {
    if (diagnosticFailure instanceof Error) return;
    return;
  }
}

function inputSources(
  context: ModelMessageContext,
  selection: UnifiedImagePolicy["selection"],
): Input[] {
  const history = context.history.filter(isInput);
  const current = context.current.filter(isInput);

  switch (selection) {
    case "current-first":
      return [...current, ...history];
    case "fifo":
      return [...history, ...current];
    case "lifo":
      return [...history, ...current].reverse();
  }
}

function collectAssetIds(elements: readonly Element[], assetIds: string[]): void {
  for (const element of elements) {
    if (element.type === "img" && typeof element.attrs.id === "string")
      assetIds.push(element.attrs.id);
    collectAssetIds(element.children, assetIds);
  }
}

function imageAssetIds(content: string | undefined): readonly string[] {
  const assetIds: string[] = [];
  collectAssetIds(h.normalize(`${content ?? ""}`), assetIds);
  return assetIds;
}

export async function selectInputFiles(
  context: ModelMessageContext,
  options: MediaSelectionOptions,
): Promise<ReadonlyMap<Input["id"], readonly FilePart[]>> {
  if (!options.policy.enabled || !options.imageInput) return new Map();

  const selected = new Map<Input["id"], readonly FilePart[]>();
  let imageCount = 0;
  let totalBytes = 0;

  for (const input of inputSources(context, options.policy.selection)) {
    const files: FilePart[] = [];
    for (const assetId of imageAssetIds(input.data.text)) {
      if (imageCount >= options.policy.maxCount || totalBytes >= options.policy.maxTotalBytes) {
        if (files.length > 0) selected.set(input.id, files);
        return selected;
      }

      let data: Uint8Array;
      try {
        data = await options.assetStore.readByAssetId(options.scope, assetId);
      } catch (cause) {
        if (cause instanceof Error) reportAssetFailure(options, assetId, cause);
        else reportAssetFailure(options, assetId, cause);
        continue;
      }

      const mediaType = detectImageMime(data);
      if (mediaType === undefined) {
        reportAssetFailure(options, assetId, new UnsupportedImageMimeError());
        continue;
      }
      if (
        data.byteLength > options.policy.maxBytesPerImage ||
        data.byteLength > options.policy.maxTotalBytes - totalBytes
      ) {
        continue;
      }

      files.push({ type: "file", data, mediaType });
      imageCount += 1;
      totalBytes += data.byteLength;
    }
    if (files.length > 0) selected.set(input.id, files);
  }

  return selected;
}
