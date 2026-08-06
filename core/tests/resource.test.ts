import type { AgentTool } from "@yesimbot/agent-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "./helpers/setup.js";
import { ArtifactService } from "../src/artifact.js";
import { AssetService } from "../src/asset.js";
import type { Config } from "../src/config.js";
import { prepareOutputSegments } from "../src/runtime/output.js";
import {
  createReadTool,
  createResourceReader,
  type ResourceReadResult,
  type ResourceSchemeOpenHandler,
} from "../src/runtime/read.js";
import { scope, PNG_BYTES, defaultConfig, useTemporaryStorage } from "./helpers/index.js";

const env = useTemporaryStorage("yesimbot-resource-");
const BUDGET = { maxCount: 4, maxBytesPerImage: 5 * 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024 };

type ReadTool = AgentTool<{ uri: string }, ResourceReadResult>;

describe("ResourceReader", () => {
  let config: Config;
  let artifacts: ArtifactService;
  let assets: AssetService;

  beforeEach(() => {
    config = defaultConfig({ basePath: env.basePath });
    artifacts = new ArtifactService(env.storage);
    assets = new AssetService(env.storage);
  });

  it("rejects registration of reserved schemes", () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations,
      config,
    });

    const open: ResourceSchemeOpenHandler = async () => ({ bytes: PNG_BYTES });
    expect(() => reader.registerResourceScheme("asset", "x", open)).toThrow();
    expect(() => reader.registerResourceScheme("artifact", "x", open)).toThrow();
  });

  it("rejects duplicate scheme registrations", () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations,
      config,
    });

    const open: ResourceSchemeOpenHandler = async () => ({ bytes: PNG_BYTES });
    reader.registerResourceScheme("skill", "first", open);
    expect(() => reader.registerResourceScheme("skill", "second", open)).toThrow();
  });

  it("rejects traversal attempts", async () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations,
      config,
    });

    const result = await reader.read("workspace:///../secret");
    expect(result).toMatchObject({ error: "invalid_resource_uri" });
  });

  it("returns unavailable for unregistered schemes", async () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations,
      config,
    });

    const result = await reader.read("skill://csv/SKILL.md");
    expect(result).toMatchObject({ error: "resource_unavailable" });
  });

  it("respects timeout configuration", async () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations,
      config: { ...config, resourceReadTimeoutMs: 1 },
    });

    reader.registerResourceScheme("test", "test", async (_scope, _uri, { signal }) => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => resolve({ bytes: PNG_BYTES }), 100);
        signal.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(new Error("Aborted"));
        });
      });
    });

    const result = await reader.read("test:///file");
    expect(result).toMatchObject({ error: "timeout" });
  });

  it("enforces a hard deadline when an opener ignores abort", async () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations,
      config: { ...config, resourceReadTimeoutMs: 1 },
    });

    reader.registerResourceScheme("slow", "slow", async () => Promise.withResolvers<{ bytes: Uint8Array }>().promise);
    await expect(reader.read("slow:///file")).resolves.toMatchObject({ error: "timeout" });
    await expect(reader.openBytes("slow:///file")).resolves.toBeUndefined();
  });

  it("aborts an opener when the current turn is cancelled", async () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations,
      config,
    });
    reader.registerResourceScheme("abort", "abort", async () => Promise.withResolvers<{ bytes: Uint8Array }>().promise);
    const controller = new AbortController();
    const pending = reader.read("abort:///file", controller.signal);
    controller.abort();
    await expect(pending).resolves.toMatchObject({ error: expect.any(String) });
  });

  it("rejects unbounded and unsafe registered opener results", async () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations,
      config,
    });
    reader.registerResourceScheme("unsafe", "unsafe", async () => ({
      bytes: new Uint8Array([1]),
      filename: "../secret.txt",
    }));
    await expect(reader.read("unsafe:///file")).resolves.toMatchObject({ error: "resource_read_failed" });

    const oversized = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations: new Map([
        ["large", { prompt: "large", open: async () => ({ bytes: new Uint8Array(5 * 1024 * 1024 + 1) }) }],
      ]),
      config,
    });
    await expect(oversized.read("large:///file")).resolves.toMatchObject({ error: "resource_too_large" });
  });

  it("rejects an empty path before dispatching a custom scheme", async () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const open = vi.fn(async () => ({ bytes: PNG_BYTES }));
    const reader = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations,
      config,
    });
    reader.registerResourceScheme("custom", "custom", open);
    await expect(reader.read("custom:///")).resolves.toMatchObject({ error: "invalid_resource_uri" });
    expect(open).not.toHaveBeenCalled();
  });

  it("marks long text reads with a bounded truncation marker", async () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations,
      config,
    });
    reader.registerResourceScheme("text", "text", async () => ({
      bytes: new TextEncoder().encode("x".repeat(30_001)),
    }));
    const result = await reader.read("text:///file");
    expect(result.text).toHaveLength(30_000);
    expect(result.text).toContain("内容已截断");
  });

  it("rejects authority, query, fragment, and encoded traversal", async () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
    const reader = createResourceReader({
      scope,
      assets: assets.createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations,
      config,
    });

    for (const uri of [
      "asset://a6e2b32e1d9d64b2e906ac5c3216d18f?x=1",
      "artifact://mcp/x#frag",
      "workspace://host/path",
      "workspace:///reports/%2e%2e/secret.txt",
      "asset://SHORT",
      "asset://a6e2b32e1d9d64b2e906ac5c3216d18f/extra",
    ]) {
      await expect(reader.read(uri)).resolves.toMatchObject({ error: "invalid_resource_uri" });
    }
  });
});

