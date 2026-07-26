import { z } from "zod";

import { channelIdentity, type ChannelScope } from "../channel/index.js";

export const CHANNEL_FORMAT_VERSION = 1 as const;
export const CHANNEL_IDENTITY_VERSION = 1 as const;
export const CHANNEL_DIRECTORY_VERSION = 1 as const;
export const MAX_DIRECTORY_NAME_LENGTH = 200;

export interface ChannelRecord {
  readonly identity: string;
  readonly directoryName: string;
  readonly isDirect: boolean;
  readonly platform: string;
  readonly selfId: string | null;
  readonly channelId: string;
  readonly name?: string;
}

export interface ChannelManifest extends ChannelRecord {
  readonly formatVersion: 1;
  readonly identityVersion: 1;
  readonly directoryVersion: 1;
}

const manifestSchema = z
  .object({
    formatVersion: z.literal(CHANNEL_FORMAT_VERSION),
    identityVersion: z.literal(CHANNEL_IDENTITY_VERSION),
    directoryVersion: z.literal(CHANNEL_DIRECTORY_VERSION),
    identity: z.string().min(1),
    directoryName: z.string().min(1),
    isDirect: z.boolean(),
    platform: z.string().min(1),
    selfId: z.string().min(1).nullable(),
    channelId: z.string().min(1),
    name: z.string().min(1).optional(),
  })
  .strict();

function encodeDirectoryComponent(value: string): string {
  let encoded = "";
  for (const codePoint of value) encoded += /[A-Za-z0-9_]/.test(codePoint) ? codePoint : "_";
  return encoded;
}

export function channelDirectoryName(scope: ChannelScope): string {
  void channelIdentity(scope);
  const directoryName = scope.isDirect
    ? `v1-direct-${encodeDirectoryComponent(scope.platform)}-${encodeDirectoryComponent(scope.channelId)}-${encodeDirectoryComponent(scope.selfId)}`
    : `v1-shared-${encodeDirectoryComponent(scope.platform)}-${encodeDirectoryComponent(scope.channelId)}`;
  if (directoryName.length > MAX_DIRECTORY_NAME_LENGTH) {
    throw new RangeError(`Channel directory name exceeds ${MAX_DIRECTORY_NAME_LENGTH} characters`);
  }
  return directoryName;
}

export function channelRecord(scope: ChannelScope, name?: string): ChannelRecord {
  const record: ChannelRecord = {
    identity: channelIdentity(scope),
    directoryName: channelDirectoryName(scope),
    isDirect: scope.isDirect,
    platform: scope.platform,
    selfId: scope.isDirect ? scope.selfId : null,
    channelId: scope.channelId,
  };
  return name === undefined ? record : { ...record, name };
}

export function parseChannelManifest(value: unknown): ChannelManifest {
  const manifest = manifestSchema.parse(value);
  if (manifest.isDirect && manifest.selfId === null)
    throw new TypeError("Invalid direct channel self id");
  if (!manifest.isDirect && manifest.selfId !== null)
    throw new TypeError("Invalid shared channel self id");

  const scope: ChannelScope = {
    platform: manifest.platform,
    selfId: manifest.selfId ?? "shared",
    channelId: manifest.channelId,
    isDirect: manifest.isDirect,
  };
  const record = channelRecord(scope, manifest.name);
  if (manifest.identity !== record.identity)
    throw new Error("Manifest identity does not match scope");
  if (manifest.directoryName !== record.directoryName) {
    throw new Error("Manifest directory name does not match scope");
  }
  return {
    formatVersion: CHANNEL_FORMAT_VERSION,
    identityVersion: CHANNEL_IDENTITY_VERSION,
    directoryVersion: CHANNEL_DIRECTORY_VERSION,
    ...record,
  };
}
