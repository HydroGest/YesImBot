import type { AgentTool } from "@yesimbot/agent-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "./helpers/setup.js";
import { ArtifactService } from "../src/artifact.js";
import { AssetService } from "../src/asset.js";
import type { Config } from "../src/config.js";
import { createReadTool, createResourceReader, type ResourceReadResult } from "../src/runtime/read.js";
import { defaultConfig, PNG_BYTES, scope, useTemporaryStorage } from "./helpers/index.js";

const env = useTemporaryStorage("yesimbot-read-tool-");

const BUDGET = { maxCount: 4, maxBytesPerImage: 5 * 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024 };

type ReadTool = AgentTool<{ uri: string }, ResourceReadResult>;

describe("createReadTool", () => {
  let config: Config;
  let artifacts: ArtifactService;
  let assets: AssetService;

  beforeEach(() => {
    config = defaultConfig({ basePath: env.basePath });
    artifacts = new ArtifactService(env.storage);
    assets = new AssetService(env.storage);
  });

  function createTool(
    overrides: { imageCapable?: boolean; imageBudget?: typeof BUDGET | null; describeImageAvailable?: boolean } = {},
  ): ReadTool {
    const reader = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations: new Map(),
      config,
    });
    return createReadTool({
      logger: { info: vi.fn() } as never,
      reader,
      imageCapable: overrides.imageCapable ?? false,
      imageBudget: overrides.imageBudget ?? null,
      describeImageAvailable: overrides.describeImageAvailable ?? false,
      registrations: new Map(),
    });
  }

  async function readAndProject(tool: ReadTool, uri: string, toolCallId = "call-1") {
    const result = await tool.execute({ uri }, { toolCallId, abortSignal: undefined } as never);
    const output = await tool.toModelOutput!({ toolCallId, input: { uri }, output: result });
    return { result, output };
  }

  it("returns image bytes with the read text for an image-capable budgeted read", async () => {
    const store = assets.createStore(scope);
    const id = await store.put(PNG_BYTES);
    const tool = createTool({ imageCapable: true, imageBudget: BUDGET });

    const { result, output } = await readAndProject(tool, `asset://${id}`);

    expect(result).toMatchObject({ uri: `asset://${id}`, mediaType: "image/png" });
    if (output.type !== "content") throw new Error("expected multimodal output");
    expect(output.value[0]).toMatchObject({ type: "text" });
    const image = output.value[1];
    if (!image || image.type !== "image-data") throw new Error("expected image-data part");
    expect(image.mediaType).toBe("image/png");
    expect(Buffer.from(image.data, "base64")).toEqual(Buffer.from(PNG_BYTES));
  });

  it("keeps a plain JSON result when the model is not image-capable", async () => {
    const store = assets.createStore(scope);
    const id = await store.put(PNG_BYTES);
    const tool = createTool({ imageCapable: false, imageBudget: BUDGET });

    const { output } = await readAndProject(tool, `asset://${id}`);

    expect(output.type).toBe("json");
  });

  it("keeps a plain JSON result when image input is disabled", async () => {
    const store = assets.createStore(scope);
    const id = await store.put(PNG_BYTES);
    const tool = createTool({ imageCapable: true, imageBudget: null });

    const { output } = await readAndProject(tool, `asset://${id}`);

    expect(output.type).toBe("json");
  });

  it("skips bytes for oversized images while keeping the read result", async () => {
    const store = assets.createStore(scope);
    const big = new Uint8Array(6 * 1024 * 1024);
    big.set(PNG_BYTES);
    const id = await store.put(big);
    const tool = createTool({ imageCapable: true, imageBudget: BUDGET });

    const { result, output } = await readAndProject(tool, `asset://${id}`);

    expect(result).toMatchObject({ uri: `asset://${id}` });
    expect(output.type).toBe("json");
  });

  it("never trusts a media type hint over detected bytes", async () => {
    const reader = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations: new Map(),
      config,
    });
    reader.registerResourceScheme("fake", "fake", async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: "image/png",
    }));
    const tool = createReadTool({
      logger: { info: vi.fn() } as never,
      reader,
      imageCapable: true,
      imageBudget: BUDGET,
      describeImageAvailable: false,
      registrations: new Map(),
    });

    const { output } = await readAndProject(tool, "fake:///image");

    expect(output.type).toBe("json");
  });

  it("keeps a plain JSON result when the read fails", async () => {
    const tool = createTool({ imageCapable: true, imageBudget: BUDGET });

    const { result, output } = await readAndProject(tool, `asset://${"a".repeat(32)}`);

    expect(result).toMatchObject({ error: "resource_not_found" });
    expect(output.type).toBe("json");
  });

  it("describes image capabilities in the tool description", () => {
    const capable = createTool({ imageCapable: true, imageBudget: BUDGET });
    expect(capable.description).toContain("图片字节将随结果返回");
    expect(capable.description).not.toContain("describe_image");

    const blind = createTool({ imageCapable: false, imageBudget: null, describeImageAvailable: true });
    expect(blind.description).toContain("不包含图片字节");
    expect(blind.description).toContain("describe_image");

    const none = createTool({ imageCapable: false, imageBudget: null, describeImageAvailable: false });
    expect(none.description).toContain("不包含图片字节");
    expect(none.description).not.toContain("describe_image");
  });

  it("returns artifact image bytes through the same path", async () => {
    const store = artifacts.createStore(scope);
    const uri = await store.forTool("mcp_test").put(PNG_BYTES, { mediaType: "image/png" });
    const tool = createTool({ imageCapable: true, imageBudget: BUDGET });

    const { output } = await readAndProject(tool, uri);

    expect(output.type).toBe("content");
  });
});
