import { Context } from "koishi";

import { ChatMessage } from "../models/ChatMessage";
import { DATABASE_NAME } from "..";

export class QueueManager {
  private ctx: Context;

  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  async getQueue(channelId: string, limit: number): Promise<ChatMessage[]> {
    let chatMessages = await this.ctx.database
      .select(DATABASE_NAME)
      .where({ channelId })
      .orderBy("sendTime", "desc") // 逆序
      .limit(limit)
      .execute();
    return chatMessages.reverse();
  }

  async getMixedQueue(
    channels: Set<string>,
    limit: number
  ): Promise<ChatMessage[]> {
    const selectQuery = async (channelIdFilter: any) => {
      let chatMessages = await this.ctx.database
        .select(DATABASE_NAME)
        .where({ channelId: channelIdFilter })
        .orderBy("sendTime", "desc") // 逆序
        .limit(limit)
        .execute();
      return chatMessages.reverse();
    };

    if (channels.has("all")) {
      return selectQuery({ $regex: /^(?!.*private:[a-zA-Z0-9_]+).*$/ });
    }

    if (channels.has("private:all")) {
      return selectQuery({ $regex: /private:[a-zA-Z0-9_]+/ });
    }

    return selectQuery({ $in: Array.from(channels) });
  }

  // 消息入队
  public async enqueue(chatMessage: ChatMessage): Promise<void> {
    await this.ctx.database.create(DATABASE_NAME, chatMessage);
  }

  public async clearBySenderId(senderId: string): Promise<boolean> {
    const result = await this.ctx.database.remove(DATABASE_NAME, {
      senderId,
    });
    return result.removed > 0;
  }

  public async clearChannel(channelId: string): Promise<boolean> {
    const result = await this.ctx.database.remove(DATABASE_NAME, {
      channelId,
    });
    return result.removed > 0;
  }

  public async clearAll(): Promise<boolean> {
    const result = await this.ctx.database.remove(DATABASE_NAME, {
      "channelId": { $regex: /^(?!.*private:[a-zA-Z0-9_]+).*$/ },
    });
    return result.removed > 0;
  }

  public async clearPrivateAll(): Promise<boolean> {
    const result = await this.ctx.database.remove(DATABASE_NAME, {
      "channelId": { $regex: /private:[a-zA-Z0-9_]+/ },
    });
    return result.removed > 0;
  }

  public async findChannelByMessageId(messageId: string): Promise<string> {
    const messages = await this.ctx.database
      .select(DATABASE_NAME)
      .where({ messageId })
      .execute();
    if (messages.length == 0) return null;
    return messages[0].channelId;
  }
}
