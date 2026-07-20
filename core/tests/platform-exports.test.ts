import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import * as platformApi from "../src/platform/index.js";

describe("platform public exports", () => {
  it("does not expose core asset capabilities", () => {
    expect(platformApi).not.toHaveProperty("AssetStore");
    expect(platformApi).not.toHaveProperty("IMAGE_BUDGET");
  });
});
