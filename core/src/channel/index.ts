import { createHash } from "node:crypto";

import { Universal } from "koishi";

export interface ChannelScope {
  readonly platform: string;
  readonly selfId: string;
  readonly channelId: string;
  readonly isDirect: boolean;
}

interface ChannelEvent {
  readonly platform: string;
  readonly selfId: string;
  readonly channel?: { readonly id?: string; readonly type?: number };
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

function assertScope(scope: ChannelScope): void {
  for (const field of ["platform", "selfId", "channelId"] as const) {
    if (typeof scope[field] !== "string" || scope[field].length === 0) {
      throw new TypeError(`ChannelScope.${field} must be a non-empty string`);
    }
  }
  if (typeof scope.isDirect !== "boolean") {
    throw new TypeError("ChannelScope.isDirect must be a boolean");
  }
}

function encodeBase32(bytes: Uint8Array): string {
  let buffer = 0;
  let bits = 0;
  let output = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32[(buffer >>> bits) & 31];
    }
  }
  if (bits > 0) output += BASE32[(buffer << (5 - bits)) & 31];
  return output;
}

export function channelIdentity(scope: ChannelScope): string {
  assertScope(scope);
  const canonical = scope.isDirect
    ? ["yesimbot.channel", 1, "direct", scope.platform, scope.selfId, scope.channelId]
    : ["yesimbot.channel", 1, "shared", scope.platform, null, scope.channelId];
  const digest = createHash("sha256").update(JSON.stringify(canonical), "utf8").digest();
  return encodeBase32(digest.subarray(0, 16));
}

export function sameChannel(left: ChannelScope, right: ChannelScope): boolean {
  return channelIdentity(left) === channelIdentity(right);
}

export function fromEvent(record: ChannelEvent): ChannelScope | null {
  if (!record.channel?.id) return null;
  return {
    platform: record.platform,
    selfId: record.selfId,
    channelId: record.channel.id,
    isDirect: record.channel.type === Universal.Channel.Type.DIRECT,
  };
}
