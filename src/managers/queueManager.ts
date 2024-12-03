import { Context } from "koishi";
import { Config } from "../config";
import { ChatMessage } from "../models/ChatMessage";
import { getCurrentTimestamp } from "../utils/timeUtils";
import { containsFilter } from "../utils/toolkit";
import { CacheManager } from "./cacheManager";
import { DATABASE_NAME } from "..";

export class QueueManager {
  private ctx: Context;

  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  async getQueue(channelId: string, limit: number): Promise<ChatMessage[]> {
    return this.ctx.database
      .select(DATABASE_NAME)
      .where({ channelId })
      .orderBy("sendTime", "asc") // 升序
      .limit(limit)
      .execute();
  }

  async getMixedQueue(
    channels: Set<string>,
    limit: number
  ): Promise<ChatMessage[]> {
    const selectQuery = (channelIdFilter: any) => {
      return this.ctx.database
        .select(DATABASE_NAME)
        .where({ channelId: channelIdFilter })
        .orderBy("sendTime", "asc") // 升序
        .limit(limit)
        .execute();
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

  public async findChannelByMessageId(
    messageId: string
  ): Promise<string> {
    const messages = await this.ctx.database
    .select(DATABASE_NAME)
    .where({ messageId })
    .execute()
    if (messages.length==0)
      return null;
    return messages[0].channelId;
  }
}