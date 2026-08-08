import YesImBotService from "./service.js";

declare module "koishi" {
  interface Context {
    yesimbot: YesImBotService;
  }
}

export default YesImBotService;

export { ChannelPlugin, type Will, WillPlugin } from "./agents/index.js";
export type { ChannelScope } from "./channels/index.js";
export * from "./messages/index.js";
export type { Translator } from "./messengers/index.js";
export * from "./models/index.js";
export type {
  ArtifactStore,
  ArtifactWriter,
  AssetStore,
  ChannelResources,
  ResourceOpenOptions,
  ResourceOpenResult,
  ResourceReader,
  Resources,
} from "./resources/index.js";
