import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { channelIdentity, type ChannelScope } from "../channel/index.js";

const FORMAT_VERSION = 1;
const KEY_VERSION = 1;
const KEY_PATTERN = /^[a-z2-7]{25}[aeimquy4]$/;
const NAMESPACE_PATTERN = /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export interface ChannelRecord {
  readonly key: string;
  readonly isDirect: boolean;
  readonly platform: string;
  readonly selfId: string | null;
  readonly channelId: string;
  readonly name?: string;
}

export type ChannelFilter = Partial<ChannelRecord>;

interface ChannelManifest extends ChannelRecord {
  readonly formatVersion: 1;
  readonly keyVersion: 1;
}

function recordFor(scope: ChannelScope, name?: string): ChannelRecord {
  const record: ChannelRecord = {
    key: channelIdentity(scope),
    isDirect: scope.isDirect,
    platform: scope.platform,
    selfId: scope.isDirect ? scope.selfId : null,
    channelId: scope.channelId,
  };
  return name === undefined ? record : { ...record, name };
}

function parseManifest(value: unknown): ChannelManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Manifest must be an object");
  }
  const manifest = value as Record<string, unknown>;
  if (manifest.formatVersion !== FORMAT_VERSION || manifest.keyVersion !== KEY_VERSION) {
    throw new TypeError("Unsupported channel manifest version");
  }
  if (!KEY_PATTERN.test(String(manifest.key))) throw new TypeError("Invalid channel Key");
  if (typeof manifest.isDirect !== "boolean") throw new TypeError("Invalid direct flag");
  if (typeof manifest.platform !== "string" || manifest.platform.length === 0) {
    throw new TypeError("Invalid platform");
  }
  if (typeof manifest.channelId !== "string" || manifest.channelId.length === 0) {
    throw new TypeError("Invalid channel id");
  }
  if (
    manifest.isDirect
      ? typeof manifest.selfId !== "string" || !manifest.selfId
      : manifest.selfId !== null
  ) {
    throw new TypeError("Invalid self id");
  }
  if (manifest.name !== undefined && (typeof manifest.name !== "string" || !manifest.name)) {
    throw new TypeError("Invalid channel name");
  }

  const scope: ChannelScope = {
    platform: manifest.platform,
    selfId: manifest.isDirect ? (manifest.selfId as string) : "shared",
    channelId: manifest.channelId,
    isDirect: manifest.isDirect,
  };
  if (channelIdentity(scope) !== manifest.key) throw new Error("Manifest identity does not match Key");

  const record = recordFor(scope, manifest.name as string | undefined);
  return { formatVersion: FORMAT_VERSION, keyVersion: KEY_VERSION, ...record };
}

