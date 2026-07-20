import { access, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  originalWriteFile: undefined as undefined | typeof import("node:fs/promises").writeFile,
  writeFile: vi.fn<typeof import("node:fs/promises").writeFile>(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  fsMocks.originalWriteFile = original.writeFile;
  fsMocks.writeFile.mockImplementation(original.writeFile);
  return { ...original, writeFile: fsMocks.writeFile };
});

import { AssetStore } from "../src/platform/assets.js";
import { createChannelAssetPath } from "../src/runtime/key.js";

const scope = { platform: "test", selfId: "bot", channelId: "room" };
const otherScope = { platform: "test", selfId: "bot", channelId: "other" };
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF_BYTES = new TextEncoder().encode("GIF89a");
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

describe("AssetStore", () => {
  let basePath: string;
  let store: AssetStore;

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), "yesimbot-assets-"));
    store = new AssetStore({
      basePath,
      maxFileBytes: 16,
    });
  });

  afterEach(async () => {
    await import("node:fs/promises").then(({ rm }) =>
      rm(basePath, { recursive: true, force: true }),
    );
  });

  it.each([
    ["jpeg", JPEG_BYTES, "image/jpeg"],
    ["png", PNG_BYTES, "image/png"],
    ["gif", GIF_BYTES, "image/gif"],
    ["webp", WEBP_BYTES, "image/webp"],
  ] as const)(
    "stores verified %s bytes with MIME from their signature",
    async (_name, bytes, mime) => {
      await expect(store.put(scope, bytes)).resolves.toEqual(
        expect.objectContaining({ assetId: expect.stringMatching(/^asset_[a-f0-9]{64}$/), mime }),
      );
    },
  );

  it.each([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]),
    new TextEncoder().encode("GIFxxx"),
    new TextEncoder().encode("<svg/>"),
  ])("rejects incomplete, spoofed, and SVG image bytes", async (bytes) => {
    await expect(store.put(scope, bytes)).rejects.toThrow("Unsupported image MIME type");
  });

  it("rejects oversize data before creating channel storage", async () => {
    const oversizePng = new Uint8Array(17);
    oversizePng.set(PNG_BYTES);
    await expect(store.put(scope, oversizePng)).rejects.toThrow("Image exceeds 16 bytes");
    await expect(access(createChannelAssetPath(basePath, scope))).rejects.toThrow();
  });

  it("keeps final writes channel-local and cleans only its own channel", async () => {
    const first = await store.put(scope, PNG_BYTES);
    const second = await store.put(otherScope, JPEG_BYTES);
    const directory = createChannelAssetPath(basePath, scope);

    expect(await readdir(directory)).toEqual([first.assetId.slice("asset_".length)]);
    await store.clear(scope);

    await expect(access(directory)).rejects.toThrow();
    await expect(
      access(createChannelAssetPath(basePath, otherScope, second.assetId.slice("asset_".length))),
    ).resolves.toBeUndefined();
  });

  it("removes its temporary file when writing fails after creation", async () => {
    fsMocks.writeFile.mockImplementationOnce(async (...args) => {
      await fsMocks.originalWriteFile!(...args);
      throw new Error("disk full");
    });

    await expect(store.put(scope, PNG_BYTES)).rejects.toThrow("disk full");
    expect(await readdir(createChannelAssetPath(basePath, scope))).toEqual([]);
  });
});
