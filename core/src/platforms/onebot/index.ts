import type { Context, Element } from "koishi";
import type {} from "koishi-plugin-adapter-onebot";
import type { InputRecord, MessageRecord, ResolveContext, SessionResolver } from "koishi-plugin-yesimbot";

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
  // Create a separate working tree for image freezing and text derivation
  const workingElements = [...base.elements];
  const frozenElements = await freezeOneBotImages(
    ctx,
    workingElements as readonly Element[],
    freezeImage,
  );
  // Serialize the frozen working tree into text
  const text = frozenElements.map((element) => element.toString()).join("");
  return {
    ...base,
    elements: base.elements, // Original source elements preserved
    text,
  };
}

export { resolveOneBotEvent } from "./events.js";
export { freezeOneBotImages } from "./image.js";