function matchesFilter(record: ChannelRecord, filter: ChannelFilter): boolean {
  return (Object.keys(filter) as Array<keyof ChannelFilter>).every(
    (key) => filter[key] === undefined || record[key] === filter[key],
  );
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export class ChannelStorage {
  private readonly channelsPath: string;
  private readonly catalogPath: string;
  private readonly records = new Map<string, ChannelRecord>();
  private readonly namespaces = new Map<string, object>();
  private tail: Promise<void> = Promise.resolve();
  private startTask: Promise<void> | undefined;

  constructor(
    basePath: string,
    private readonly warn: (code: string, fields: Record<string, unknown>) => void = () => {},
  ) {
    this.channelsPath = resolve(basePath, "channels");
    this.catalogPath = resolve(basePath, "channels.json");
    this.namespaces.set("sessions", {});
    this.namespaces.set("assets", {});
  }

  start(): Promise<void> {
    if (!this.startTask) this.startTask = this.startInternal();
    return this.startTask;
  }

  register(namespace: string): () => void {
    if (!NAMESPACE_PATTERN.test(namespace) || WINDOWS_RESERVED.test(namespace)) {
      throw new TypeError(`Invalid storage namespace: ${JSON.stringify(namespace)}`);
    }
    if (this.namespaces.has(namespace)) {
      throw new Error(`Storage namespace already registered: ${namespace}`);
    }
    const owner = {};
    this.namespaces.set(namespace, owner);
    return () => {
      if (this.namespaces.get(namespace) === owner) this.namespaces.delete(namespace);
    };
  }

  async ensure(scope: ChannelScope, namespace: string, ...segments: string[]): Promise<string> {
    await this.start();
    for (const segment of segments) this.assertSegment(segment);
    if (!this.namespaces.has(namespace)) {
      throw new Error(`Storage namespace is not registered: ${namespace}`);
    }
    const record = await this.enqueue(() => this.ensureChannel(scope));
    const channelRoot = resolve(this.channelsPath, record.key);
    const root = resolve(channelRoot, namespace);
    this.assertContained(channelRoot, root);
    // Reject symlink escapes before creating the namespace directory.
    // Check channel root immediately — ensureChannel may have created or
    // verified it, but an external swap is possible at any point.
    const channelStat = await lstat(channelRoot);
    if (channelStat.isSymbolicLink()) throw new Error("Channel directory is a symbolic link");
    // Check existing namespace root — a missing root is valid (first call).
    let rootExists = false;
    try {
      const nsStat = await lstat(root);
      if (nsStat.isSymbolicLink()) throw new Error("Namespace root is a symbolic link");
      rootExists = true;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException)?.code !== "ENOENT") throw cause;
    }
    if (!rootExists) await mkdir(root, { recursive: true });
    // Post-creation re-check narrows the TOCTOU window.
    // Note: a hostile post-check symlink swap cannot be fully prevented.
    const channelStat2 = await lstat(channelRoot);
    if (channelStat2.isSymbolicLink()) throw new Error("Channel directory is a symbolic link");
    const nsStat2 = await lstat(root);
    if (nsStat2.isSymbolicLink()) throw new Error("Namespace root is a symbolic link");
    const realRoot = await realpath(root);
    this.assertContained(channelRoot, realRoot);
    // Reject symlinks in existing segment path components.
    // Components that do not exist yet will be created by the caller and are not checked.
    const path = resolve(root, ...segments);
    let check = root;
    for (const segment of segments) {
      check = resolve(check, segment);
      try {
        const st = await lstat(check);
        if (st.isSymbolicLink()) throw new Error("Storage path segment is a symbolic link");
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException)?.code !== "ENOENT") throw cause;
        break;
      }
    }
    this.assertContained(root, path);
    return path;
  }

  list(filter: ChannelFilter = {}): readonly ChannelRecord[] {
    return [...this.records.values()]
      .filter((record) => matchesFilter(record, filter))
      .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
      .map((record) => Object.freeze({ ...record }));
  }

  async updateName(scope: ChannelScope, name: string | undefined): Promise<void> {
    if (!name) return;
    await this.start();
    await this.enqueue(async () => {
      const record = await this.ensureChannel(scope);
      if (record.name === name) return;
      const manifest: ChannelManifest = {
        formatVersion: FORMAT_VERSION,
        keyVersion: KEY_VERSION,
        ...recordFor(scope, name),
      };
      await writeJsonAtomic(join(this.channelsPath, record.key, "channel.json"), manifest);
      this.records.set(record.key, recordFor(scope, name));
      await this.writeCatalogOrReport();
    });
  }

  private async startInternal(): Promise<void> {
    await mkdir(this.channelsPath, { recursive: true });
    const entries = await readdir(this.channelsPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !KEY_PATTERN.test(entry.name)) {
        this.warn("storage.directory_invalid", { entry: entry.name });
        continue;
      }
      try {
        const manifest = parseManifest(
          JSON.parse(await readFile(join(this.channelsPath, entry.name, "channel.json"), "utf8")),
        );
        if (manifest.key !== entry.name) throw new Error("Manifest Key does not match directory");
        this.records.set(manifest.key, this.toRecord(manifest));
        const namespaceEntries = await readdir(join(this.channelsPath, entry.name), {
          withFileTypes: true,
        });
        for (const namespace of namespaceEntries) {
          if (
            namespace.isDirectory() &&
            namespace.name !== "channel.json" &&
            !this.namespaces.has(namespace.name)
          ) {
            this.warn("storage.namespace_unregistered", {
              key: entry.name,
              namespace: namespace.name,
            });
          }
        }
      } catch (cause) {
        this.warn("storage.manifest_invalid", { key: entry.name, cause });
      }
    }
    await this.writeCatalogOrReport();
  }

  private async ensureChannel(scope: ChannelScope): Promise<ChannelRecord> {
    const expected = recordFor(scope);
    const known = this.records.get(expected.key);
    if (known) {
      if (!this.sameIdentity(known, expected)) throw new Error("Channel storage identity mismatch");
      return known;
    }

    const destination = join(this.channelsPath, expected.key);
    try {
      const existing = await stat(destination);
      if (!existing.isDirectory())
        throw new Error("Channel storage destination is not a directory");
      const linkStat = await lstat(destination);
      if (linkStat.isSymbolicLink()) throw new Error("Channel directory is a symbolic link");
      const manifest = parseManifest(
        JSON.parse(await readFile(join(destination, "channel.json"), "utf8")),
      );
      if (!this.sameIdentity(manifest, expected))
        throw new Error("Channel storage integrity mismatch");
      const record = this.toRecord(manifest);
      this.records.set(record.key, record);
      await this.writeCatalogOrReport();
      return record;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }

    const manifest: ChannelManifest = {
      formatVersion: FORMAT_VERSION,
      keyVersion: KEY_VERSION,
      ...expected,
    };
    await this.createChannel(manifest);
    this.records.set(expected.key, expected);
    await this.writeCatalogOrReport();
    return expected;
  }

  private async createChannel(manifest: ChannelManifest): Promise<void> {
    const destination = join(this.channelsPath, manifest.key);
    const temporary = join(this.channelsPath, `.${manifest.key}.${randomUUID()}.tmp`);
    try {
      await mkdir(temporary);
      await writeJsonAtomic(join(temporary, "channel.json"), manifest);
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  private async writeCatalogOrReport(): Promise<void> {
    try {
      await this.writeCatalog();
    } catch (cause) {
      this.warn("catalog.write_failed", { cause });
    }
  }

  private async writeCatalog(): Promise<void> {
    await writeJsonAtomic(this.catalogPath, {
      formatVersion: FORMAT_VERSION,
      channels: this.list().map((record) => ({
        formatVersion: FORMAT_VERSION,
        keyVersion: KEY_VERSION,
        ...record,
      })),
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private toRecord(manifest: ChannelManifest): ChannelRecord {
    const { formatVersion: _formatVersion, keyVersion: _keyVersion, ...record } = manifest;
    return record;
  }

  private sameIdentity(left: ChannelRecord, right: ChannelRecord): boolean {
    return (
      left.key === right.key &&
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
    )
      throw new TypeError(`Invalid storage path segment: ${JSON.stringify(segment)}`);
  }

  private assertContained(root: string, path: string): void {
    const rel = relative(root, path);
    if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) return;
    throw new Error("Resolved storage path escapes its namespace root");
  }
}
