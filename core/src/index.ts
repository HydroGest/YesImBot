import type YesImBotService from "./service.js";

declare module "koishi" {
  interface Context {
    yesimbot: YesImBotService;
  }
}

export { default } from "./service.js";

export type { ChannelPlugin, WillDebug, WillEngine, WillPlugin, WillState } from "./agents/index.js";

export type { ChannelContext, ChannelKey } from "./channels/index.js";

export type { ConversationReadOptions } from "./conversations/index.js";

export * from "./messages/index.js";

export type { Translator } from "./messengers/index.js";

export type * from "./models/index.js";

export type * from "./resources/index.js";

export * from "@yesimbot/agent-runtime";