describe("prepareOutputSegments", () => {
  let config: Config;
  let artifacts: ArtifactService;

  beforeEach(() => {
    config = defaultConfig({ basePath: env.basePath });
    artifacts = new ArtifactService(env.storage);
  });

  function readerWith(
    open: ResourceSchemeOpenHandler,
    registrations: Map<string, { prompt: string; open: ResourceSchemeOpenHandler }> = new Map(),
  ) {
    const reader = createResourceReader({
      scope,
      assets: new AssetService(env.storage).createStore(scope),
      artifacts: artifacts.createStore(scope),
      registrations,
      config,
    });
    if (!registrations.has("workspace")) {
      reader.registerResourceScheme("workspace", "workspace 文件引用", open);
    }
    return reader;
  }

  it("resolves a workspace image source to a data URL before delivery", async () => {
    const reader = readerWith(async () => ({ bytes: PNG_BYTES, mediaType: "image/png", filename: "chart.png" }));

    const prepared = await prepareOutputSegments(
      [
        [
          { type: "text", attrs: { content: "chart:" }, children: [] },
          { type: "img", attrs: { src: "workspace:///images/chart.png" }, children: [] },
        ],
      ],
      reader,
    );

    const img = prepared[0]![1] as { type: string; attrs: { src: string } };
    expect(img.attrs.src.startsWith("data:image/png;base64,")).toBe(true);
    expect(img.attrs.src).not.toContain("workspace://");
    expect(prepared[0]![0]).toMatchObject({ type: "text" });
  });

  it("resolves an artifact image through the same reader path", async () => {
    const store = artifacts.createStore(scope);
    const uri = await store
      .forTool("mcp_screenshot")
      .put(PNG_BYTES, { mediaType: "image/png", filename: "screen.png" });
    const reader = readerWith(async () => undefined);

    const prepared = await prepareOutputSegments([[{ type: "img", attrs: { src: uri }, children: [] }]], reader);

    const img = prepared[0]![0] as { type: string; attrs: { src: string } };
    expect(img.attrs.src.startsWith("data:image/png;base64,")).toBe(true);
    expect(img.attrs.src).not.toContain("artifact://");
  });

  it("omits an unavailable resource and preserves sibling content", async () => {
    const reader = readerWith(async () => undefined);

    const prepared = await prepareOutputSegments(
      [
        [
          { type: "text", attrs: { content: "keep" }, children: [] },
          {
            type: "img",
            attrs: { src: "artifact://mcp_screenshot/019d3b7e-1bd0-7e4f-9c5d-5bf3fd41f1d4" },
            children: [],
          },
        ],
      ],
      reader,
    );

    expect(prepared[0]).toHaveLength(1);
    expect(prepared[0]![0]).toMatchObject({ type: "text", attrs: { content: "keep" } });
  });

  it("leaves unrecognized elements and non-resource sources untouched", async () => {
    const reader = readerWith(async () => undefined);

    const prepared = await prepareOutputSegments(
      [
        [
          { type: "at", attrs: { id: "u1" }, children: [] },
          { type: "img", attrs: { src: "https://example.test/x.png" }, children: [] },
        ],
      ],
      reader,
    );

    expect(prepared[0]).toHaveLength(2);
    expect(prepared[0]![0]).toMatchObject({ type: "at" });
    expect(prepared[0]![1]).toMatchObject({ attrs: { src: "https://example.test/x.png" } });
  });

  it("requires a complete asset ID for output resolution", async () => {
    const assets = new AssetService(env.storage).createStore(scope);
    const id = await assets.put(PNG_BYTES);
    const reader = createResourceReader({
      scope,
      assets,
      artifacts: artifacts.createStore(scope),
      registrations: new Map(),
      config,
    });

    const full = await prepareOutputSegments(
      [[{ type: "img", attrs: { src: `asset://${id}` }, children: [] }]],
      reader,
    );
    expect(full[0]).toHaveLength(1);
    expect((full[0]![0] as { attrs: { src: string } }).attrs.src).toContain("data:image/png;base64,");

    const prefix = await prepareOutputSegments(
      [[{ type: "img", attrs: { src: `asset://${id.slice(0, 7)}` }, children: [] }]],
      reader,
    );
    expect(prefix).toHaveLength(0);
  });

  it("drops a segment that becomes empty after resource omission", async () => {
    const reader = readerWith(async () => undefined);

    const prepared = await prepareOutputSegments(
      [
        [
          {
            type: "img",
            attrs: { src: "artifact://missing/019d3b7e-1bd0-7e4f-9c5d-5bf3fd41f1d4" },
            children: [],
          },
        ],
      ],
      reader,
    );

    expect(prepared).toHaveLength(0);
  });

  it("materializes ordinary files with a generic MIME fallback", async () => {
    const reader = readerWith(async () => ({ bytes: new Uint8Array([1, 2, 3]), filename: "report.bin" }));
    const prepared = await prepareOutputSegments(
      [[{ type: "file", attrs: { src: "workspace:///reports/report.bin" }, children: [] }]],
      reader,
    );
    expect((prepared[0]![0] as { attrs: { src: string } }).attrs.src).toContain(
      "data:application/octet-stream;base64,",
    );
  });

  it("leaves audio and video output untouched", async () => {
    const open = vi.fn(async () => ({ bytes: PNG_BYTES, mediaType: "image/png" }));
    const reader = readerWith(open);
    const segments = [
      [
        { type: "audio", attrs: { src: "workspace:///sound.mp3" }, children: [] },
        { type: "video", attrs: { src: "workspace:///movie.mp4" }, children: [] },
      ],
    ];
    const prepared = await prepareOutputSegments(segments, reader);
    expect(prepared).toEqual(segments);
    expect(open).not.toHaveBeenCalled();
  });

  it("reports omitted resources through a safe diagnostic sink", async () => {
    const reader = readerWith(async () => undefined);
    const warn = vi.fn();
    const prepared = await prepareOutputSegments(
      [
        [
          { type: "text", attrs: { content: "keep" }, children: [] },
          { type: "img", attrs: { src: "artifact://missing/019d3b7e-1bd0-7e4f-9c5d-5bf3fd41f1d4" }, children: [] },
        ],
      ],
      reader,
      { warn },
    );
    expect(prepared[0]).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith("resource_output_omitted", { elementType: "img" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("artifact://");
  });

  it("does not trust an image MIME hint for arbitrary output bytes", async () => {
    const reader = readerWith(async () => ({ bytes: new Uint8Array([1, 2, 3]), mediaType: "image/png" }));
    const prepared = await prepareOutputSegments(
      [[{ type: "img", attrs: { src: "workspace:///fake.png" }, children: [] }]],
      reader,
    );
    expect(prepared).toHaveLength(0);
  });
});

describe("read tool model projection", () => {
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
    const id = await assets.createStore(scope).put(PNG_BYTES);
    const { result, output } = await readAndProject(
      createTool({ imageCapable: true, imageBudget: BUDGET }),
      `asset://${id}`,
    );

    expect(result).toMatchObject({ uri: `asset://${id}`, mediaType: "image/png" });
    if (output.type !== "content") throw new Error("expected multimodal output");
    expect(output.value[0]).toMatchObject({ type: "text" });
    const image = output.value[1];
    if (!image || image.type !== "image-data") throw new Error("expected image-data part");
    expect(image.mediaType).toBe("image/png");
    expect(Buffer.from(image.data, "base64")).toEqual(Buffer.from(PNG_BYTES));
  });

  it("keeps a JSON result when image input is unavailable", async () => {
    const id = await assets.createStore(scope).put(PNG_BYTES);

    expect(
      (await readAndProject(createTool({ imageCapable: false, imageBudget: BUDGET }), `asset://${id}`)).output.type,
    ).toBe("json");
    expect(
      (await readAndProject(createTool({ imageCapable: true, imageBudget: null }), `asset://${id}`)).output.type,
    ).toBe("json");
  });

  it("skips bytes for oversized images while keeping the read result", async () => {
    const big = new Uint8Array(6 * 1024 * 1024);
    big.set(PNG_BYTES);
    const id = await assets.createStore(scope).put(big);
    const { result, output } = await readAndProject(
      createTool({ imageCapable: true, imageBudget: BUDGET }),
      `asset://${id}`,
    );

    expect(result).toMatchObject({ uri: `asset://${id}` });
    expect(output.type).toBe("json");
  });

  it("uses detected bytes instead of a supplied image MIME hint", async () => {
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

    expect((await readAndProject(tool, "fake:///image")).output.type).toBe("json");
  });

  it("keeps a JSON result when the read fails", async () => {
    const { result, output } = await readAndProject(
      createTool({ imageCapable: true, imageBudget: BUDGET }),
      `asset://${"a".repeat(32)}`,
    );

    expect(result).toMatchObject({ error: "resource_not_found" });
    expect(output.type).toBe("json");
  });

  it("describes available image projection capabilities", () => {
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
    const uri = await artifacts.createStore(scope).forTool("mcp_test").put(PNG_BYTES, { mediaType: "image/png" });

    expect((await readAndProject(createTool({ imageCapable: true, imageBudget: BUDGET }), uri)).output.type).toBe(
      "content",
    );
  });
});
