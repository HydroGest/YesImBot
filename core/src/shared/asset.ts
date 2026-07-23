import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ChannelScope } from "../channel/index.js";
import type { ChannelStorage } from "../storage/index.js";

export function detectImageMime(data: Uint8Array): string | undefined {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    return "image/jpeg";
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  )
    return "image/png";
  if (
    data.length >= 6 &&
    data[0] === 0x47 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x38 &&
    (data[4] === 0x37 || data[4] === 0x39) &&
    data[5] === 0x61
  )
    return "image/gif";
  if (
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  )
    return "image/webp";
  return undefined;
}

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
    return hash
      ? this.storage.ensure(scope, "assets", hash)
      : this.storage.ensure(scope, "assets");
  }
}
