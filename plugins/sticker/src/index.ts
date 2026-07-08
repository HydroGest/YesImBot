import { AgentPlugin, AgentTool, jsonSchema } from "@yesimbot/agent-runtime";
import { Context, Logger, Schema } from "koishi";
import type {} from "koishi-plugin-yesimbot";

export interface StickerConfig {}

export default class StickerPlugin {
  static name = "yesimbot-sticker";
  static usage = "贴纸插件，提供贴纸元素和保存贴纸功能";
  static inject = ["yesimbot"];
  static Config: Schema<StickerConfig> = Schema.object({});

  public readonly ctx: Context;
  public readonly config: StickerConfig;
  public readonly logger: Logger;

  private disposeAgentPlugin?: () => void;

  constructor(ctx: Context, config: StickerConfig) {
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("yesimbot.sticker");
    ctx.on("ready", this.start.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  async start(): Promise<void> {
    const logger = this.logger;
    this.disposeAgentPlugin = this.ctx.yesimbot.registerAgentPlugin((_context) => {
      return {
        name: "sticker",
        tools: [
          {
            name: "save_sticker",
            description: "Save a sticker",
            inputSchema: jsonSchema({
              type: "object",
              properties: {
                id: { type: "string", description: "The ID of the sticker to save" },
              },
              required: ["id"],
            }),
            execute: async (input) => {
              const { id } = input;
              logger.info(`Saving sticker with ID: ${id}`);
              // Implement sticker saving logic here
              return { success: true };
            },
          } satisfies AgentTool<{ id: string }, { success: boolean }>,
        ],
      } satisfies AgentPlugin;
    });
  }

  async stop(): Promise<void> {
    this.disposeAgentPlugin?.();
  }
}
