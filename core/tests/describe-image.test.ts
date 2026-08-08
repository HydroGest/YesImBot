import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

vi.mock("ai", async (importOriginal) => {
  const original = await importOriginal<typeof import("ai")>();
  return { ...original, generateText: vi.fn() };
});

import { generateText } from "ai";

import { createDescribeImageTool } from "../src/agents/tools.js";
import { ChannelResources } from "../src/resources/index.js";
import { PNG_BYTES } from "./helpers/index.js";

const roots: string[] = [];

async function createResources(): Promise<ChannelResources> {
  const root = await mkdtemp(join(tmpdir(), "yesimbot-describe-image-"));
  roots.push(root);
  return new ChannelResources(root);
}

const VALID_URI = `asset://${"a".repeat(32)}`;

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("createDescribeImageTool", () => {
  it("describes an asset image through the vision model", async () => {
    const resources = await createResources();
    const id = await resources.assets.put(PNG_BYTES);
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "一只猫在沙发上",
      steps: [],
      warnings: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    } as never);
    const tool = createDescribeImageTool({} as never, resources);

    const result = await tool.execute({ uri: `asset://${id}`, question: "图片里有什么？" }, { toolCallId: "call", abortSignal: undefined } as never);

    expect(result).toEqual({ text: "一只猫在沙发上" });
    const options = vi.mocked(generateText).mock.calls[0]![0] as {
      messages: Array<{ content: Array<{ type: string; text?: string; data?: Uint8Array; mediaType?: string }> }>;
    };
    const parts = options.messages[0]!.content;
    expect(parts[0]).toMatchObject({ type: "text" });
    expect(parts[0]!.text).toContain("图片里有什么？");
    expect(parts[1]).toMatchObject({ type: "file", mediaType: "image/png" });
    expect(parts[1]!.data).toEqual(PNG_BYTES);
  });

  it("rejects malformed URIs without touching the asset store", async () => {
    const resources = await createResources();
    const get = vi.spyOn(resources.assets, "get");
    const tool = createDescribeImageTool({} as never, resources);

    await expect(tool.execute({ uri: "asset://SHORT", question: "什么" }, { toolCallId: "call", abortSignal: undefined } as never)).resolves.toEqual({
      error: "invalid_uri",
    });
    await expect(tool.execute({ uri: "artifact://mcp/x", question: "什么" }, { toolCallId: "call", abortSignal: undefined } as never)).resolves.toEqual({
      error: "invalid_uri",
    });
    expect(get).not.toHaveBeenCalled();
  });

  it("reports a missing asset", async () => {
    const resources = await createResources();
    const tool = createDescribeImageTool({} as never, resources);

    await expect(tool.execute({ uri: VALID_URI, question: "什么" }, { toolCallId: "call", abortSignal: undefined } as never)).resolves.toEqual({
      error: "asset_not_found",
    });
  });

  it("rejects non-image bytes", async () => {
    const resources = await createResources();
    const id = await resources.assets.put(new Uint8Array([1, 2, 3]));
    const tool = createDescribeImageTool({} as never, resources);

    await expect(tool.execute({ uri: `asset://${id}`, question: "什么" }, { toolCallId: "call", abortSignal: undefined } as never)).resolves.toEqual({
      error: "not_an_image",
    });
  });

  it("surfaces a failed vision call as an error result", async () => {
    const resources = await createResources();
    const id = await resources.assets.put(PNG_BYTES);
    vi.mocked(generateText).mockRejectedValueOnce(new Error("boom"));
    const tool = createDescribeImageTool({} as never, resources);

    await expect(tool.execute({ uri: `asset://${id}`, question: "什么" }, { toolCallId: "call", abortSignal: undefined } as never)).resolves.toEqual({
      error: "vision_call_failed: boom",
    });
  });
});
