import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentTool } from "@yesimbot/agent-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { createReadTool, type ResourceReadResult } from "../src/agents/tools.js";
import { ChannelResources, type ResourceReader } from "../src/resources/index.js";
import { prepareOutputSegments } from "../src/runtimes/output.js";
import { PNG_BYTES } from "./helpers/index.js";

const roots: string[] = [];

async function tempRoot(prefix = "yesimbot-resource-"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function reader(scheme: string, prompt: string, init: ResourceReader["init"]): ResourceReader {
  return { scheme, prompt, init };
}

async function createResources(overrides: { readTimeoutMs?: number } = {}): Promise<ChannelResources> {
  return new ChannelResources(await tempRoot(), null, overrides.readTimeoutMs ?? 10_000);
}

const BUDGET = { maxCount: 4, maxBytesPerImage: 5 * 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024 };

type ReadTool = AgentTool<{ uri: string }, ResourceReadResult>;

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("ChannelResources raw open", () => {
  it("opens built-in assets and dispatches a registered reader", async () => {
    const resources = await createResources();
    const id = await resources.assets.put(new Uint8Array([1, 2, 3]));
    await expect(resources.open(`asset://${id}`)).resolves.toMatchObject({ bytes: new Uint8Array([1, 2, 3]) });
    const init = vi.fn(async () => ({ bytes: new Uint8Array([4]), filename: "ok.txt" }));
    resources.use({ scheme: "test", prompt: "test reader", init });
    await expect(resources.open("test://host/file")).resolves.toMatchObject({ filename: "ok.txt" });
    expect(resources.listReaders()).toHaveLength(1);
  });

  it("returns undefined for malformed and unavailable URIs", async () => {
    const resources = await createResources();
    await expect(resources.open("asset://short")).resolves.toBeUndefined();
    await expect(resources.open("missing://host/file")).resolves.toBeUndefined();
  });
});

describe("read tool resource errors", () => {
  it("rejects registration of reserved schemes", async () => {
    const resources = await createResources();
    const open = async () => ({ bytes: PNG_BYTES });
    expect(() => resources.use(reader("asset", "x", open))).toThrow();
    expect(() => resources.use(reader("artifact", "x", open))).toThrow();
  });

  it("rejects duplicate scheme registrations", async () => {
    const resources = await createResources();
    const open = async () => ({ bytes: PNG_BYTES });
    resources.use(reader("skill", "first", open));
    expect(() => resources.use(reader("skill", "second", open))).toThrow();
  });

  it("rejects traversal attempts", async () => {
    const resources = await createResources();
    const tool = createReadTool(resources, false);
    await expect(tool.execute({ uri: "workspace:///../secret" }, { toolCallId: "c", abortSignal: undefined } as never)).resolves.toMatchObject({
      error: "invalid_resource_uri",
    });
  });

  it("returns unavailable for unregistered schemes", async () => {
    const resources = await createResources();
    const tool = createReadTool(resources, false);
    await expect(tool.execute({ uri: "skill://csv/SKILL.md" }, { toolCallId: "c", abortSignal: undefined } as never)).resolves.toMatchObject({
      error: "resource_unavailable",
    });
  });

  it("respects timeout configuration", async () => {
    const resources = await createResources({ readTimeoutMs: 1 });
    resources.use(
      reader("test", "test", async (_resources, _uri, { signal }) => {
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => resolve({ bytes: PNG_BYTES }), 100);
          signal.addEventListener("abort", () => {
            clearTimeout(timeout);
            reject(new Error("Aborted"));
          });
        });
      }),
    );
    const tool = createReadTool(resources, false);
    await expect(tool.execute({ uri: "test:///file" }, { toolCallId: "c", abortSignal: undefined } as never)).resolves.toMatchObject({ error: "timeout" });
  });

  it("enforces a hard deadline when an opener ignores abort", async () => {
    const resources = await createResources({ readTimeoutMs: 1 });
    resources.use(reader("slow", "slow", async () => Promise.withResolvers<{ bytes: Uint8Array }>().promise));
    const tool = createReadTool(resources, false);
    await expect(tool.execute({ uri: "slow:///file" }, { toolCallId: "c", abortSignal: undefined } as never)).resolves.toMatchObject({ error: "timeout" });
    await expect(resources.open("slow:///file")).resolves.toBeUndefined();
  });

  it("aborts an opener when the current turn is cancelled", async () => {
    const resources = await createResources();
    resources.use(reader("abort", "abort", async () => Promise.withResolvers<{ bytes: Uint8Array }>().promise));
    const tool = createReadTool(resources, false);
    const controller = new AbortController();
    const pending = tool.execute({ uri: "abort:///file" }, {
      toolCallId: "c",
      abortSignal: controller.signal,
    } as never);
    controller.abort();
    await expect(pending).resolves.toMatchObject({ error: expect.any(String) });
  });

  it("rejects unbounded and unsafe registered opener results", async () => {
    const resources = await createResources();
    resources.use(reader("unsafe", "unsafe", async () => ({ bytes: new Uint8Array([1]), filename: "../secret.txt" })));
    const tool = createReadTool(resources, false);
    await expect(tool.execute({ uri: "unsafe:///file" }, { toolCallId: "c", abortSignal: undefined } as never)).resolves.toMatchObject({
      error: "resource_read_failed",
    });

    const oversizedResources = await createResources();
    oversizedResources.use(reader("large", "large", async () => ({ bytes: new Uint8Array(5 * 1024 * 1024 + 1) })));
    const oversizedTool = createReadTool(oversizedResources, false);
    await expect(oversizedTool.execute({ uri: "large:///file" }, { toolCallId: "c", abortSignal: undefined } as never)).resolves.toMatchObject({
      error: "resource_too_large",
    });
  });

  it("rejects an empty path before dispatching a custom scheme", async () => {
    const resources = await createResources();
    const open = vi.fn(async () => ({ bytes: PNG_BYTES }));
    resources.use(reader("custom", "custom", open));
    const tool = createReadTool(resources, false);
    await expect(tool.execute({ uri: "custom:///" }, { toolCallId: "c", abortSignal: undefined } as never)).resolves.toMatchObject({
      error: "invalid_resource_uri",
    });
    expect(open).not.toHaveBeenCalled();
  });

  it("marks long text reads with a bounded truncation marker", async () => {
    const resources = await createResources();
    resources.use(reader("text", "text", async () => ({ bytes: new TextEncoder().encode("x".repeat(30_001)) })));
    const tool = createReadTool(resources, false);
    const result = await tool.execute({ uri: "text:///file" }, { toolCallId: "c", abortSignal: undefined } as never);
    expect(result.text).toHaveLength(30_000);
    expect(result.text).toContain("内容已截断");
  });

  it("rejects authority, query, fragment, and encoded traversal", async () => {
    const resources = await createResources();
    const tool = createReadTool(resources, false);
    for (const uri of [
      "asset://a6e2b32e1d9d64b2e906ac5c3216d18f?x=1",
      "artifact://mcp/x#frag",
      "workspace://host/path",
      "workspace:///reports/%2e%2e/secret.txt",
      "asset://SHORT",
      "asset://a6e2b32e1d9d64b2e906ac5c3216d18f/extra",
    ]) {
      await expect(tool.execute({ uri }, { toolCallId: "c", abortSignal: undefined } as never)).resolves.toMatchObject({
        error: "invalid_resource_uri",
      });
    }
  });
});

