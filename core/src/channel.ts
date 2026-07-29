import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export interface ChannelScope {
  readonly platform: string;
  readonly selfId: string;
  readonly channelId: string;
  readonly isDirect: boolean;
}

interface ChannelManifest {
  readonly platform: string;
  readonly channelId: string;
  readonly selfId?: string;
  readonly createdAt: string;
}

type PersistentTuple = readonly [string, string] | readonly [string, string, string];

const MAX_DIRECTORY_NAME_LENGTH = 200;

function isMissingPath(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";
}

function assertScope(scope: ChannelScope): void {
  for (const field of ["platform", "selfId", "channelId"] as const) {
    if (typeof scope[field] !== "string" || scope[field].length === 0)
      throw new TypeError(`ChannelScope.${field} must be a non-empty string`);
  }
  if (typeof scope.isDirect !== "boolean") throw new TypeError("ChannelScope.isDirect must be a boolean");
}

function encodeDirectoryComponent(value: string): string {
  let encoded = "";
  for (const codePoint of value) {
    encoded += /[A-Za-z0-9]/.test(codePoint)
      ? codePoint
      : `~${codePoint.codePointAt(0)?.toString(16)}~`;
  }
  return encoded;
}

function persistentTuple(scope: ChannelScope): PersistentTuple {
  assertScope(scope);
  return scope.isDirect
    ? [scope.platform, scope.selfId, scope.channelId]
    : [scope.platform, scope.channelId];
}

export function scopeMapKey(scope: ChannelScope): string {
  return JSON.stringify(persistentTuple(scope));
}

export function channelDirectoryName(scope: ChannelScope): string {
  const tuple = persistentTuple(scope);
  const directoryName = scope.isDirect
    ? `direct-${encodeDirectoryComponent(scope.platform)}-${encodeDirectoryComponent(scope.channelId)}-${encodeDirectoryComponent(scope.selfId)}`
    : `shared-${encodeDirectoryComponent(tuple[0])}-${encodeDirectoryComponent(tuple[1])}`;
  if (directoryName.length > MAX_DIRECTORY_NAME_LENGTH)
    throw new RangeError(`Channel directory name exceeds ${MAX_DIRECTORY_NAME_LENGTH} characters`);
  return directoryName;
}

function manifestFor(scope: ChannelScope): ChannelManifest {
  return scope.isDirect
    ? {
        platform: scope.platform,
        channelId: scope.channelId,
        selfId: scope.selfId,
        createdAt: new Date().toISOString(),
      }
    : { platform: scope.platform, channelId: scope.channelId, createdAt: new Date().toISOString() };
}

function scopeFromManifest(manifest: ChannelManifest): ChannelScope {
  return {
    platform: manifest.platform,
    selfId: manifest.selfId ?? "shared",
    channelId: manifest.channelId,
    isDirect: manifest.selfId !== undefined,
  };
}

function parseManifest(value: unknown): ChannelManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("Channel manifest must be an object");
  const fields = value as Record<string, unknown>;
  const allowed = fields.selfId === undefined
    ? ["platform", "channelId", "createdAt"]
    : ["platform", "channelId", "selfId", "createdAt"];
  if (Object.keys(fields).length !== allowed.length || !allowed.every((field) => field in fields))
    throw new TypeError("Channel manifest fields are invalid");
  for (const field of ["platform", "channelId", "createdAt"] as const) {
    if (typeof fields[field] !== "string" || fields[field].length === 0)
      throw new TypeError(`Channel manifest ${field} is invalid`);
  }
  if (fields.selfId !== undefined && (typeof fields.selfId !== "string" || fields.selfId.length === 0))
    throw new TypeError("Channel manifest selfId is invalid");
  return {
    platform: fields.platform as string,
    channelId: fields.channelId as string,
    ...(fields.selfId === undefined ? {} : { selfId: fields.selfId as string }),
    createdAt: fields.createdAt as string,
  };
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, path);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export class ChannelStorage {
  private readonly channelsPath: string;
  private readonly manifests = new Map<string, ChannelManifest>();
  private tail: Promise<void> = Promise.resolve();
  private startTask: Promise<void> | undefined;

  constructor(
    basePath: string,
    private readonly warn: (code: string, fields: Record<string, unknown>) => void = () => {},
  ) {
    this.channelsPath = resolve(basePath, "channels");
  }

  start(): Promise<void> {
    if (!this.startTask) this.startTask = this.startInternal();
    return this.startTask;
  }

  async getStoragePath(scope: ChannelScope): Promise<string> {
    await this.start();
    const manifest = await this.enqueue(() => this.ensureChannel(scope));
    const root = join(this.channelsPath, channelDirectoryName(scope));
    await this.assertChannelRoot(root);
    if (scopeMapKey(scope) !== scopeMapKey(scopeFromManifest(manifest)))
      throw new Error("Channel storage integrity mismatch");
    return root;
  }

  private async startInternal(): Promise<void> {
    await fs.mkdir(this.channelsPath, { recursive: true });
    for (const entry of await fs.readdir(this.channelsPath, { withFileTypes: true })) {
      if (!entry.isDirectory() || (!entry.name.startsWith("shared-") && !entry.name.startsWith("direct-"))) {
        this.warn("storage.directory_invalid", { entry: entry.name });
        continue;
      }
      try {
        const manifest = parseManifest(
          JSON.parse(await fs.readFile(join(this.channelsPath, entry.name, "channel.json"), "utf8")),
        );
        const scope = scopeFromManifest(manifest);
        if (channelDirectoryName(scope) !== entry.name)
          throw new Error("Manifest directory name does not match directory");
        this.manifests.set(scopeMapKey(scope), manifest);
      } catch (cause) {
        this.warn("storage.manifest_invalid", { directoryName: entry.name, cause });
      }
    }
  }

  private async ensureChannel(scope: ChannelScope): Promise<ChannelManifest> {
    const key = scopeMapKey(scope);
    const known = this.manifests.get(key);
    if (known) return known;
    const directoryName = channelDirectoryName(scope);
    const destination = join(this.channelsPath, directoryName);
    try {
      const stat = await fs.lstat(destination);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("Channel storage destination is not a directory");
      const manifest = parseManifest(JSON.parse(await fs.readFile(join(destination, "channel.json"), "utf8")));
      if (scopeMapKey(scopeFromManifest(manifest)) !== key)
        throw new Error("Channel storage integrity mismatch");
      this.manifests.set(key, manifest);
      return manifest;
    } catch (cause) {
      if (!isMissingPath(cause)) throw cause;
    }

    const manifest = manifestFor(scope);
    const temporary = join(this.channelsPath, `.${directoryName}.${randomUUID()}.tmp`);
    try {
      await fs.mkdir(temporary);
      await writeJsonAtomic(join(temporary, "channel.json"), manifest);
      await fs.rename(temporary, destination);
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
    this.manifests.set(key, manifest);
    return manifest;
  }

  private async assertChannelRoot(channelRoot: string): Promise<void> {
    if ((await fs.lstat(channelRoot)).isSymbolicLink())
      throw new Error("Channel directory is a symbolic link");
    const realRoot = await fs.realpath(channelRoot);
    this.assertContained(this.channelsPath, realRoot);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private assertContained(root: string, path: string): void {
    const rel = relative(root, path);
    if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) return;
    throw new Error("Resolved storage path escapes its channel root");
  }
}
