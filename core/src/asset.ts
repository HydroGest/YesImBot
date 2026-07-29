import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { h, type Element } from "koishi";

import type { ChannelScope, ChannelStorage } from "./channel.js";

const COMPLETE_ID = /^[a-f0-9]{32}$/;
const PREFIX_ID = /^[a-f0-9]{7,31}$/;

export interface AssetService {
  createStore(scope: ChannelScope): AssetStore;
}

export interface AssetStore {
  put(data: Uint8Array): Promise<Element>;
  get(idOrPrefix: string): Promise<Uint8Array>;
  clear(): Promise<void>;
}

export function createAssetService(storage: ChannelStorage): AssetService {
  return {
    createStore(scope) {
      return new ScopedAssetStore(storage, scope);
    },
  };
}

class ScopedAssetStore implements AssetStore {
  constructor(
    private readonly storage: ChannelStorage,
    private readonly scope: ChannelScope,
  ) {}

  async put(data: Uint8Array): Promise<Element> {
    if (!(data instanceof Uint8Array)) throw new Error("Asset data must be bytes");
    const copied = data.slice();
    const id = createHash("sha256").update(copied).digest("hex").slice(0, 32);
    const path = await this.path(id);
    const temporary = join(dirname(path), `.${id}.${randomUUID()}.tmp`);
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(temporary, copied, { flag: "wx" });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
    return h("img", { id });
  }

  async get(idOrPrefix: string): Promise<Uint8Array> {
    if (COMPLETE_ID.test(idOrPrefix)) return new Uint8Array(await readFile(await this.path(idOrPrefix)));
    if (!PREFIX_ID.test(idOrPrefix)) throw new Error("Invalid asset id");
    const directory = await this.path();
    let candidates: string[];
    try {
      candidates = (await readdir(directory)).filter(
        (name) => COMPLETE_ID.test(name) && name.startsWith(idOrPrefix),
      );
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") candidates = [];
      else throw cause;
    }
    if (candidates.length === 0) throw new Error("Asset not found");
    if (candidates.length > 1) throw new Error("Asset prefix is ambiguous");
    return new Uint8Array(await readFile(join(directory, candidates[0]!)));
  }

  async clear(): Promise<void> {
    await rm(await this.path(), { recursive: true, force: true });
  }

  private async path(id?: string): Promise<string> {
    const directory = join(await this.storage.getStoragePath(this.scope), "assets");
    return id === undefined ? directory : join(directory, id);
  }
}