describe("prepareOutputSegments", () => {
  async function resourcesWith(open: ResourceReader["init"], registrations: Map<string, ResourceReader> = new Map()): Promise<ChannelResources> {
    const resources = await createResources();
    for (const [_scheme, r] of registrations) resources.use(r);
    if (!registrations.has("workspace")) {
      resources.use(reader("workspace", "workspace 文件引用", open));
    }
    return resources;
  }

  it("resolves a workspace image source to a data URL before delivery", async () => {
    const resources = await resourcesWith(async () => ({
      bytes: PNG_BYTES,
      mediaType: "image/png",
      filename: "chart.png",
    }));

    const prepared = await prepareOutputSegments(
      [
        [
          { type: "text", attrs: { content: "chart:" }, children: [] },
          { type: "img", attrs: { src: "workspace:///images/chart.png" }, children: [] },
        ],
      ],
      resources,
    );

    const img = prepared[0]![1] as { type: string; attrs: { src: string } };
    expect(img.attrs.src.startsWith("data:image/png;base64,")).toBe(true);
    expect(img.attrs.src).not.toContain("workspace://");
    expect(prepared[0]![0]).toMatchObject({ type: "text" });
  });

  it("resolves an artifact image through the same reader path", async () => {
    const resources = await createResources();
    const uri = await resources.artifacts.forTool("mcp_screenshot").put(PNG_BYTES, { mediaType: "image/png", filename: "screen.png" });

    const prepared = await prepareOutputSegments([[{ type: "img", attrs: { src: uri }, children: [] }]], resources);

    const img = prepared[0]![0] as { type: string; attrs: { src: string } };
    expect(img.attrs.src.startsWith("data:image/png;base64,")).toBe(true);
    expect(img.attrs.src).not.toContain("artifact://");
  });

  it("omits an unavailable resource and preserves sibling content", async () => {
    const resources = await resourcesWith(async () => undefined);

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
      resources,
    );

    expect(prepared[0]).toHaveLength(1);
    expect(prepared[0]![0]).toMatchObject({ type: "text", attrs: { content: "keep" } });
  });

  it("leaves unrecognized elements and non-resource sources untouched", async () => {
    const resources = await resourcesWith(async () => undefined);

    const prepared = await prepareOutputSegments(
      [
        [
          { type: "at", attrs: { id: "u1" }, children: [] },
          { type: "img", attrs: { src: "https://example.test/x.png" }, children: [] },
        ],
      ],
      resources,
    );

    expect(prepared[0]).toHaveLength(2);
    expect(prepared[0]![0]).toMatchObject({ type: "at" });
    expect(prepared[0]![1]).toMatchObject({ attrs: { src: "https://example.test/x.png" } });
  });

  it("requires a complete asset ID for output resolution", async () => {
    const resources = await createResources();
    const id = await resources.assets.put(PNG_BYTES);

    const full = await prepareOutputSegments([[{ type: "img", attrs: { src: `asset://${id}` }, children: [] }]], resources);
    expect(full[0]).toHaveLength(1);
    expect((full[0]![0] as { attrs: { src: string } }).attrs.src).toContain("data:image/png;base64,");

    const prefix = await prepareOutputSegments([[{ type: "img", attrs: { src: `asset://${id.slice(0, 7)}` }, children: [] }]], resources);
    expect(prefix).toHaveLength(0);
  });

  it("drops a segment that becomes empty after resource omission", async () => {
    const resources = await resourcesWith(async () => undefined);

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
      resources,
    );

    expect(prepared).toHaveLength(0);
  });

  it("materializes ordinary files with a generic MIME fallback", async () => {
    const resources = await resourcesWith(async () => ({ bytes: new Uint8Array([1, 2, 3]), filename: "report.bin" }));
    const prepared = await prepareOutputSegments([[{ type: "file", attrs: { src: "workspace:///reports/report.bin" }, children: [] }]], resources);
    expect((prepared[0]![0] as { attrs: { src: string } }).attrs.src).toContain("data:application/octet-stream;base64,");
  });

  it("leaves audio and video output untouched", async () => {
    const open = vi.fn(async () => ({ bytes: PNG_BYTES, mediaType: "image/png" }));
    const resources = await resourcesWith(open);
    const segments = [
      [
        { type: "audio", attrs: { src: "workspace:///sound.mp3" }, children: [] },
        { type: "video", attrs: { src: "workspace:///movie.mp4" }, children: [] },
      ],
    ];
    const prepared = await prepareOutputSegments(segments, resources);
    expect(prepared).toEqual(segments);
    expect(open).not.toHaveBeenCalled();
  });

  it("does not trust an image MIME hint for arbitrary output bytes", async () => {
    const resources = await resourcesWith(async () => ({ bytes: new Uint8Array([1, 2, 3]), mediaType: "image/png" }));
    const prepared = await prepareOutputSegments([[{ type: "img", attrs: { src: "workspace:///fake.png" }, children: [] }]], resources);
    expect(prepared).toHaveLength(0);
  });
});

