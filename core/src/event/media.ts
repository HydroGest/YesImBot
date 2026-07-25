import type { ModelMessageContext } from "@yesimbot/agent-runtime";
import type { FilePart } from "ai";
import { h, type Element } from "koishi";

import type { ChannelScope } from "../channel/index.js";
import type { AssetStore } from "../shared/asset.js";
import { detectImageMime } from "../shared/image-mime.js";
import { isInput, type Input } from "./index.js";

export interface MediaSelectionPolicy {
  readonly enabled: boolean;
  readonly maxImages: number;
  readonly maxImageBytes: number;
  readonly maxTotalImageBytes: number;
  readonly strategy: "current-first" | "fifo" | "lifo";
}

export interface MediaSelectionOptions {
  readonly scope: ChannelScope;
  readonly assetStore: Pick<AssetStore, "readByAssetId">;
  readonly imageInput: boolean;
  readonly policy: MediaSelectionPolicy;
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
  }
}

function inputSources(
  context: ModelMessageContext,
  strategy: MediaSelectionPolicy["strategy"],
): Input[] {
  const history = context.history.filter(isInput);
  const current = context.current.filter(isInput);

  switch (strategy) {
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
    if (element.type === "img" && typeof element.attrs.id === "string") {
      assetIds.push(element.attrs.id);
    }
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

  for (const input of inputSources(context, options.policy.strategy)) {
    const files: FilePart[] = [];
    for (const assetId of imageAssetIds(input.data.text)) {
      if (
        imageCount >= options.policy.maxImages ||
        totalBytes >= options.policy.maxTotalImageBytes
      ) {
        if (files.length > 0) selected.set(input.id, files);
        return selected;
      }

      let data: Uint8Array;
      try {
        data = await options.assetStore.readByAssetId(options.scope, assetId);
      } catch (cause) {
        reportAssetFailure(options, assetId, cause);
        continue;
      }

      const mediaType = detectImageMime(data);
      if (mediaType === undefined) {
        reportAssetFailure(options, assetId, new UnsupportedImageMimeError());
        continue;
      }
      if (
        data.byteLength > options.policy.maxImageBytes ||
        data.byteLength > options.policy.maxTotalImageBytes - totalBytes
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
