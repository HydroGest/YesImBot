import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"]);
export class StickerFileStore {
  private readonly root: string;

  public constructor(baseDir: string, storagePath: string) {
    this.root = join(resolve(baseDir, storagePath), "files");
  }

  public get directory(): string {
    return this.root;
  }

  public async ensure(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  public async write(bytes: Uint8Array, contentId: string): Promise<void> {
    await this.ensure();
    const target = this.path(contentId);
    if (await this.exists(contentId)) return;
    const temporary = join(this.root, `.${contentId}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, bytes, { flag: "wx" });
      await rename(temporary, target);
    } catch (cause) {
      await rm(temporary, { force: true });
      if (await this.exists(contentId)) return;
      throw cause;
    }
  }

  public async read(contentId: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.path(contentId)));
  }

  public async exists(contentId: string): Promise<boolean> {
    try {
      await stat(this.path(contentId));
      return true;
    } catch {
      return false;
    }
  }

  public async list(): Promise<string[]> {
    try {
      const entries = await readdir(this.root);
      return entries.filter((name) => !name.startsWith("."));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw cause;
    }
  }

  public async remove(contentId: string): Promise<void> {
    await rm(this.path(contentId), { force: true });
  }

  private path(contentId: string): string {
    return join(this.root, contentId);
  }
}
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function detectImageMediaType(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return "image/bmp";
  }
  if (startsWithAscii(bytes, "<?xml") || startsWithAscii(bytes, "<svg")) {
    return "image/svg+xml";
  }
  return undefined;
}
function startsWithAscii(bytes: Uint8Array, prefix: string): boolean {
  if (bytes.length < prefix.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (bytes[index] !== prefix.charCodeAt(index)) return false;
  }
  return true;
}
export function isSupportedImageFile(filename: string): boolean {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return false;
  return IMAGE_EXTENSIONS.has(filename.slice(dot + 1).toLowerCase());
}
