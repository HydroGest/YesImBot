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

  async getQueue(channelId: string): Promise<ChatMessage[]> {
    return this.ctx.database
      .select(DATABASE_NAME, {
        channelId,
      })
      .orderBy("sendTime", "asc") // 升序
      .execute();
  }

  async getMixedQueue(channels: Set<string>): Promise<ChatMessage[]> {
    const selectQuery = (channelIdFilter: any) => {
      return this.ctx.database
        .select(DATABASE_NAME, { channelId: channelIdFilter })
        .orderBy("sendTime", "asc") // 升序
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

  public clearBySenderId(sender_id: string): boolean {
    let hasCleared = false;
    for (const [group, messages] of this.cacheManager.entries()) {
      if (!group.startsWith("private:")) {
        const originalLength = messages.length;
        const filteredMessages = messages.filter(
          (msg) => msg.sender_id !== sender_id
        );
        if (filteredMessages.length < originalLength) {
          this.setQueue(group, filteredMessages);
          hasCleared = true;
        }
      }
    }
    const privatePrefix = `private:${sender_id}`;
    for (const group of this.cacheManager.keys()) {
      if (group.startsWith(privatePrefix)) {
        this.cacheManager.remove(group);
        hasCleared = true;
      }
    }
    return hasCleared;
  }

  public getGroupKeys(): string[] {
    return Array.from(this.cacheManager.keys());
  }

  public findGroupByMessageId(
    messageId: string,
    groups: Set<string>
  ): string | null {
    if (messageId.trim() === "") {
      return null;
    }
    for (const group of groups) {
      if (this.cacheManager.has(group)) {
        const queue = this.getQueue(group);
        for (const message of queue) {
          if (message.id === messageId) {
            return group;
          }
        }
      }
    }
    return null;
  }

  public resetQueue(group: string, maxQueueSize: number): void {
    const queue = this.getQueue(group);
    if (queue && queue.length > 0) {
      const newQueue = queue.slice(-maxQueueSize);
      this.setQueue(group, newQueue);
      console.log(`此会话队列已满，已出队至 ${newQueue.length} 条`);
    }
  }

  public clearQueue(group: string): boolean {
    if (this.cacheManager.has(group)) {
      this.cacheManager.remove(group);
      console.log(`已清空此会话: ${group}`);
      return true;
    } else {
      console.log(`此会话不存在: ${group}`);
      return false;
    }
  }
}

export class TriggerManager {
  private triggerCountMap: Map<string, number>;
  private lastTriggerTimeMap: Map<string, number>;
  readonly maxTriggerTime: number;

  constructor(private config: Config) {
    this.triggerCountMap = new Map();
    this.lastTriggerTimeMap = new Map();
    this.maxTriggerTime = config.MemorySlot.MaxTriggerTime * 1000 || 2147483647;
  }

  public getTriggerCount(group: string): number {
    return this.triggerCountMap.get(group) || 0;
  }

  public setTriggerCount(group: string, count: number): void {
    this.triggerCountMap.set(group, count);
  }

  public resetTriggerCount(group: string, nextTriggerCount: number): void {
    this.setTriggerCount(group, nextTriggerCount);
  }

  public checkTrigger(group: string): boolean {
    const count = this.getTriggerCount(group);
    return count <= 0;
  }

  public getLastTriggerTime(group: string): number {
    return this.lastTriggerTimeMap.get(group) || 0;
  }

  public updateLastTriggerTime(group: string): void {
    this.lastTriggerTimeMap.set(group, Date.now());
  }
}

export class QuietTimerManager {
  private quietTimeoutMap: Map<string, NodeJS.Timeout>;

  constructor() {
    this.quietTimeoutMap = new Map();
  }

  public startTimer(
    groupId: string,
    delay: number,
    callback: () => void
  ): void {
    this.clearTimer(groupId);
    const timeout = setTimeout(callback, delay);
    this.quietTimeoutMap.set(groupId, timeout);
  }

  public clearTimer(groupId: string): void {
    const existingTimeout = this.quietTimeoutMap.get(groupId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      this.quietTimeoutMap.delete(groupId);
    }
  }
}
