import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CHANNEL_SCOPE_ID_PREFIX = "ch_v1_";
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export interface ChannelScope {
  readonly platform: string;
  readonly selfId: string;
  readonly channelId: string;
}

export type ChannelScopeId = `ch_v1_${string}`;

export interface ChannelScopeRecord {
  readonly version: 1;
  readonly id: ChannelScopeId;
  readonly scope: ChannelScope;
  readonly createdAt: string;
}

export function normalizeChannelScope(input: ChannelScope): ChannelScope {
  assertNonEmpty("platform", input.platform);
  assertNonEmpty("selfId", input.selfId);
  assertNonEmpty("channelId", input.channelId);

  return {
    platform: input.platform,
    selfId: input.selfId,
    channelId: input.channelId,
  };
}

export function createChannelScopeId(scope: ChannelScope): ChannelScopeId {
  const normalized = normalizeChannelScope(scope);
  const digest = createHash("sha256").update(serializeChannelScope(normalized)).digest();
  return `${CHANNEL_SCOPE_ID_PREFIX}${encodeBase32(digest.subarray(0, 10))}` as ChannelScopeId;
}

export function createChannelScopePath(
  basePath: string,
  id: ChannelScopeId,
  ...segments: string[]
): string {
  return join(basePath, "channels", id, ...segments);
}

export async function ensureChannelScopeRecord(
  basePath: string,
  scope: ChannelScope,
): Promise<ChannelScopeRecord> {
  const normalized = normalizeChannelScope(scope);
  const id = createChannelScopeId(normalized);
  const existing = await readChannelScopeRecord(basePath, id);
  if (existing) {
    return existing;
  }

  const record: ChannelScopeRecord = {
    version: 1,
    id,
    scope: normalized,
    createdAt: new Date().toISOString(),
  };

  await mkdir(createChannelScopePath(basePath, id), { recursive: true });
  await writeFile(
    createChannelScopePath(basePath, id, "scope.json"),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );
  return record;
}

export async function readChannelScopeRecord(
  basePath: string,
  id: ChannelScopeId,
): Promise<ChannelScopeRecord | undefined> {
  try {
    const content = await readFile(createChannelScopePath(basePath, id, "scope.json"), "utf8");
    const parsed = JSON.parse(content) as ChannelScopeRecord;
    if (parsed.version !== 1 || parsed.id !== id) {
      throw new Error(`Invalid channel scope record for ${id}`);
    }

    return {
      version: 1,
      id,
      scope: normalizeChannelScope(parsed.scope),
      createdAt: parsed.createdAt,
    };
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

export async function resolveChannelScope(
  basePath: string,
  id: ChannelScopeId,
): Promise<ChannelScope | undefined> {
  return (await readChannelScopeRecord(basePath, id))?.scope;
}

function assertNonEmpty(field: keyof ChannelScope, value: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Channel scope ${field} must not be empty`);
  }
}

function serializeChannelScope(scope: ChannelScope): string {
  return JSON.stringify([scope.platform, scope.selfId, scope.channelId]);
}

function encodeBase32(bytes: Uint8Array): string {
  let output = "";
  let buffer = 0;
  let bits = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  return output;
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
