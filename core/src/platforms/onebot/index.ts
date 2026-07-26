import type { Context } from "koishi";
import type {} from "koishi-plugin-adapter-onebot";

import type { MessageRecord } from "../../event/index.js";
import type { ResolveContext, SessionResolver } from "../../gateway/index.js";
import { resolveOneBotEvent } from "./events.js";
import { freezeOneBotImages } from "./image.js";

export function createResolver(ctx: Context): SessionResolver {
  return {
    platform: "onebot",
    async resolve({ session, base, freezeImage }) {
      const event = resolveOneBotEvent(session);
      if (event) return event;
      if (!base) return null;
      return resolveOneBotMessage({ ctx, base, freezeImage });
    },
  };
}

async function resolveOneBotMessage({
  ctx,
  base,
  freezeImage,
}: {
  readonly ctx: Context;
  readonly base: Omit<MessageRecord, "text">;
  readonly freezeImage: ResolveContext["freezeImage"];
}): Promise<MessageRecord> {
  const workingElements = [...base.elements];
  const frozenElements = await freezeOneBotImages(ctx, workingElements, freezeImage);
  const text = frozenElements.map((element) => element.toString()).join("");
  return {
    ...base,
    text,
  };
}

export { resolveOneBotEvent } from "./events.js";
export { freezeOneBotImages } from "./image.js";
