import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h, type Element } from "koishi";
import type { Platform } from "koishi-plugin-yesimbot/platform";

import { prepareOneBotMessage } from "../src/prepare.js";

const PNG_1X1 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

const budget = {
  maxImages: 4,
  maxBytesPerImage: 5 * 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
  timeoutMs: 10_000,
  concurrency: 2,
  allowedMime: ["image/jpeg", "image/png", "image/webp", "image/gif"],
} satisfies Platform.ImageBudget;

function byteStream(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve: (value?: T) => resolve(value as T) };
}

function pngBytes(size: number, marker: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(PNG_1X1.subarray(0, 8));
  if (size > 8) bytes[8] = marker;
  return bytes;
}

function remoteImage(id: string): Element {
  return h("img", { src: `https://example.com/${id}.png` });
}

function dataImage(bytes: Uint8Array): Element {
  return h("img", { src: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}` });
}

function message(elements: Element[]): Platform.Message {
  return {
    source: { platform: "onebot", selfId: "bot" },
    scope: { type: "channel", channelId: "room" },
    sender: { id: "user" },
    messageId: "m1",
    receivedAt: 1,
    elements,
  };
}

function mockCtx(): { ctx: unknown; httpGet: ReturnType<typeof vi.fn> } {
  const httpGet = vi.fn();
  return { ctx: { http: { get: httpGet } }, httpGet };
}

function createSink(): Platform.ImagePrepareSink & { put: ReturnType<typeof vi.fn> } {
  return {
    put: vi.fn(async (_bytes: Uint8Array) => ({ assetId: "asset_abc", mime: "image/png" })),
  };
}

describe("prepareOneBotMessage", () => {
  async function prepare(
    ctx: unknown,
    images: Platform.ImagePrepareSink,
    input: Platform.Message,
    imageBudget = budget,
  ): Promise<Element[]> {
    return prepareOneBotMessage(ctx as never, {
      session: {} as never,
      message: input,
      images,
      budget: imageBudget,
    });
  }

  it("returns elements unchanged when there are no images", async () => {
    const { ctx } = mockCtx();
    const elements = [h.text("hello")];
    expect(await prepare(ctx, createSink(), message(elements))).toEqual(elements);
  });

  it("prepares an image nested in a paragraph", async () => {
    const { ctx, httpGet } = mockCtx();
    const images = createSink();
    httpGet.mockResolvedValue(byteStream(PNG_1X1));

    const result = await prepare(
      ctx,
      images,
      message([h("p", {}, [h.text("before"), remoteImage("nested"), h.text("after")])]),
    );

    expect(result[0].children[1].attrs).toEqual({ id: "asset_abc", mime: "image/png" });
  });

  it("never requests a fifth image", async () => {
    const { ctx, httpGet } = mockCtx();
    httpGet.mockResolvedValue(byteStream(PNG_1X1));

    const result = await prepare(
      ctx,
      createSink(),
      message(Array.from({ length: 5 }, (_, index) => remoteImage(String(index)))),
    );

    expect(httpGet).toHaveBeenCalledTimes(4);
    expect(result[4].attrs).toEqual({ unavailable: "true" });
  });

  it("counts every image node before admitting remote sources", async () => {
    const { ctx, httpGet } = mockCtx();

    const result = await prepare(
      ctx,
      createSink(),
      message([
        h("img", { id: "asset_local", mime: "image/png" }),
        h("img", { unavailable: "true" }),
        h("image"),
        remoteImage("eligible"),
        remoteImage("fifth"),
      ]),
    );

    expect(httpGet).toHaveBeenCalledTimes(1);
    expect(httpGet).toHaveBeenCalledWith("https://example.com/eligible.png", expect.any(Object));
    expect(result[4].attrs).toEqual({ unavailable: "true" });
  });

  it("never exceeds two concurrent downloads", async () => {
    const { ctx, httpGet } = mockCtx();
    const releases = Array.from({ length: 4 }, () => deferred<void>());
    let active = 0;
    let maxActive = 0;
    let request = 0;
    httpGet.mockImplementation(async () => {
      const current = request++;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await releases[current].promise;
      active -= 1;
      return byteStream(PNG_1X1);
    });

    const pending = prepare(
      ctx,
      createSink(),
      message(Array.from({ length: 4 }, (_, index) => remoteImage(String(index)))),
    );
    await vi.waitFor(() => expect(httpGet).toHaveBeenCalledTimes(2));
    releases[0].resolve();
    releases[1].resolve();
    await vi.waitFor(() => expect(httpGet).toHaveBeenCalledTimes(4));
    releases[2].resolve();
    releases[3].resolve();
    await pending;

    expect(maxActive).toBe(2);
  });

  it("admits concurrent downloads to the total budget in source order", async () => {
    const { ctx, httpGet } = mockCtx();
    const images = createSink();
    const first = pngBytes(5 * 1024 * 1024, 1);
    const second = pngBytes(5 * 1024 * 1024, 2);
    const third = pngBytes(5 * 1024 * 1024, 3);
    const responses = Array.from({ length: 3 }, () => deferred<ReadableStream<Uint8Array>>());
    let request = 0;
    httpGet.mockImplementation(() => responses[request++].promise);

    const pending = prepare(
      ctx,
      images,
      message([remoteImage("first"), remoteImage("second"), remoteImage("third")]),
    );
    await vi.waitFor(() => expect(httpGet).toHaveBeenCalledTimes(2));
    responses[1].resolve(byteStream(second));
    responses[0].resolve(byteStream(first));
    await vi.waitFor(() => expect(httpGet).toHaveBeenCalledTimes(3));
    responses[2].resolve(byteStream(third));

    const result = await pending;
    expect(images.put.mock.calls.map(([bytes]) => bytes[8])).toEqual([1, 2]);
    expect(result[2].attrs).toEqual({ unavailable: "true" });
  });

  it("cancels a response that exceeds the per-image byte limit", async () => {
    const { ctx, httpGet } = mockCtx();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(budget.maxBytesPerImage + 1));
      },
      cancel,
    });
    httpGet.mockResolvedValue(stream);

    const result = await prepare(ctx, createSink(), message([remoteImage("large")]));

    expect(cancel).toHaveBeenCalled();
    expect(result[0].attrs).toEqual({ unavailable: "true" });
  });

  it("rejects oversized data before decoding it or using HTTP", async () => {
    const { ctx, httpGet } = mockCtx();
    const images = createSink();
    const smallBudget = { ...budget, maxBytesPerImage: 12, maxTotalBytes: 24 };
    const source = `data:image/png;base64,${"A".repeat(smallBudget.maxBytesPerImage * 4 + 1)}`;

    const result = await prepare(ctx, images, message([h("img", { src: source })]), smallBudget);

    expect(httpGet).not.toHaveBeenCalled();
    expect(images.put).not.toHaveBeenCalled();
    expect(result[0].attrs).toEqual({ unavailable: "true" });
  });

  it("rejects an oversized decoded data image", async () => {
    const { ctx } = mockCtx();
    const smallBudget = { ...budget, maxBytesPerImage: 12, maxTotalBytes: 24 };

    const result = await prepare(
      ctx,
      createSink(),
      message([dataImage(pngBytes(13, 1))]),
      smallBudget,
    );

    expect(result[0].attrs).toEqual({ unavailable: "true" });
  });

  it("aborts the HTTP request on timeout", async () => {
    vi.useFakeTimers();
    try {
      const { ctx, httpGet } = mockCtx();
      let signal: AbortSignal | undefined;
      httpGet.mockImplementation((_url: string, config: { signal: AbortSignal }) => {
        signal = config.signal;
        return new Promise((_resolve, reject) => {
          config.signal.addEventListener("abort", () => reject(config.signal.reason));
        });
      });

      const pending = prepare(ctx, createSink(), message([remoteImage("slow")]));
      await vi.advanceTimersByTimeAsync(budget.timeoutMs);
      await pending;

      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks a signature mismatch unavailable after the core sink rejects it", async () => {
    const { ctx, httpGet } = mockCtx();
    const images = createSink();
    images.put.mockRejectedValue(new Error("Unsupported image MIME type"));
    httpGet.mockResolvedValue(byteStream(new TextEncoder().encode("not an image")));

    const result = await prepare(ctx, images, message([remoteImage("spoofed")]));

    expect(images.put).toHaveBeenCalledOnce();
    expect(result[0].attrs).toEqual({ unavailable: "true" });
  });

  it("does not expand forwards during preparation", async () => {
    const { ctx } = mockCtx();
    const result = await prepare(
      ctx,
      createSink(),
      message([h("forward", { id: "f", summary: "s" })]),
    );
    expect(result[0].type).toBe("forward");
  });
});
