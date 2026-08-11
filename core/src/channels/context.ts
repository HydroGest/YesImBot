import type { Session } from "koishi";

import type { EventRecord, MessageRecord } from "../messages/index.js";

// ── Constants ──────────────────────────────────────────────────────────────

const DIRECT_CHANNEL_TYPE = 1 as const;

declare const _channelKeyBrand: unique symbol;

// ── Types ──────────────────────────────────────────────────────────────────

export type ChannelKey = string & { readonly [_channelKeyBrand]: "ChannelKey" };

export type ChannelContext =
  | (ChannelContextBase & { type: "channel"; guildId: string; selfId?: string; channelName?: string; guildName?: string })
  | (ChannelContextBase & { type: "guild"; guildId: string; selfId?: string; guildName?: string })
  | (ChannelContextBase & { type: "direct"; selfId: string; userId: string; userName?: string });

interface ChannelContextBase {
  type: "channel" | "guild" | "direct";
  platform: string;
  channelId: string;
}

/** Partial shape of a record that may carry guild info (EventRecord / MessageRecord). */
interface RecordWithGuild {
  guild?: { id?: string; name?: string };
  user?: { id?: string; name?: string };
}

// ── Key derivation ──────────────────────────────────────────────────────────

export function deriveChannelKey(ctx: ChannelContext): ChannelKey {
  switch (ctx.type) {
    case "channel":
      if (!ctx.platform || !ctx.guildId || !ctx.channelId) {
        throw new Error(
          `deriveChannelKey: missing required fields for type "channel" (platform=${ctx.platform}, guildId=${ctx.guildId}, channelId=${ctx.channelId})`,
        );
      }
      return `channel:${ctx.platform}:${ctx.guildId}:${ctx.channelId}` as ChannelKey;

    case "guild":
      if (!ctx.platform || !ctx.guildId) {
        throw new Error(`deriveChannelKey: missing required fields for type "guild" (platform=${ctx.platform}, guildId=${ctx.guildId})`);
      }
      return `guild:${ctx.platform}:${ctx.guildId}` as ChannelKey;

    case "direct":
      if (!ctx.platform || !ctx.userId || !ctx.selfId) {
        throw new Error(`deriveChannelKey: missing required fields for type "direct" (platform=${ctx.platform}, userId=${ctx.userId}, selfId=${ctx.selfId})`);
      }
      return `direct:${ctx.platform}:${ctx.userId}:${ctx.selfId}` as ChannelKey;

    default: {
      const _exhaustive: never = ctx;
      throw new Error(`deriveChannelKey: unknown type "${(_exhaustive as ChannelContext).type}"`);
    }
  }
}

export function contextFromSession(session: Session): ChannelContext | undefined {
  const platform = session.platform;
  const channelId = session.channelId;

  if (!platform || !channelId) return undefined;

  if (session.isDirect) {
    const selfId = session.selfId;
    const userId = session.userId;
    if (!selfId || !userId) return undefined;
    return { type: "direct", platform, channelId, selfId, userId, userName: session.username };
  }

  const guildId = session.guildId;
  if (!guildId) return undefined;

  if (guildId !== channelId) {
    return { type: "channel", platform, channelId, guildId, selfId: session.selfId };
  }

  return { type: "guild", platform, channelId, guildId, selfId: session.selfId };
}

export function contextFromRecord(record: MessageRecord | EventRecord): ChannelContext | undefined {
  const platform = record.platform;
  const channelId = record.channel?.id;

  if (!platform || !channelId) return undefined;

  const isDirect = record.channel?.type === DIRECT_CHANNEL_TYPE;
  const extra = record as MessageRecord & RecordWithGuild;

  if (isDirect) {
    const selfId = record.selfId;
    const userId = extra.user?.id ?? record.channel?.id;
    if (!selfId || !userId) return undefined;
    return { type: "direct", platform, channelId, selfId, userId, userName: extra.user?.name };
  }

  const guildId: string | undefined = extra.guild?.id;

  if (guildId && guildId !== channelId) {
    return { type: "channel", platform, channelId, guildId, channelName: record.channel?.name, guildName: extra.guild?.name };
  }

  return { type: "guild", platform, channelId, guildId: guildId ?? channelId, guildName: extra.guild?.name };
}
