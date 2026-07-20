import { vi } from "vitest";

import type { Config } from "../src/config.js";
import { PlatformService, DEFAULT_PLATFORM } from "../src/platform/index.js";

/**
 * Create a PlatformService instance suitable for isolated unit testing.
 * Uses a minimal mock Koishi Context so the Service base class is satisfied.
 *
 * Pass `ctx` to share the same context as other services (e.g. for internal/session events).
 */
export function createTestPlatformService(options?: {
  now?: () => number;
  platform?: Record<string, unknown>;
  basePath?: string;
  diagnostic?: (d: unknown) => void;
  ctx?: Record<string, unknown>;
}): PlatformService {
  const logger = { warn: (diagnostic: unknown) => options?.diagnostic?.(diagnostic) };
  const mockCtx = options?.ctx ?? {
    on: vi.fn().mockReturnValue(vi.fn()),
    root: { baseDir: "/tmp/yesimbot-test" },
    logger: vi.fn(() => logger),
  };

  const mockConfig: Config = {
    basePath: options?.basePath ?? "/tmp/yesimbot-test/data",
    chatModel: "test",
    platform: { ...DEFAULT_PLATFORM, ...(options?.platform ?? {}) },
  };

  if (options?.now) vi.spyOn(Date, "now").mockImplementation(options.now);
  const service = new PlatformService(mockCtx as never, mockConfig);
  if (options?.diagnostic) {
    (service as unknown as { logger: { warn(diagnostic: unknown): void } }).logger.warn =
      options.diagnostic;
  }
  if (options?.ctx) {
    (options.ctx as Record<string, unknown>)["yesimbot.platform"] = service;
  }
  return service;
}
