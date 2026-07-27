import { createHash } from "node:crypto";

export interface ChannelScope {
  readonly platform: string;
  readonly selfId: string;
  readonly channelId: string;
  readonly isDirect: boolean;
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