describe("read tool model projection", () => {
  async function createTool(
    overrides: { imageCapable?: boolean; imageBudget?: typeof BUDGET | null } = {},
  ): Promise<{ tool: ReadTool; resources: ChannelResources }> {
    const resources = await createResources();
    const budget = overrides.imageBudget === undefined ? null : overrides.imageBudget;
    return {
      tool: createReadTool(new ChannelResources(resources.path, budget), overrides.imageCapable ?? false),
      resources,
    };
  }

  async function readAndProject(tool: ReadTool, uri: string, toolCallId = "call-1") {
    const result = await tool.execute({ uri }, { toolCallId, abortSignal: undefined } as never);
    const output = await tool.toModelOutput!({ toolCallId, input: { uri }, output: result });
    return { result, output };
  }

  it("returns image bytes with the read text for an image-capable budgeted read", async () => {
    const { tool, resources } = await createTool({ imageCapable: true, imageBudget: BUDGET });
    const id = await resources.assets.put(PNG_BYTES);
    const { result, output } = await readAndProject(tool, `asset://${id}`);

    expect(result).toMatchObject({ uri: `asset://${id}`, mediaType: "image/png" });
    if (output.type !== "content") throw new Error("expected multimodal output");
    expect(output.value[0]).toMatchObject({ type: "text" });
    const image = output.value[1];
    if (!image || image.type !== "image-data") throw new Error("expected image-data part");
    expect(image.mediaType).toBe("image/png");
    expect(Buffer.from(image.data, "base64")).toEqual(Buffer.from(PNG_BYTES));
  });

  it("keeps a JSON result when image input is unavailable", async () => {
    const { tool, resources } = await createTool({ imageCapable: false, imageBudget: BUDGET });
    const id = await resources.assets.put(PNG_BYTES);
    expect((await readAndProject(tool, `asset://${id}`)).output.type).toBe("json");

    const { tool: budgetless, resources: budgetlessResources } = await createTool({
      imageCapable: true,
      imageBudget: null,
    });
    const id2 = await budgetlessResources.assets.put(PNG_BYTES);
    expect((await readAndProject(budgetless, `asset://${id2}`)).output.type).toBe("json");
  });

  it("skips bytes for oversized images while keeping the read result", async () => {
    const big = new Uint8Array(6 * 1024 * 1024);
    big.set(PNG_BYTES);
    const { tool, resources } = await createTool({ imageCapable: true, imageBudget: BUDGET });
    const id = await resources.assets.put(big);
    const { result, output } = await readAndProject(tool, `asset://${id}`);

    expect(result).toMatchObject({ uri: `asset://${id}` });
    expect(output.type).toBe("json");
  });

  it("uses detected bytes instead of a supplied image MIME hint", async () => {
    const resources = await createResources();
    resources.use(reader("fake", "fake", async () => ({ bytes: new Uint8Array([1, 2, 3]), mediaType: "image/png" })));
    const tool = createReadTool(new ChannelResources(resources.path, BUDGET), true);

    expect((await readAndProject(tool, "fake:///image")).output.type).toBe("json");
  });

  it("keeps a JSON result when the read fails", async () => {
    const { tool } = await createTool({ imageCapable: true, imageBudget: BUDGET });
    const { result, output } = await readAndProject(tool, `asset://${"a".repeat(32)}`);

    expect(result).toMatchObject({ error: "resource_not_found" });
    expect(output.type).toBe("json");
  });

  it("describes available image projection capabilities", async () => {
    const { tool: capable } = await createTool({ imageCapable: true, imageBudget: BUDGET });
    expect(capable.description).toContain("图片字节将随结果返回");
    expect(capable.description).not.toContain("describe_image");

    const { tool: blind } = await createTool({ imageCapable: false, imageBudget: null });
    expect(blind.description).toContain("不包含图片字节");
    expect(blind.description).toContain("describe_image");
  });

  it("returns artifact image bytes through the same path", async () => {
    const { tool, resources } = await createTool({ imageCapable: true, imageBudget: BUDGET });
    const uri = await resources.artifacts.forTool("mcp_test").put(PNG_BYTES, { mediaType: "image/png" });

    expect((await readAndProject(tool, uri)).output.type).toBe("content");
  });
});
