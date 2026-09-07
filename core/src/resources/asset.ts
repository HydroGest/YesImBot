import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const COMPLETE_ID = /^[a-f0-9]{32}$/;
const PREFIX_ID = /^[a-f0-9]{7,31}$/;

export interface AssetStore {
  put(data: Uint8Array): Promise<string>;
  get(idOrPrefix: string): Promise<Uint8Array>;
  clear(): Promise<void>;
}

export class ChannelAssetStore implements AssetStore {
  public constructor(private readonly root: string) {}

  public async put(data: Uint8Array): Promise<string> {
    if (!(data instanceof Uint8Array)) throw new Error("Asset data must be bytes");
    const copied = data.slice();
    const id = createHash("sha256").update(copied).digest("hex").slice(0, 32);
    const filePath = this.path(id);
    const temporary = path.join(path.dirname(filePath), `.${id}.${randomUUID()}.tmp`);
    await mkdir(path.dirname(filePath), { recursive: true });
    try {
      await writeFile(temporary, copied, { flag: "wx" });
      await rename(temporary, filePath);
    } finally {
      await rm(temporary, { force: true });
    }
    return id;
  }

  public async get(idOrPrefix: string): Promise<Uint8Array> {
    if (COMPLETE_ID.test(idOrPrefix)) return new Uint8Array(await readFile(this.path(idOrPrefix)));
    if (!PREFIX_ID.test(idOrPrefix)) throw new Error("Invalid asset id");
    let candidates: string[];
    try {
      candidates = (await readdir(this.path())).filter((name) => COMPLETE_ID.test(name) && name.startsWith(idOrPrefix));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") candidates = [];
      else throw error;
    }
    if (candidates.length === 0) throw new Error("Asset not found");
    if (candidates.length > 1) throw new Error("Asset prefix is ambiguous");
    return new Uint8Array(await readFile(path.join(this.path(), candidates[0]!)));
  }

  public async clear(): Promise<void> {
    await rm(this.path(), { recursive: true, force: true });
  }

  private path(id?: string): string {
    const directory = path.join(this.root, "assets");
    return id === undefined ? directory : path.join(directory, id);
  }
}
