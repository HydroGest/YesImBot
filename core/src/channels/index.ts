import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { Context, Logger } from "koishi";

import type { ImageBudget } from "../config.js";
import { Conversation } from "../conversations/index.js";
import { ChannelResources, type Disposer, type ResourceReader, type Resources } from "../resources/index.js";
export type ChannelScope =
  | {
      readonly type: "shared";
      readonly platform: string;
      readonly channelId: string;
      readonly guildId?: string;
      readonly channelName?: string;
      readonly guildName?: string;
    }
  | { readonly type: "direct"; readonly platform: string; readonly selfId: string; readonly channelId: string };
type ChannelManifest = ChannelScope & { readonly createdAt: string };

export interface ChannelsOptions {
  readonly basePath: string;
  readonly logLevel?: number;
  readonly imageBudget?: ImageBudget | null;
  readonly readTimeoutMs?: number;
}

export class Channel {
  public readonly resources: ChannelResources;
  public readonly conversation: Conversation;

  public constructor(
    public readonly scope: ChannelScope,
    public readonly root: string,
    imageBudget: ImageBudget | null = null,
    readTimeoutMs = 10_000,
  ) {
    this.resources = new ChannelResources(root, imageBudget, readTimeoutMs);
    this.conversation = new Conversation(root);
  }
}

export class Channels implements Resources {
  private readonly channelsPath: string;
  private readonly manifests = new Map<string, ChannelManifest>();
  private readonly channels = new Map<string, Channel>();
  private readonly creating = new Map<string, Promise<Channel>>();
  private readonly readers = new Map<string, ResourceReader>();
  private readonly readerDisposers = new Map<ResourceReader, Map<Channel, Disposer>>();
  private readonly imageBudget: ImageBudget | null;
  private readonly readTimeoutMs: number;
  private readonly logger: Logger;
  private readonly started: Promise<void>;

  public constructor(ctx: Context, options: ChannelsOptions) {
    this.channelsPath = resolve(options.basePath, "channels");
    this.imageBudget = options.imageBudget ?? null;
    this.readTimeoutMs = options.readTimeoutMs ?? 10_000;
    this.logger = ctx.logger("channels");
    this.logger.level = options.logLevel ?? 2;
    this.started = this.scan();
  }

  public start(): Promise<void> {
    return this.started;
  }

  public async resolve(scope: ChannelScope): Promise<Channel> {
    assertScope(scope);
    await this.started;
    const key = scopeMapKey(scope);
    const cached = this.channels.get(key);
    if (cached) return cached;
    const creating = this.creating.get(key);
    if (creating) return creating;
    const task = this.create(scope, key);
    this.creating.set(key, task);
    try {
      return await task;
    } finally {
      this.creating.delete(key);
    }
  }

  public async get(scope: ChannelScope): Promise<ChannelResources> {
    return (await this.resolve(scope)).resources;
  }

  public use(reader: ResourceReader): Disposer {
    if (this.readers.has(reader.scheme)) throw new Error(`Resource reader for scheme "${reader.scheme}" is already registered`);
    const disposers = new Map<Channel, Disposer>();
    this.readers.set(reader.scheme, reader);
    this.readerDisposers.set(reader, disposers);
    for (const channel of this.channels.values()) {
      disposers.set(channel, channel.resources.use(reader));
    }
    return () => {
      if (this.readers.get(reader.scheme) !== reader) return;
      this.readers.delete(reader.scheme);
      this.readerDisposers.delete(reader);
      for (const dispose of disposers.values()) dispose();
    };
  }

  public async reset(scope: ChannelScope): Promise<void> {
    const channel = await this.resolve(scope);
    await Promise.all([
      fs.rm(join(channel.root, "sessions"), { recursive: true, force: true }),
      channel.resources.assets.clear(),
      channel.resources.artifacts.clear(),
    ]);
    this.channels.delete(scopeKey(scope));
  }

  private async create(scope: ChannelScope, key: string): Promise<Channel> {
    const root = await this.ensureRoot(scope);
    const channel = new Channel(scope, root, this.imageBudget, this.readTimeoutMs);
    for (const reader of this.readers.values()) {
      this.readerDisposers.get(reader)!.set(channel, channel.resources.use(reader));
    }
    await channel.conversation.init();
    this.channels.set(key, channel);
    return channel;
  }

