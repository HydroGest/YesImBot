import type { Context, Session } from "koishi";
import { Universal } from "koishi";

import { assembleEvent, type EventRecord, type MessageRecord, type RecordBase } from "../messages/index.js";
import type { Translator } from "../messengers/index.js";
import type { ChannelResources } from "../resources/index.js";
import { persistElements } from "../resources/input.js";

type OneBotEventType = "notice.poke";

declare module "../messages/index.js" {
  interface EventMap {
    "notice.poke": {
      targetId: string;
      action: string;
    };
  }
}

export class OneBotTranslator implements Translator {
  public readonly platform = "onebot";

  public constructor(private readonly ctx: Context) {}

  public async translate(session: Session, resources: ChannelResources): Promise<MessageRecord | EventRecord | null> {
    const base = recordBase(session);
    const event = translateOneBotEvent(base, session);
    if (event) return event;
    return translateOneBotMessage(this.ctx, base, session, resources);
  }
}

export function translateOneBotEvent(base: RecordBase, session: Session): EventRecord<OneBotEventType> | null {
  const { event } = session;
  if (event.type !== "notice" || event.subtype !== "poke") return null;
  return assembleEvent(base, {
    eventType: "notice.poke",
    targetId: String(event._data.target_id),
    action: "拍了拍",
    text: `${event._data.user_id} 拍了拍 ${event._data.target_id}`,
  });
}

export async function translateOneBotMessage(
  ctx: Context,
  base: RecordBase,
  session: Session,
  resources: ChannelResources,
): Promise<MessageRecord | null> {
  if (session.type !== "message-created" || !Array.isArray(session.elements)) return null;
  if (typeof session.messageId !== "string" || session.messageId.length === 0) return null;
  return {
    ...base,
    messageId: session.messageId,
    elements: await persistElements(ctx, session.elements, resources),
  };
}

function recordBase(session: Session): RecordBase {
  return {
    platform: session.platform,
    selfId: session.selfId,
    timestamp: session.timestamp,
    channel: {
      id: session.channelId ?? "",
      type:
        session.event.channel?.type ?? (session.isDirect ? Universal.Channel.Type.DIRECT : Universal.Channel.Type.TEXT),
      ...(session.event.channel?.name === undefined ? {} : { name: session.event.channel.name }),
    },
    user: {
      id: session.userId || session.event.user?.id || session.author?.id || "",
      ...((session.event.user?.name ?? session.author?.name) === undefined
        ? {}
        : { name: session.event.user?.name ?? session.author?.name }),
    },
  };
}
