import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import "./helpers/setup.js";
import { ArtifactService } from "../src/artifact.js";
import { AssetService } from "../src/asset.js";
import { scope, otherScope, PNG_BYTES, useTemporaryStorage } from "./helpers/index.js";

const PNG_ID = createHash("sha256").update(PNG_BYTES).digest("hex").slice(0, 32);

describe("AssetService", () => {
  const env = useTemporaryStorage("yesimbot-binary-store-");

  it("stores copied bytes and returns the canonical content-id", async () => {
    const store = new AssetService(env.storage).createStore(scope);
    const source = PNG_BYTES.slice();
    const id = await store.put(source);
    source[0] = 0;

    expect(id).toBe(PNG_ID);
    await expect(store.get(PNG_ID)).resolves.toEqual(PNG_BYTES);
    await expect(store.get(PNG_ID.slice(0, 7))).resolves.toEqual(PNG_BYTES);
  });

  it("deduplicates bytes and shares a shared-channel store across Bots", async () => {
    const assets = new AssetService(env.storage);
    const first = assets.createStore(scope);
    const second = assets.createStore({ ...scope, selfId: "bot-2" });

    expect(await first.put(PNG_BYTES)).toBe(PNG_ID);
    expect(await second.put(PNG_BYTES)).toBe(PNG_ID);
    await expect(second.get(PNG_ID)).resolves.toEqual(PNG_BYTES);
  });

  it("rejects invalid, absent, and ambiguous asset references", async () => {
    const store = new AssetService(env.storage).createStore(scope);
    const root = await env.storage.getStoragePath(scope);
    const assets = join(root, "assets");
    await mkdir(assets, { recursive: true });
    await writeFile(join(assets, "abcdef01111111111111111111111111"), PNG_BYTES);
    await writeFile(join(assets, "abcdef02222222222222222222222222"), PNG_BYTES);

    await expect(store.get("abc123")).rejects.toThrow("Invalid asset id");
    await expect(store.get("ABCDEF0")).rejects.toThrow("Invalid asset id");
    await expect(store.get("asset_abcdef0")).rejects.toThrow("Invalid asset id");
    await expect(store.get("1234567")).rejects.toThrow("Asset not found");
    await expect(store.get("abcdef0")).rejects.toThrow("Asset prefix is ambiguous");
  });

  it("clears only the current channel assets", async () => {
    const assets = new AssetService(env.storage);
    const first = assets.createStore(scope);
    const second = assets.createStore(otherScope);
    await first.put(PNG_BYTES);
    await second.put(PNG_BYTES);

    await first.clear();

    await expect(first.get(PNG_ID)).rejects.toThrow();
    await expect(second.get(PNG_ID)).resolves.toEqual(PNG_BYTES);
  });
});

