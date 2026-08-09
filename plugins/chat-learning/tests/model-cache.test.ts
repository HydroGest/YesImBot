import { describe, expect, it, vi } from "vitest";

import { ModelCache } from "../src/model-cache.js";

describe("ModelCache", () => {
  it("reuses a successful result for the same key", async () => {
    const cache = new ModelCache();
    const produce = vi.fn(async () => "result");
    const key = cache.key(["op", 1]);

    await expect(cache.getOrProduce(key, produce)).resolves.toBe("result");
    await expect(cache.getOrProduce(key, produce)).resolves.toBe("result");
    expect(produce).toHaveBeenCalledOnce();
  });

  it("does not cache undefined results", async () => {
    const cache = new ModelCache();
    const produce = vi.fn(async () => undefined);
    const key = cache.key(["op", 2]);

    await expect(cache.getOrProduce(key, produce)).resolves.toBeUndefined();
    await expect(cache.getOrProduce(key, produce)).resolves.toBeUndefined();
    expect(produce).toHaveBeenCalledTimes(2);
  });

  it("clears all cached entries", async () => {
    const cache = new ModelCache();
    const produce = vi.fn(async () => "result");
    const key = cache.key(["op", 3]);

    await cache.getOrProduce(key, produce);
    cache.clear();
    await cache.getOrProduce(key, produce);
    expect(produce).toHaveBeenCalledTimes(2);
  });
});
