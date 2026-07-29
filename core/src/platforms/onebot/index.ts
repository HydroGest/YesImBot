import type { Context } from "koishi";
import type {} from "koishi-plugin-adapter-onebot";

import type { ResolvedMessageDraft } from "../../input.js";
import type { ResolveContext, SessionResolver } from "../../gateway/index.js";
import { resolveOneBotEvent } from "./events.js";
import { freezeOneBotImages } from "./image.js";

export function createResolver(ctx: Context): SessionResolver {
  return {
    platform: "onebot",
    async resolve({ session, freezeImage }) {
      const event = resolveOneBotEvent(session);
      if (event) return event;
      return resolveOneBotMessage({ ctx, session, freezeImage });
    },
  };
}

async function resolveOneBotMessage({
  ctx,
  session,
  freezeImage,
}: {
  readonly ctx: Context;
  readonly session: import("koishi").Session;
  readonly freezeImage: ResolveContext["freezeImage"];
}): Promise<ResolvedMessageDraft | null> {
  if (session.type !== "message-created" || !Array.isArray(session.elements)) return null;
  if (typeof session.messageId !== "string" || session.messageId.length === 0) return null;
  const workingElements = [...session.elements];
  const frozenElements = await freezeOneBotImages(ctx, workingElements, freezeImage);
  return {
    kind: "message",
    messageId: session.messageId,
    elements: frozenElements,
    user: {
      id: session.userId || undefined,
      name: session.event.user?.name ?? session.author?.name,
    },
    channel: { name: session.event.channel?.name },
  };
}

export { resolveOneBotEvent } from "./events.js";
export { freezeOneBotImages } from "./image.js";
