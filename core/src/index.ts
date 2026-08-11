import YesImBotService from "./service.js";

declare module "koishi" {
  interface Context {
    yesimbot: YesImBotService;
  }
}

export default YesImBotService;

export type { ChannelPlugin, WillEngine, WillPlugin } from "./agents/index.js";

export type { ChannelContext, ChannelKey } from "./channels/index.js";

export * from "./messages/index.js";

export type { Translator } from "./messengers/index.js";

export type * from "./models/index.js";

export type * from "./resources/index.js";
