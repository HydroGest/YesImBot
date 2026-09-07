import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { Config } from "../src/config.js";

describe("Config schema", () => {
  it("keeps session management fields under the 会话管理 group", () => {
    const json = Config.toJSON() as {
      refs: Record<
        string,
        {
          type?: string;
          meta?: { description?: string };
          dict?: Record<string, string | number>;
        }
      >;
    };
    const sessionGroup = Object.values(json.refs).find((ref) => ref.meta?.description === "会话管理");

    expect(sessionGroup).toBeDefined();
    expect(sessionGroup?.type).toBe("object");
    expect(Object.keys(sessionGroup?.dict ?? {})).toEqual(["compact", "archive"]);
  });
});