  private async scan(): Promise<void> {
    await fs.mkdir(this.channelsPath, { recursive: true });
    for (const entry of await fs.readdir(this.channelsPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        this.logger.error("storage.directory.invalid", { entry: entry.name });
        continue;
      }
      try {
        const manifest = parseManifest(JSON.parse(await fs.readFile(join(this.channelsPath, entry.name, "channel.json"), "utf8")));
        if (channelDirectoryName(manifest) !== entry.name) throw new Error("Manifest directory name does not match directory");
        this.manifests.set(scopeKey(manifest), manifest);
      } catch (cause) {
        this.logger.error("storage.manifest_invalid", { directoryName: entry.name, cause });
      }
    }
  }

  private async ensureRoot(scope: ChannelScope): Promise<string> {
    const key = scopeKey(scope);
    if (!this.manifests.has(key)) {
      const directory = channelDirectoryName(scope);
      const root = join(this.channelsPath, directory);
      try {
        const stat = await fs.lstat(root);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Channel storage destination is not a directory");
        const manifest = parseManifest(JSON.parse(await fs.readFile(join(root, "channel.json"), "utf8")));
        if (scopeKey(manifest) !== key) throw new Error("Channel storage integrity mismatch");
        this.manifests.set(key, manifest);
      } catch (cause) {
        if (!(typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT")) throw cause;
        const temporary = join(this.channelsPath, `.${directory}.${randomUUID()}.tmp`);
        const manifest = { ...scope, createdAt: new Date().toISOString() } as ChannelManifest;
        try {
          await fs.mkdir(temporary);
          await fs.writeFile(join(temporary, "channel.json"), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
          await fs.rename(temporary, root);
        } finally {
          await fs.rm(temporary, { recursive: true, force: true });
        }
        this.manifests.set(key, manifest);
      }
    }
    const root = join(this.channelsPath, channelDirectoryName(scope));
    if ((await fs.lstat(root)).isSymbolicLink()) throw new Error("Channel directory is a symbolic link");
    const realRoot = await fs.realpath(root);
    const rel = relative(this.channelsPath, realRoot);
    if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) throw new Error("Resolved storage path escapes its channel root");
    return root;
  }
}

export function scopeMapKey(scope: ChannelScope): string {
  return scope.type === "direct" ? `direct:${scope.platform}:${scope.selfId}:${scope.channelId}` : `shared:${scope.platform}:${scope.channelId}`;
}

export function channelDirectoryName(scope: ChannelScope): string {
  assertScope(scope);
  const encode = (value: string): string => [...value].map((char) => (/[A-Za-z0-9]/.test(char) ? char : `%${char.codePointAt(0)!.toString(16)}%`)).join("");
  return (
    scope.type === "direct"
      ? ["direct", encode(scope.platform), encode(scope.channelId), encode(scope.selfId)]
      : ["shared", encode(scope.platform), encode(scope.channelId)]
  ).join("-");
}

function scopeKey(scope: ChannelScope): string {
  return scopeMapKey(scope);
}

function assertScope(scope: ChannelScope): void {
  if (scope.type !== "shared" && scope.type !== "direct") throw new TypeError("ChannelScope.type must be 'shared' or 'direct'");
  if (typeof scope.platform !== "string" || scope.platform.length === 0) throw new TypeError("ChannelScope.platform must be a non-empty string");
  if (typeof scope.channelId !== "string" || scope.channelId.length === 0) throw new TypeError("ChannelScope.channelId must be a non-empty string");
  if (scope.type === "direct" && (typeof scope.selfId !== "string" || scope.selfId.length === 0))
    throw new TypeError("ChannelScope.selfId must be a non-empty string");
  if (scope.type === "shared" && scope.guildId !== undefined && (typeof scope.guildId !== "string" || scope.guildId.length === 0))
    throw new TypeError("ChannelScope.guildId must be a non-empty string when present");
  if (scope.type === "shared" && scope.channelName !== undefined && (typeof scope.channelName !== "string" || scope.channelName.length === 0))
    throw new TypeError("ChannelScope.channelName must be a non-empty string when present");
  if (scope.type === "shared" && scope.guildName !== undefined && (typeof scope.guildName !== "string" || scope.guildName.length === 0))
    throw new TypeError("ChannelScope.guildName must be a non-empty string when present");
}

function parseManifest(value: unknown): ChannelManifest {
  if (typeof value !== "object" || value === null) throw new Error("Channel manifest is not an object");
  const manifest = value as Partial<ChannelManifest>;
  if (manifest.type !== "shared" && manifest.type !== "direct") throw new Error("Channel manifest type is invalid");
  if (typeof manifest.platform !== "string" || typeof manifest.channelId !== "string" || typeof manifest.createdAt !== "string")
    throw new Error("Channel manifest is invalid");
  if (manifest.type === "direct" && typeof manifest.selfId !== "string") throw new Error("Channel manifest selfId is invalid");
  return manifest as ChannelManifest;
}
