import type { Context, Element } from "koishi";
import type {} from "koishi-plugin-adapter-onebot";
import type { EventRecord, ResolveContext, SessionResolver } from "koishi-plugin-yesimbot";

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
  readonly base: Omit<EventRecord<"message">, "content">;
  readonly freezeImage: ResolveContext["freezeImage"];
}): Promise<EventRecord<"message">> {
  const elements = await freezeOneBotImages(
    ctx,
    (base.message.elements ?? []) as readonly Element[],
    freezeImage,
  );
  const content = elements.map((element) => element.toString()).join("");
  return {
    ...base,
    message: { ...base.message, content, elements },
    content,
  } as EventRecord<"message">;
}

export { resolveOneBotEvent } from "./events.js";
export { freezeOneBotImages } from "./image.js";
