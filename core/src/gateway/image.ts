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
  const waiting: Array<{ grant(): boolean }> = [];

  async function storeImage(
    data: Uint8Array,
    _mime: string | undefined,
    reserved: boolean,
  ): Promise<Element> {
    if (!reserved) imageCount += 1;
    if (
      imageCount > IMAGE_BUDGET.maxImages ||
      !(data instanceof Uint8Array) ||
      data.byteLength > IMAGE_BUDGET.maxBytesPerImage ||
      totalBytes + data.byteLength > IMAGE_BUDGET.maxTotalBytes
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
    load: (signal: AbortSignal, maxBytes: number) => Promise<{ data: Uint8Array; mime?: string }>,
  ): Promise<Element> {
    const normalized = normalizeElements([element])[0];
    if (!normalized) return unavailableImage();
    if (normalized.type === "quote" || normalized.type === "forward") return normalized;
    if (normalized.type !== "img" || typeof normalized.attrs.src !== "string") return normalized;
    if (imageCount >= IMAGE_BUDGET.maxImages) return unavailableImage();
    imageCount += 1;

    const controller = new AbortController();
    let permit: ReturnType<typeof acquire> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        controller.abort(new DOMException("Image download timed out", "TimeoutError"));
        permit?.cancel();
        resolve("timeout");
      }, IMAGE_BUDGET.timeoutMs);
    });
    permit = acquire();
    let releaseWhenSettled = true;
    let holdsPermit = false;
    try {
      const acquired = await Promise.race([permit.promise, deadline]);
      if (acquired !== true) return unavailableImage();
      holdsPermit = true;
      const maxBytes = Math.min(
        IMAGE_BUDGET.maxBytesPerImage,
        IMAGE_BUDGET.maxTotalBytes - totalBytes,
      );
      const loaded = Promise.resolve().then(() => load(controller.signal, maxBytes));
      try {
        const result = await Promise.race([loaded, deadline]);
        if (result === "timeout") {
          releaseWhenSettled = false;
          void loaded.then(release, release);
          return unavailableImage();
        }
        const { data, mime } = result;
        return await storeImage(data, mime, true);
      } catch {
        return unavailableImage();
      }
    } finally {
      if (timer) clearTimeout(timer);
      if (holdsPermit && releaseWhenSettled) release();
    }
  }

  function acquire(): { promise: Promise<boolean>; cancel(): void } {
    if (active < IMAGE_BUDGET.concurrency) {
      active += 1;
      return { promise: Promise.resolve(true), cancel() {} };
    }
    let settled = false;
    let resolve!: (granted: boolean) => void;
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

  return { putImage, freezeImage };
}
