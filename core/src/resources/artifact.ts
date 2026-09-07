import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const SAFE_ARTIFACT_NAME = /^[a-zA-Z0-9_-]+$/;
const SAFE_MEDIA_TYPE = /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/;

export interface ArtifactOpenResult {
  readonly bytes: Uint8Array;
  readonly mediaType?: string;
  readonly filename?: string;
}

export interface ArtifactWriter {
  put(bytes: Uint8Array, metadata: { mediaType?: string; filename?: string }): Promise<string>;
}

export interface ArtifactStore {
  forTool(toolName: string): ArtifactWriter;
  open(uri: string): Promise<ArtifactOpenResult>;
  clear(): Promise<void>;
}

export class ChannelArtifactStore implements ArtifactStore {
  public constructor(private readonly root: string) {}

  public forTool(toolName: string): ArtifactWriter {
    assertSafeArtifactName(toolName);
    return new ChannelArtifactWriter(this.root, toolName);
  }

  public async open(uri: string): Promise<ArtifactOpenResult> {
    const parsed = parseArtifactUri(uri);
    if (!parsed) throw new Error("Invalid artifact URI");
    const directory = path.join(this.path(), parsed.toolName, parsed.uuid);
    try {
      const [bytes, metadataRaw] = await Promise.all([readFile(path.join(directory, "data")), readFile(path.join(directory, "metadata.json"), "utf-8")]);
      const metadata = parseMetadata(JSON.parse(metadataRaw), bytes.byteLength);
      return { bytes: new Uint8Array(bytes), mediaType: metadata.mediaType, filename: metadata.filename };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Artifact not found");
      throw error;
    }
  }

  public async clear(): Promise<void> {
    await rm(this.path(), { recursive: true, force: true });
  }

  private path(): string {
    return path.join(this.root, "artifacts");
  }
}

class ChannelArtifactWriter implements ArtifactWriter {
  public constructor(
    private readonly root: string,
    private readonly toolName: string,
  ) {}

  public async put(bytes: Uint8Array, metadata: { mediaType?: string; filename?: string }): Promise<string> {
    if (!(bytes instanceof Uint8Array)) throw new Error("Artifact data must be bytes");
    const normalized = parseMetadata({ ...metadata, byteLength: bytes.byteLength }, bytes.byteLength);
    const uuid = generateUuidV7();
    const base = path.join(this.root, "artifacts", this.toolName);
    const directory = path.join(base, uuid);
    const temporary = path.join(base, `.${uuid}.tmp`);
    await mkdir(temporary, { recursive: true });
    await Promise.all([writeFile(path.join(temporary, "data"), bytes), writeFile(path.join(temporary, "metadata.json"), JSON.stringify(normalized))]);
    await rename(temporary, directory);
    return `artifact://${this.toolName}/${uuid}`;
  }
}

function assertSafeArtifactName(name: string): void {
  if (typeof name !== "string" || !SAFE_ARTIFACT_NAME.test(name)) throw new Error("Invalid artifact tool name");
}

function parseMetadata(value: unknown, byteLength: number): { filename?: string; mediaType?: string; byteLength: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid artifact metadata");
  const metadata = value as Record<string, unknown>;
  if (Object.keys(metadata).some((key) => !["filename", "mediaType", "byteLength"].includes(key))) throw new Error("Invalid artifact metadata");
  const filename = metadata.filename;
  if (filename !== undefined && (typeof filename !== "string" || !isSafeBasename(filename))) throw new Error("Invalid artifact filename");
  const mediaType = metadata.mediaType;
  if (mediaType !== undefined && (typeof mediaType !== "string" || !SAFE_MEDIA_TYPE.test(mediaType))) throw new Error("Invalid artifact media type");
  if (metadata.byteLength !== byteLength || !Number.isSafeInteger(metadata.byteLength) || metadata.byteLength < 0)
    throw new Error("Artifact metadata byte length mismatch");
  return { ...(filename === undefined ? {} : { filename }), ...(mediaType === undefined ? {} : { mediaType }), byteLength };
}

function isSafeBasename(filename: string): boolean {
  return filename.length > 0 && filename !== "." && filename !== ".." && !/[\\/\0]/.test(filename);
}

function parseArtifactUri(uri: string): { toolName: string; uuid: string } | undefined {
  const match = uri.match(/^artifact:\/\/([a-zA-Z0-9_-]+)\/([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/);
  if (!match) return undefined;
  assertSafeArtifactName(match[1]!);
  return { toolName: match[1]!, uuid: match[2]! };
}

function generateUuidV7(): string {
  let timestamp = Date.now();
  const bytes = randomBytes(16);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp % 256;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join("-");
}
