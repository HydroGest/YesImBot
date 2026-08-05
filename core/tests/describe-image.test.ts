import type { LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";

import type { AssetStore } from "../src/asset.js";
import { createDescribeImageTool } from "../src/runtime/describe-image.js";
import { PNG_BYTES } from "./helpers/index.js";

const VALID_URI = `asset://${"a".repeat(32)}`;

function createAssets(get: (id: string) => Promise<Uint8Array>): AssetStore {
  return { get: vi.fn(get), put: vi.fn(), clear: vi.fn() };
}

function createVisionModel(text = "一只猫在沙发上") {
  return {
    specificationVersion: "v2" as const,
    provider: "mock",
    modelId: "vision-model",
    doGenerate: vi.fn().mockResolvedValue({
      content: [{ type: "text", text }],
      finishReason: "stop" as const,
      usage: { promptTokens: 10, completionTokens: 5 },
    }),
  } as unknown as LanguageModel;
}

describe("createDescribeImageTool", () => {
  it("describes an asset image through the vision model", async () => {
    const model = createVisionModel();
    const tool = createDescribeImageTool({ assets: createAssets(async () => PNG_BYTES), model });

    const result = await tool.execute({ uri: VALID_URI, question: "图片里有什么？" }, {
      toolCallId: "call-1",
      abortSignal: undefined,
    } as never);

    expect(result).toEqual({ text: "一只猫在沙发上" });
    const options = model.doGenerate.mock.calls[0]![0] as {
      prompt: Array<{
        role: string;
        content: Array<{ type: string; text?: string; data?: Uint8Array; mediaType?: string }>;
      }>;
    };
    const parts = options.prompt[0]!.content;
    expect(parts[0]).toMatchObject({ type: "text" });
    expect(parts[0]!.text).toContain("图片里有什么？");
    expect(parts[1]).toMatchObject({ type: "file", mediaType: "image/png" });
    expect(parts[1]!.data).toEqual(PNG_BYTES);
  });

  it("rejects malformed URIs without touching the asset store", async () => {
    const get = vi.fn();
    const tool = createDescribeImageTool({ assets: { get, put: vi.fn(), clear: vi.fn() }, model: createVisionModel() });

    for (const uri of [
      "asset://short",
      "artifact://x/019d3b7e-1bd0-7e4f-9c5d-5bf3fd41f1d4",
      "https://example.test/a.png",
    ]) {
      const result = await tool.execute({ uri, question: "什么" }, { toolCallId: "call-1" } as never);
      expect(result).toEqual({ error: "invalid_uri" });
    }
    expect(get).not.toHaveBeenCalled();
  });

  it("reports a missing asset", async () => {
    const tool = createDescribeImageTool({
      assets: createAssets(async () => {
        throw new Error("not found");
      }),
      model: createVisionModel(),
    });

    const result = await tool.execute({ uri: VALID_URI, question: "什么" }, { toolCallId: "call-1" } as never);

    expect(result).toEqual({ error: "asset_not_found" });
  });

  it("rejects non-image bytes", async () => {
    const tool = createDescribeImageTool({
      assets: createAssets(async () => new Uint8Array([1, 2, 3])),
      model: createVisionModel(),
    });

    const result = await tool.execute({ uri: VALID_URI, question: "什么" }, { toolCallId: "call-1" } as never);

    expect(result).toEqual({ error: "not_an_image" });
  });

  it("surfaces a failed vision call as an error result", async () => {
    const model = {
      specificationVersion: "v2" as const,
      provider: "mock",
      modelId: "vision-model",
      doGenerate: vi.fn().mockRejectedValue(new Error("rate limited")),
    } as unknown as LanguageModel;
    const tool = createDescribeImageTool({ assets: createAssets(async () => PNG_BYTES), model });

    const result = await tool.execute({ uri: VALID_URI, question: "什么" }, { toolCallId: "call-1" } as never);

    expect(result).toMatchObject({ error: "vision_call_failed: rate limited" });
  });
});
