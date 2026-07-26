import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { ChannelScope } from "../channel/index.js";
import {
  CHANNEL_DIRECTORY_VERSION,
  CHANNEL_FORMAT_VERSION,
  CHANNEL_IDENTITY_VERSION,
  channelRecord,
  parseChannelManifest,
  type ChannelManifest,
  type ChannelRecord,
} from "./manifest.js";

const NAMESPACE_PATTERN = /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function isMissingPath(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";
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

export class ChannelStorage {
  private readonly channelsPath: string;
  private readonly records = new Map<string, ChannelRecord>();
  private readonly namespaces = new Map<string, symbol>();
  private tail: Promise<void> = Promise.resolve();
  private startTask: Promise<void> | undefined;

  constructor(
    basePath: string,
    private readonly warn: (code: string, fields: Record<string, unknown>) => void = () => {},
  ) {
    this.channelsPath = resolve(basePath, "channels");
    this.namespaces.set("sessions", Symbol("sessions"));
    this.namespaces.set("assets", Symbol("assets"));
  }

  start(): Promise<void> {
    if (!this.startTask) this.startTask = this.startInternal();
    return this.startTask;
  }

  register(namespace: string): () => void {
    if (!NAMESPACE_PATTERN.test(namespace) || WINDOWS_RESERVED.test(namespace)) {
      throw new TypeError(`Invalid storage namespace: ${JSON.stringify(namespace)}`);
    }
    if (this.namespaces.has(namespace))
      throw new Error(`Storage namespace already registered: ${namespace}`);
    const owner = Symbol(namespace);
    this.namespaces.set(namespace, owner);
    return () => {
      if (this.namespaces.get(namespace) === owner) this.namespaces.delete(namespace);
    };
  }

  async ensure(scope: ChannelScope, namespace: string, ...segments: string[]): Promise<string> {
    await this.start();
    for (const segment of segments) this.assertSegment(segment);
    if (!this.namespaces.has(namespace))
      throw new Error(`Storage namespace is not registered: ${namespace}`);
    const record = await this.enqueue(() => this.ensureChannel(scope));
    const channelRoot = resolve(this.channelsPath, record.directoryName);
    const root = resolve(channelRoot, namespace);
    this.assertContained(channelRoot, root);
    await this.assertChannelRoot(channelRoot);
    let rootExists = false;
    try {
      const namespaceStat = await fs.lstat(root);
      if (namespaceStat.isSymbolicLink()) throw new Error("Namespace root is a symbolic link");
      rootExists = true;
    } catch (cause) {
      if (!isMissingPath(cause)) throw cause;
    }
    if (!rootExists) await fs.mkdir(root, { recursive: true });
    await this.assertChannelRoot(channelRoot);
    const namespaceStat = await fs.lstat(root);
    if (namespaceStat.isSymbolicLink()) throw new Error("Namespace root is a symbolic link");
    const realRoot = await fs.realpath(root);
    this.assertContained(channelRoot, realRoot);
    const path = resolve(root, ...segments);
    let check = root;
    for (const segment of segments) {
      check = resolve(check, segment);
      try {
        if ((await fs.lstat(check)).isSymbolicLink())
          throw new Error("Storage path segment is a symbolic link");
      } catch (cause) {
        if (!isMissingPath(cause)) throw cause;
        break;
      }
    }
    this.assertContained(root, path);
    return path;
  }

  async updateName(scope: ChannelScope, name: string | undefined): Promise<void> {
    if (!name) return;
    await this.start();
    await this.enqueue(async () => {
      const record = await this.ensureChannel(scope);
      if (record.name === name) return;
      const manifest = this.toManifest(channelRecord(scope, name));
      await writeJsonAtomic(
        join(this.channelsPath, record.directoryName, "channel.json"),
        manifest,
      );
      this.records.set(record.identity, channelRecord(scope, name));
    });
  }

  private async startInternal(): Promise<void> {
    await fs.mkdir(this.channelsPath, { recursive: true });
    const entries = await fs.readdir(this.channelsPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("v1-")) {
        this.warn("storage.directory_invalid", { entry: entry.name });
        continue;
      }
      try {
        const manifest = parseChannelManifest(
          JSON.parse(
            await fs.readFile(join(this.channelsPath, entry.name, "channel.json"), "utf8"),
          ),
        );
        if (manifest.directoryName !== entry.name)
          throw new Error("Manifest directory name does not match directory");
        const record = this.toRecord(manifest);
        this.records.set(record.identity, record);
        await this.reportUnregisteredNamespaces(entry.name);
      } catch (cause) {
        this.warn("storage.manifest_invalid", { directoryName: entry.name, cause });
      }
    }
  }

  private async ensureChannel(scope: ChannelScope): Promise<ChannelRecord> {
    const expected = channelRecord(scope);
    const known = this.records.get(expected.identity);
    if (known) {
      if (!this.sameIdentity(known, expected)) throw new Error("Channel storage identity mismatch");
      return known;
    }
    const destination = join(this.channelsPath, expected.directoryName);
    try {
      const destinationStat = await fs.stat(destination);
      if (!destinationStat.isDirectory())
        throw new Error("Channel storage destination is not a directory");
      await this.assertChannelRoot(destination);
      const manifest = parseChannelManifest(
        JSON.parse(await fs.readFile(join(destination, "channel.json"), "utf8")),
      );
      if (!this.sameIdentity(manifest, expected))
        throw new Error("Channel storage integrity mismatch");
      const record = this.toRecord(manifest);
      this.records.set(record.identity, record);
      return record;
    } catch (cause) {
      if (!isMissingPath(cause)) throw cause;
    }
    await this.createChannel(this.toManifest(expected));
    this.records.set(expected.identity, expected);
    return expected;
  }

  private async createChannel(manifest: ChannelManifest): Promise<void> {
    const destination = join(this.channelsPath, manifest.directoryName);
    const temporary = join(this.channelsPath, `.${manifest.directoryName}.${randomUUID()}.tmp`);
    try {
      await fs.mkdir(temporary);
      await writeJsonAtomic(join(temporary, "channel.json"), manifest);
      await fs.rename(temporary, destination);
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }

  private async assertChannelRoot(channelRoot: string): Promise<void> {
    if ((await fs.lstat(channelRoot)).isSymbolicLink())
      throw new Error("Channel directory is a symbolic link");
  }

  private async reportUnregisteredNamespaces(directoryName: string): Promise<void> {
    const entries = await fs.readdir(join(this.channelsPath, directoryName), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (entry.isDirectory() && !this.namespaces.has(entry.name)) {
        this.warn("storage.namespace_unregistered", { directoryName, namespace: entry.name });
      }
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private toManifest(record: ChannelRecord): ChannelManifest {
    return {
      formatVersion: CHANNEL_FORMAT_VERSION,
      identityVersion: CHANNEL_IDENTITY_VERSION,
      directoryVersion: CHANNEL_DIRECTORY_VERSION,
      ...record,
    };
  }

  private toRecord(manifest: ChannelManifest): ChannelRecord {
    const {
      formatVersion: _formatVersion,
      identityVersion: _identityVersion,
      directoryVersion: _directoryVersion,
      ...record
    } = manifest;
    return record;
  }

  private sameIdentity(left: ChannelRecord, right: ChannelRecord): boolean {
    return (
      left.identity === right.identity &&
      left.directoryName === right.directoryName &&
      left.isDirect === right.isDirect &&
      left.platform === right.platform &&
      left.selfId === right.selfId &&
      left.channelId === right.channelId
    );
  }

  private assertSegment(segment: string): void {
    const windowsStem = segment.split(".", 1)[0];
    if (
      !segment ||
      segment === "." ||
      segment === ".." ||
      isAbsolute(segment) ||
      segment.includes("/") ||
      segment.includes("\\") ||
      segment.includes("\0") ||
      WINDOWS_RESERVED.test(windowsStem) ||
      /[<>:"|?*]/.test(segment)
    ) {
      throw new TypeError(`Invalid storage path segment: ${JSON.stringify(segment)}`);
    }
  }

  private assertContained(root: string, path: string): void {
    const rel = relative(root, path);
    if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) return;
    throw new Error("Resolved storage path escapes its namespace root");
  }
}
