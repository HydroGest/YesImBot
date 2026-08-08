import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ChannelArtifactStore } from "../src/resources/artifact.js";
import { ChannelAssetStore } from "../src/resources/asset.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const id = createHash("sha256").update(PNG).digest("hex").slice(0, 32);
const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("ChannelResources binary stores", () => {
  it("keeps asset IDs and artifact URIs, metadata, and clear lifecycles distinct", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-channel-resources-"));
    roots.push(root);
    const assets = new ChannelAssetStore(root);
    const artifacts = new ChannelArtifactStore(root);
    const source = PNG.slice();

    expect(await assets.put(source)).toBe(id);
    source[0] = 0;
    const uri = await artifacts.forTool("capture").put(PNG, { filename: "capture.png", mediaType: "image/png" });

    await expect(assets.get(id)).resolves.toEqual(PNG);
    await expect(artifacts.open(uri)).resolves.toEqual({ bytes: PNG, filename: "capture.png", mediaType: "image/png" });
    await assets.clear();
    await expect(assets.get(id)).rejects.toThrow();
    await expect(artifacts.open(uri)).resolves.toMatchObject({ bytes: PNG });
  });
});
