import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Context } from "koishi";
import { afterEach, beforeEach, vi } from "vitest";

import { ChannelStorage } from "../../src/runtime/storage.js";

export function useTemporaryStorage(prefix = "yesimbot-test-") {
  let basePath: string;
  let storage: ChannelStorage;

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), prefix));
    const ctx = {
      logger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
    } as unknown as Context;
    storage = new ChannelStorage(ctx, { basePath });
  });

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true });
  });

  return {
    get basePath() {
      return basePath;
    },
    get storage() {
      return storage;
    },
  };
}