describe("ArtifactService", () => {
  const env = useTemporaryStorage("yesimbot-binary-store-");

  it("creates tool-bound artifacts with UUID-v7 URIs", async () => {
    const artifacts = new ArtifactService(env.storage).createStore(scope);
    const uri = await artifacts.forTool("mcp_screenshot").put(PNG_BYTES, {
      filename: "screen.png",
      mediaType: "image/png",
    });

    expect(uri).toMatch(
      /^artifact:\/\/mcp_screenshot\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(await artifacts.open(uri)).toEqual({
      bytes: PNG_BYTES,
      mediaType: "image/png",
      filename: "screen.png",
    });
  });

  it("rejects unsafe tool names before joining artifact paths", async () => {
    const artifacts = new ArtifactService(env.storage).createStore(scope);
    expect(() => artifacts.forTool("../escape")).toThrow("Invalid artifact tool name");
    expect(() => artifacts.forTool("tool/name")).toThrow("Invalid artifact tool name");
    expect(() => artifacts.forTool("tool\\name")).toThrow("Invalid artifact tool name");
  });

  it("uses the Date.now timestamp in UUID-v7 identifiers", async () => {
    const now = 0x123456789ab;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const artifacts = new ArtifactService(env.storage).createStore(scope);
      const uri = await artifacts.forTool("timestamped").put(PNG_BYTES, {});
      const uuid = uri.split("/").at(-1)!;
      expect(uuid.replaceAll("-", "").slice(0, 12)).toBe(now.toString(16).padStart(12, "0"));
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("rejects unsafe artifact metadata on write", async () => {
    const artifacts = new ArtifactService(env.storage).createStore(scope);
    await expect(artifacts.forTool("test_tool").put(PNG_BYTES, { filename: "../secret.txt" })).rejects.toThrow(
      "Invalid artifact filename",
    );
    await expect(
      artifacts.forTool("test_tool").put(PNG_BYTES, { mediaType: { type: "image/png" } as never }),
    ).rejects.toThrow("Invalid artifact media type");
  });

  it("rejects corrupt artifact metadata fields on open", async () => {
    const artifacts = new ArtifactService(env.storage).createStore(scope);
    const uri = await artifacts.forTool("test_tool").put(PNG_BYTES, { filename: "test.png", mediaType: "image/png" });
    const uuid = uri.split("/").at(-1)!;
    const directory = join(await env.storage.getStoragePath(scope), "artifacts", "test_tool", uuid);
    await writeFile(
      join(directory, "metadata.json"),
      JSON.stringify({ filename: "../secret", byteLength: PNG_BYTES.length }),
    );
    await expect(artifacts.open(uri)).rejects.toThrow("Invalid artifact filename");

    await writeFile(join(directory, "metadata.json"), JSON.stringify({ filename: "test.png", byteLength: 0 }));
    await expect(artifacts.open(uri)).rejects.toThrow("Artifact metadata byte length mismatch");
  });

  it("preserves artifact identity across reads", async () => {
    const artifacts = new ArtifactService(env.storage).createStore(scope);
    const uri = await artifacts.forTool("test_tool").put(PNG_BYTES, {
      mediaType: "image/png",
    });

    const first = await artifacts.open(uri);
    const second = await artifacts.open(uri);
    expect(first.bytes).toEqual(second.bytes);
    expect(first.mediaType).toBe(second.mediaType);
  });

  it("rejects foreign-tool paths", async () => {
    const artifacts = new ArtifactService(env.storage).createStore(scope);
    const uri = await artifacts.forTool("tool_a").put(PNG_BYTES, {});

    // Try to open with a different tool name
    const foreignUri = uri.replace("tool_a", "tool_b");
    await expect(artifacts.open(foreignUri)).rejects.toThrow("Artifact not found");
  });

  it("rejects malformed UUIDs", async () => {
    const artifacts = new ArtifactService(env.storage).createStore(scope);
    await expect(artifacts.open("artifact://tool/not-a-uuid")).rejects.toThrow("Invalid artifact URI");
    await expect(artifacts.open("artifact://tool/00000000-0000-0000-0000-000000000000")).rejects.toThrow(
      "Invalid artifact URI",
    );
  });

  it("rejects metadata/data mismatch", async () => {
    const artifacts = new ArtifactService(env.storage).createStore(scope);
    const uri = await artifacts.forTool("test_tool").put(PNG_BYTES, {
      filename: "test.png",
      mediaType: "image/png",
    });

    // Corrupt the metadata
    const parsed = uri.match(/artifact:\/\/test_tool\/(.+)/);
    const storagePath = await env.storage.getStoragePath(scope);
    const directory = join(storagePath, "artifacts", "test_tool", parsed![1]);
    await writeFile(join(directory, "metadata.json"), "invalid json");

    await expect(artifacts.open(uri)).rejects.toThrow();
  });

  it("clears only the current channel artifacts", async () => {
    const artifacts = new ArtifactService(env.storage);
    const first = artifacts.createStore(scope);
    const second = artifacts.createStore(otherScope);

    const uri1 = await first.forTool("tool").put(PNG_BYTES, {});
    const uri2 = await second.forTool("tool").put(PNG_BYTES, {});

    await first.clear();

    await expect(first.open(uri1)).rejects.toThrow("Artifact not found");
    await expect(second.open(uri2)).resolves.toEqual({
      bytes: PNG_BYTES,
      mediaType: undefined,
      filename: undefined,
    });
  });
});
