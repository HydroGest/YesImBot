import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ChannelResources } from "../src/resources/index.js";

describe("ChannelResources.open", () => {
  const roots: string[] = [];
  afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

  it("opens built-in assets and dispatches a registered reader", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-resource-"));
    roots.push(root);
    const resources = new ChannelResources(root);
    const id = await resources.assets.put(new Uint8Array([1, 2, 3]));
    await expect(resources.open(`asset://${id}`)).resolves.toMatchObject({ bytes: new Uint8Array([1, 2, 3]) });
    const init = vi.fn(async () => ({ bytes: new Uint8Array([4]), filename: "ok.txt" }));
    resources.use({ scheme: "test", prompt: "test reader", init });
    await expect(resources.open("test://host/file")).resolves.toMatchObject({ filename: "ok.txt" });
    expect(resources.listReaders()).toHaveLength(1);
  });

  it("returns undefined for malformed and unavailable URIs", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-resource-"));
    roots.push(root);
    const resources = new ChannelResources(root);
    await expect(resources.open("asset://short")).resolves.toBeUndefined();
    await expect(resources.open("missing://host/file")).resolves.toBeUndefined();
  });
});
