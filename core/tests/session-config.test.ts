import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { Config } from "../src/config.js";

describe("session configuration", () => {
  it("materializes compact and idle defaults", () => {
    expect(Config({ basePath: "data", chatModel: "test:model" }).session).toEqual({
      compact: {
        threshold: 0.9,
        charTokenRatio: 1.8,
        minMessages: 20,
        maxFailures: 3,
        model: undefined,
      },
      idle: { timeout: 7_200_000 },
    });
  });
});
