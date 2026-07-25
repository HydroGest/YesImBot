import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ChannelScope } from "../channel/index.js";
import type { ChannelStorage } from "../storage/index.js";
import { detectImageMime } from "./image-mime.js";

export interface AssetStoreOptions {
  storage: ChannelStorage;
  maxFileBytes: number;
}

export class AssetStore {
  private storage: ChannelStorage;
  private maxBytes: number;

  constructor(options: AssetStoreOptions) {
    this.storage = options.storage;
    this.maxBytes = options.maxFileBytes;
  }

  async put(scope: ChannelScope, data: Uint8Array): Promise<{ assetId: string; mime: string }> {
    if (!(data instanceof Uint8Array)) {
      throw new Error("Asset data must be bytes");
    }

    const mime = detectImageMime(data);
    if (!mime) {
      throw new Error("Unsupported image MIME type");
    }
    if (data.byteLength > this.maxBytes) {
      throw new Error(`Image exceeds ${this.maxBytes} bytes`);
    }

    const copied = data.slice();
    const hash = createHash("sha256").update(copied).digest("hex");
    const path = await this.assetPath(scope, hash);
    const temporary = join(dirname(path), `.${hash}.${randomUUID()}.tmp`);
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(temporary, copied, { flag: "wx" });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }

    return { assetId: `asset_${hash}`, mime };
  }

  async readByAssetId(scope: ChannelScope, assetId: string): Promise<Uint8Array> {
    const hash = assetId.startsWith("asset_") ? assetId.slice("asset_".length) : "";
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      throw new Error("Invalid platform asset id");
    }

    const data = new Uint8Array(await readFile(await this.assetPath(scope, hash)));
    const actual = createHash("sha256").update(data).digest("hex");
    if (actual !== hash) {
      throw new Error(`Platform asset ${assetId} failed integrity validation`);
    }
    return data;
  }

  async clear(scope: ChannelScope): Promise<void> {
    await rm(await this.assetPath(scope), { recursive: true, force: true });
  }

  private async assetPath(scope: ChannelScope, hash?: string): Promise<string> {
    return hash ? this.storage.ensure(scope, "assets", hash) : this.storage.ensure(scope, "assets");
  }
}
