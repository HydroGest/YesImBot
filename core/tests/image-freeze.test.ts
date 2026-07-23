import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h } from "koishi";

import { createImageFreezer } from "../src/gateway/image.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const scope = { platform: "test", selfId: "bot-1", channelId: "room-1", isDirect: false };

function freezer() {
  const assets = { put: vi.fn(async () => ({ assetId: "asset_image", mime: "image/png" })) };
  return { assets, ...createImageFreezer({ scope, assets }) };
}

describe("resolver image freezing", () => {
  it("stores a supported bounded image as a private asset reference", async () => {
    const { freezeImage, assets } = freezer();
    const load = vi.fn(async (_signal: AbortSignal, maxBytes: number) => ({
      data: PNG,
      mime: "image/png",
      maxBytes,
    }));
    await expect(
      freezeImage(h("img", { src: "https://example.test/a.png" }), load),
    ).resolves.toEqual(h("img", { id: "asset_image", mime: "image/png" }));
    expect(assets.put).toHaveBeenCalledWith(scope, PNG);
    expect(load).toHaveBeenCalledWith(expect.any(AbortSignal), 5 * 1024 * 1024);
  });

  it("seals images unavailable for count and byte limits while treating loader MIME as a hint", async () => {
    const { freezeImage } = freezer();
    const image = (index: number) => h("img", { src: `https://example.test/${index}.png` });
    for (let index = 0; index < 4; index += 1) {
      await freezeImage(image(index), async () => ({ data: PNG, mime: "image/png" }));
    }
    await expect(
      freezeImage(image(4), async () => ({ data: PNG, mime: "image/png" })),
    ).resolves.toEqual(h("img", { unavailable: "true" }));

    await expect(
      freezer().freezeImage(image(1), async () => ({
        data: new Uint8Array(5 * 1024 * 1024 + 1),
        mime: "image/png",
      })),
    ).resolves.toEqual(h("img", { unavailable: "true" }));
    const total = freezer();
    await total.freezeImage(image(1), async () => ({
      data: new Uint8Array(5 * 1024 * 1024),
      mime: "image/png",
    }));
    await total.freezeImage(image(2), async () => ({
      data: new Uint8Array(5 * 1024 * 1024),
      mime: "image/png",
    }));
    await expect(
      total.freezeImage(image(3), async () => ({ data: PNG, mime: "image/png" })),
    ).resolves.toEqual(h("img", { unavailable: "true" }));
    await expect(
      freezer().freezeImage(image(1), async () => ({ data: PNG, mime: "image/svg+xml" })),
    ).resolves.toEqual(h("img", { id: "asset_image", mime: "image/png" }));
  });

  it("limits loaders to two concurrent operations and seals timeout or loader failures", async () => {
    const { freezeImage } = freezer();
    let active = 0;
    let maximum = 0;
    const pending: Array<() => void> = [];
    const load = vi.fn(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => pending.push(resolve));
      active -= 1;
      return { data: PNG, mime: "image/png" };
    });
    const jobs = Array.from({ length: 3 }, (_, index) =>
      freezeImage(h("img", { src: String(index) }), load),
    );
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    pending.shift()?.();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    pending.shift()?.();
    pending.shift()?.();
    await Promise.all(jobs);
    expect(maximum).toBe(2);

    await expect(
      freezer().freezeImage(h("img", { src: "bad" }), async () => {
        throw new Error("offline");
      }),
    ).resolves.toEqual(h("img", { unavailable: "true" }));
  });

  it("reserves all four image slots before loading and aborts a timed-out loader", async () => {
    const { freezeImage } = freezer();
    const pending: Array<() => void> = [];
    const load = vi.fn(async () => {
      await new Promise<void>((resolve) => pending.push(resolve));
      return { data: PNG, mime: "image/png" };
    });
    const jobs = Array.from({ length: 5 }, (_, index) =>
      freezeImage(h("img", { src: String(index) }), load),
    );
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    pending.shift()?.();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    pending.shift()?.();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(4));
    pending.shift()?.();
    pending.shift()?.();
    const result = await Promise.all(jobs);
    expect(load).toHaveBeenCalledTimes(4);
    expect(result[4]).toEqual(h("img", { unavailable: "true" }));

    vi.useFakeTimers();
    const timeout = freezer().freezeImage(
      h("img", { src: "slow" }),
      (signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason)),
        ),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(timeout).resolves.toEqual(h("img", { unavailable: "true" }));
    vi.useRealTimers();
  });

  it("returns unavailable at the deadline when a loader ignores abort", async () => {
    vi.useFakeTimers();
    try {
      const result = freezer().freezeImage(
        h("img", { src: "ignored-signal" }),
        () => new Promise(() => {}),
      );

      await vi.advanceTimersByTimeAsync(10_000);

      await expect(result).resolves.toEqual(h("img", { unavailable: "true" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out queued calls without starting a third ignored-signal loader", async () => {
    vi.useFakeTimers();
    try {
      const { freezeImage } = freezer();
      let active = 0;
      let maximum = 0;
      const load = vi.fn(() => {
        active += 1;
        maximum = Math.max(maximum, active);
        return new Promise<{ data: Uint8Array; mime?: string }>(() => {});
      });
      const first = freezeImage(h("img", { src: "first" }), load);
      const second = freezeImage(h("img", { src: "second" }), load);
      const third = freezeImage(h("img", { src: "third" }), load);

      await vi.advanceTimersByTimeAsync(10_000);

      await expect(first).resolves.toEqual(h("img", { unavailable: "true" }));
      await expect(second).resolves.toEqual(h("img", { unavailable: "true" }));
      await expect(third).resolves.toEqual(h("img", { unavailable: "true" }));
      expect(load).toHaveBeenCalledTimes(2);
      expect(maximum).toBe(2);
      expect(active).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts a queued loader after aborted signal-aware loaders settle", async () => {
    vi.useFakeTimers();
    try {
      const { freezeImage } = freezer();
      const resolvers: Array<() => void> = [];
      const load = vi.fn(
        (signal: AbortSignal) =>
          new Promise<{ data: Uint8Array; mime?: string }>((resolve, reject) => {
            resolvers.push(() => resolve({ data: PNG, mime: "image/png" }));
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
      );
      const first = freezeImage(h("img", { src: "first" }), load);
      const second = freezeImage(h("img", { src: "second" }), load);

      await vi.advanceTimersByTimeAsync(9_000);
      const third = freezeImage(h("img", { src: "third" }), load);
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(3));
      resolvers[2]?.();

      await expect(first).resolves.toEqual(h("img", { unavailable: "true" }));
      await expect(second).resolves.toEqual(h("img", { unavailable: "true" }));
      await expect(third).resolves.toEqual(h("img", { id: "asset_image", mime: "image/png" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("normalizes and seals quote and forward forms without invoking a loader", async () => {
    const { freezeImage } = freezer();
    const never = vi.fn(async () => ({ data: PNG, mime: "image/png" }));
    await expect(freezeImage(h("quote", { id: "q-1" }), never)).resolves.toEqual(
      h("quote", { id: "q-1" }),
    );
    await expect(freezeImage(h("forward", { id: "f-1" }), never)).resolves.toEqual(
      h("forward", { id: "f-1", summary: "[合并转发] 使用 onebot_get_forward_message 查看详情" }),
    );
    expect(never).not.toHaveBeenCalled();
  });
});
