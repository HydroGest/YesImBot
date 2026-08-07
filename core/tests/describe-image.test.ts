import type { LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { createDescribeImageTool } from "../src/agents/tools.js";
import { ChannelResources } from "../src/resources/index.js";

describe("createDescribeImageTool", () => {
  it("uses ChannelResources.open for unavailable resources", async () => {
    const tool = createDescribeImageTool({} as LanguageModel, new ChannelResources("/tmp/yesimbot-describe-image"));
    await expect(tool.execute({ uri: "asset://short", question: "what" }, { toolCallId: "call", abortSignal: undefined } as never)).resolves.toEqual({ error: "resource_not_found" });
  });
});
