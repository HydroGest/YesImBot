import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import type { Context } from "koishi";

import { ArtifactService } from "../src/artifact.js";
import { AssetService } from "../src/asset.js";
import { Config } from "../src/config.js";
import { prepareOutputSegments } from "../src/runtime/output.js";
import { createResourceReader, type ResourceSchemeOpenHandler } from "../src/runtime/read.js";
import { ChannelStorage, type ChannelScope } from "../src/runtime/storage.js";

const scope: ChannelScope = {
  type: "shared",
  platform: "onebot",
  selfId: "bot-1",
  channelId: "room-42",
};
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("prepareOutputSegments", () => {
  let basePath: string;
  let storage: ChannelStorage;
  let artifacts: ArtifactService;
  let config: Config;

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), "yesimbot-resource-output-"));
    const ctx = {
      logger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
    } as unknown as Context;
    storage = new ChannelStorage(ctx, { basePath });
    artifacts = new ArtifactService(storage);
    config = {
      basePath,
      chatModel: "test",
      logLevel: 2,
      allowedChannels: [],
      imageInput: false,
      resourceReadTimeoutMs: 30_000,
      will: { engine: "routing", direct: "trigger", mention: "trigger", group: "wait" },
      reply: { pacing: { charactersPerSecond: 8, maxTotalDelayMs: 60_000 }, customInnerThought: false },
      session: {
        compact: { threshold: 0.9, charTokenRatio: 1.8, minMessages: 20, maxFailures: 3, model: undefined },
        idle: { timeout: 7_200_000 },
      },
    };
  });

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true });
  });

  function readerWith(
    open: ResourceSchemeOpenHandler,
    registrations: Map<string, { prompt: string; open: ResourceSchemeOpenHandler }> = new Map(),
  ) {
    const reader = createResourceReader({
      scope,
      assets: new AssetService(storage).createStore(scope),
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
    const assets = new AssetService(storage).createStore(scope);
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
    expect(prefix[0]).toHaveLength(0);
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
    expect(prepared[0]).toHaveLength(0);
  });
});
