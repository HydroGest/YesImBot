import type { ModelMessageContext } from "@yesimbot/agent-runtime";
import type { FilePart } from "ai";
import type { Element } from "koishi";

import type { AssetStore } from "../asset.js";
import { isInput, isMessage, type Input } from "../input.js";

const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

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

export interface MediaSelectionOptions {
  readonly assetStore: Pick<AssetStore, "get">;
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

export async function selectInputFiles(
  context: ModelMessageContext,
  options: MediaSelectionOptions,
): Promise<ReadonlyMap<Input["id"], readonly FilePart[]>> {
  if (!options.policy.enabled || !options.imageInput) return new Map();

  const selected = new Map<Input["id"], readonly FilePart[]>();
  let imageCount = 0;
  let totalBytes = 0;

  for (const input of inputSources(context, options.policy.selection)) {
    if (!isMessage(input)) continue;
    const files: FilePart[] = [];
    const assetIds: string[] = [];
    collectAssetIds(input.data.elements, assetIds);
    for (const assetId of assetIds) {
      if (imageCount >= options.policy.maxCount || totalBytes >= options.policy.maxTotalBytes) {
        if (files.length > 0) selected.set(input.id, files);
        return selected;
      }

      let data: Uint8Array;
      try {
        data = await options.assetStore.get(assetId);
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
