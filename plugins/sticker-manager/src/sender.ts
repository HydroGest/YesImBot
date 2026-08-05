import { h, type Bot } from "koishi";
import type { ChannelScope } from "koishi-plugin-yesimbot";

export interface StickerSendInput {
  bytes: Uint8Array;
  mediaType: string;
}

export interface StickerSender {
  send(input: StickerSendInput): Promise<void>;
}

export class BotStickerSender implements StickerSender {
  public constructor(
    private readonly bot: Bot,
    private readonly scope: ChannelScope,
  ) {}

  public async send(input: StickerSendInput): Promise<void> {
    const dataUrl = `data:${input.mediaType};base64,${Buffer.from(input.bytes).toString("base64")}`;
    await this.bot.sendMessage(this.scope.channelId, [h.image(dataUrl)]);
  }
}
