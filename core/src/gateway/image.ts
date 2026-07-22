import { h, type Element } from "koishi";

import type { ChannelScope } from "../channel/index.js";
import { normalizeElements, unavailableImage } from "../shared/element.js";

export const IMAGE_BUDGET = {
  maxImages: 4,
  maxBytesPerImage: 5 * 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
  timeoutMs: 10_000,
  concurrency: 2,
  allowedMime: new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]),
} as const;

export interface ImageFreezerOptions {
  readonly scope: ChannelScope;
  readonly assets: {
    put(scope: ChannelScope, data: Uint8Array): Promise<{ assetId: string; mime: string }>;
  };
}

export function createImageFreezer(options: ImageFreezerOptions) {
  let imageCount = 0;
  let totalBytes = 0;
  let active = 0;
  const waiting: Array<() => void> = [];

  async function storeImage(data: Uint8Array, mime: string | undefined, reserved: boolean): Promise<Element> {
    if (!reserved) imageCount += 1;
    if (
      imageCount > IMAGE_BUDGET.maxImages ||
      !(data instanceof Uint8Array) ||
      data.byteLength > IMAGE_BUDGET.maxBytesPerImage ||
      totalBytes + data.byteLength > IMAGE_BUDGET.maxTotalBytes ||
      !mime ||
      !IMAGE_BUDGET.allowedMime.has(mime as never)
    ) {
      return unavailableImage();
    }

    totalBytes += data.byteLength;
    try {
      const asset = await options.assets.put(options.scope, data);
      if (!IMAGE_BUDGET.allowedMime.has(asset.mime as never)) return unavailableImage();
      return h("img", { id: asset.assetId, mime: asset.mime });
    } catch {
      return unavailableImage();
    }
  }

  async function putImage(data: Uint8Array, mime?: string): Promise<Element> {
    return storeImage(data, mime, false);
  }

  async function freezeImage(
    element: Element,
    load: (signal: AbortSignal) => Promise<{ data: Uint8Array; mime?: string }>,
  ): Promise<Element> {
    const normalized = normalizeElements([element])[0];
    if (!normalized) return unavailableImage();
    if (normalized.type === "quote" || normalized.type === "forward") return normalized;
    if (normalized.type !== "img" || typeof normalized.attrs.src !== "string") return normalized;
    if (imageCount >= IMAGE_BUDGET.maxImages) return unavailableImage();
    imageCount += 1;

    await acquire();
    try {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort(new DOMException("Image download timed out", "TimeoutError"));
            reject(controller.signal.reason);
          }, IMAGE_BUDGET.timeoutMs);
        });
        const { data, mime } = await Promise.race([load(controller.signal), timeout]);
        return await storeImage(data, mime, true);
      } catch {
        return unavailableImage();
      } finally {
        if (timer) clearTimeout(timer);
      }
    } finally {
      release();
    }
  }

  async function acquire(): Promise<void> {
    if (active < IMAGE_BUDGET.concurrency) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
  }

  function release(): void {
    active -= 1;
    waiting.shift()?.();
  }

  return { putImage, freezeImage };
}
