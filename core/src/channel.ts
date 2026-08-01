import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { Context, Logger } from "koishi";

const MAX_DIRECTORY_NAME_LENGTH = 200;

interface SharedChannelScope {
  type: "shared";
  platform: string;
  channelId: string;
  selfId: string;
}

interface DirectChannelScope {
  type: "direct";
  platform: string;
  selfId: string;
  channelId: string;
}

export type ChannelScope = SharedChannelScope | DirectChannelScope;

type ChannelManifest = ChannelScope & { createdAt: string };

export class ChannelStorage {
  private readonly channelsPath: string;
  private readonly manifests = new Map<string, ChannelManifest>();

  private readonly ctx: Context;
  private readonly logger: Logger;

  constructor(ctx: Context, basePath: string) {
    this.ctx = ctx;
    this.logger = ctx.logger("channel-storage");
    this.channelsPath = resolve(basePath, "channels");
  }

  public async start(): Promise<void> {
    await fs.mkdir(this.channelsPath, { recursive: true });
    for (const entry of await fs.readdir(this.channelsPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        this.logger.error("storage.directory.invalid", { entry: entry.name });
        continue;
      }
      try {
        const manifest = parseManifest(
          JSON.parse(
            await fs.readFile(join(this.channelsPath, entry.name, "channel.json"), "utf8"),
          ),
        );
        const scope = scopeFromManifest(manifest);
        if (channelDirectoryName(scope) !== entry.name)
          throw new Error("Manifest directory name does not match directory");
        this.manifests.set(channelStorageKey(scope), manifest);
      } catch (cause) {
        this.logger.error("storage.manifest_invalid", { directoryName: entry.name, cause });
      }
    }
  }

  public async getStoragePath(scope: ChannelScope): Promise<string> {
    await this.start();
    await this.ensureChannel(scope);
    const root = join(this.channelsPath, channelDirectoryName(scope));
    await this.assertChannelRoot(root);
    return root;
  }

  private async assertChannelRoot(channelRoot: string): Promise<void> {
    if ((await fs.lstat(channelRoot)).isSymbolicLink())
      throw new Error("Channel directory is a symbolic link");
    const realRoot = await fs.realpath(channelRoot);
    this.assertContained(this.channelsPath, realRoot);
  }

  private assertContained(root: string, path: string): void {
    const rel = relative(root, path);
    if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) return;
    throw new Error("Resolved storage path escapes its channel root");
  }

  private async ensureChannel(scope: ChannelScope): Promise<ChannelManifest> {
    assertScope(scope);
    const key = channelStorageKey(scope);
    const known = this.manifests.get(key);
    if (known) return known;

    const directoryName = channelDirectoryName(scope);
    const destination = join(this.channelsPath, directoryName);
    try {
      const stat = await fs.lstat(destination);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("Channel storage destination is not a directory");
      const manifest = parseManifest(
        JSON.parse(await fs.readFile(join(destination, "channel.json"), "utf8")),
      );
      if (channelStorageKey(scopeFromManifest(manifest)) !== key)
        throw new Error("Channel storage integrity mismatch");
      this.manifests.set(key, manifest);
      return manifest;
    } catch (cause) {
      if (
        !(typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT")
      )
        throw cause;
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
}

export function scopeMapKey(scope: ChannelScope): string {
  return scope.type === "direct"
    ? `direct:${scope.platform}:${scope.selfId}:${scope.channelId}`
    : `shared:${scope.platform}:${scope.selfId}:${scope.channelId}`;
}

function channelStorageKey(scope: ChannelScope): string {
  return scope.type === "direct"
    ? `direct:${scope.platform}:${scope.selfId}:${scope.channelId}`
    : `shared:${scope.platform}:${scope.channelId}`;
}

function assertScope(scope: ChannelScope): void {
  if (typeof scope.platform !== "string" || scope.platform.length === 0)
    throw new TypeError("ChannelScope.platform must be a non-empty string");
  if (typeof scope.channelId !== "string" || scope.channelId.length === 0)
    throw new TypeError("ChannelScope.channelId must be a non-empty string");
  if (typeof scope.selfId !== "string" || scope.selfId.length === 0)
    throw new TypeError("ChannelScope.selfId must be a non-empty string");
  if (scope.type !== "shared" && scope.type !== "direct")
    throw new TypeError("ChannelScope.type must be 'shared' or 'direct'");
}

function encodeDirectoryComponent(value: string): string {
  let encoded = "";
  for (const codePoint of value) {
    encoded += /[A-Za-z0-9]/.test(codePoint)
      ? codePoint
      : `%${codePoint.codePointAt(0)?.toString(16)}%`;
  }
  return encoded;
}

export function channelDirectoryName(scope: ChannelScope): string {
  assertScope(scope);
  const directoryName = (
    scope.type === "direct"
      ? [
          "direct",
          encodeDirectoryComponent(scope.platform),
          encodeDirectoryComponent(scope.channelId),
          encodeDirectoryComponent(scope.selfId),
        ]
      : [
          "shared",
          encodeDirectoryComponent(scope.platform),
          encodeDirectoryComponent(scope.channelId),
        ]
  ).join("-");
  if (directoryName.length > MAX_DIRECTORY_NAME_LENGTH)
    throw new RangeError(`Channel directory name exceeds ${MAX_DIRECTORY_NAME_LENGTH} characters`);
  return directoryName;
}

function manifestFor(scope: ChannelScope): ChannelManifest {
  return scope.type === "direct"
    ? {
        type: "direct",
        platform: scope.platform,
        selfId: scope.selfId,
        channelId: scope.channelId,
        createdAt: new Date().toISOString(),
      }
    : {
        type: "shared",
        platform: scope.platform,
        selfId: scope.selfId,
        channelId: scope.channelId,
        createdAt: new Date().toISOString(),
      };
}

function scopeFromManifest(manifest: ChannelManifest): ChannelScope {
  return manifest.type === "direct"
    ? {
        type: "direct",
        platform: manifest.platform,
        selfId: manifest.selfId,
        channelId: manifest.channelId,
      }
    : {
        type: "shared",
        platform: manifest.platform,
        selfId: manifest.selfId,
        channelId: manifest.channelId,
      };
}

function parseManifest(value: unknown): ChannelManifest {
  if (typeof value !== "object" || value === null)
    throw new Error("Channel manifest is not an object");
  const manifest = value as Partial<ChannelManifest>;
  if (manifest.type !== "shared" && manifest.type !== "direct")
    throw new Error("Channel manifest type is invalid");
  if (typeof manifest.platform !== "string")
    throw new Error("Channel manifest platform is invalid");
  if (typeof manifest.channelId !== "string")
    throw new Error("Channel manifest channelId is invalid");
  if (typeof manifest.selfId !== "string") throw new Error("Channel manifest selfId is invalid");
  if (typeof manifest.createdAt !== "string")
    throw new Error("Channel manifest createdAt is invalid");
  return manifest as ChannelManifest;
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await fs.rename(temporary, path);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
