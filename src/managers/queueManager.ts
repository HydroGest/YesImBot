import fs from "fs";

import { Config } from "../config";
import { getCurrentTimestamp } from "../utils/timeUtils";
import { containsFilter } from "../utils/toolkit";

export interface QueueItem {
  id: string;
  sender: string;
  sender_id: string;
  content: string;
  timestamp: string;
  guildId: string;
}

export class QueueManager {
  private sendQueueMap: Map<string, QueueItem[]>;

  constructor(private filePath: string) {
    this.sendQueueMap = new Map();
    this.loadFromFile();
  }

  getQueue(group: string): QueueItem[] {
    return this.sendQueueMap.get(group) || [];
  }

  setQueue(group: string, queue: QueueItem[]): void {
    this.sendQueueMap.set(group, queue);
  }


  // 保存数据到文件
  public saveToFile(): void {
    try {
      const data = {
        sendQueueMap: Object.fromEntries(this.sendQueueMap),
      };
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('存档队列数据失败:', error);
    }
  }

  // 从文件加载数据
  private loadFromFile(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const fileContent = fs.readFileSync(this.filePath, 'utf-8');
        const data = JSON.parse(fileContent);

        // 将普通对象转换回 Map，并确保包含 timestamp 属性
        this.sendQueueMap = new Map(
          Object.entries(data.sendQueueMap).map(([key, value]) => [
            key,
            (value as any[]).map((item) => ({
              ...item,
              timestamp: item.timestamp || '', // 兼容旧数据
            })),
          ])
        );
        console.log('已从文件加载队列数据');
      }
    } catch (error) {
      console.error('加载队列数据失败:', error);
    }
  }

  public enqueue(
    group: string,
    sender: string,
    sender_id: string,
    content: string,
    id: string,
    FilterList: string[]
  ): void {
    const timestamp = getCurrentTimestamp();
    if (containsFilter(content, FilterList)) return;
    const queue = this.getQueue(group);
    queue.push({
      id,
      sender,
      sender_id,
      content,
      timestamp,
      guildId: group,
    });
    this.setQueue(group, queue);
    this.saveToFile();
  }

  public clearBySenderId(sender_id: string): boolean {
    let hasCleared = false;
    for (const [group, messages] of this.sendQueueMap.entries()) {
      if (!group.startsWith('private:')) {
        const originalLength = messages.length;
        const filteredMessages = messages.filter(msg => msg.sender_id !== sender_id);
        if (filteredMessages.length < originalLength) {
          this.setQueue(group, filteredMessages);
          hasCleared = true;
        }
      }
    }
    const privatePrefix = `private:${sender_id}`;
    for (const group of this.sendQueueMap.keys()) {
      if (group.startsWith(privatePrefix)) {
        this.sendQueueMap.delete(group);
        hasCleared = true;
      }
    }
    if (hasCleared) {
      this.saveToFile();
    }
    return hasCleared;
  }

  public getQueuesByGroups(groups: Set<string>): QueueItem[][] {
    const result: QueueItem[][] = [];
    for (const group of groups) {
      if (this.sendQueueMap.has(group)) {
        result.push(this.getQueue(group));
      }
    }
    return result;
  }

  public getGroupKeys(): string[] {
    return Array.from(this.sendQueueMap.keys());
  }

  public findGroupByMessageId(messageId: string, groups: Set<string>): string | null {
    if (messageId.trim() === "") {
      return null;
    }
    for (const group of groups) {
      if (this.sendQueueMap.has(group)) {
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
      this.saveToFile();
      console.log(`此会话队列已满，已出队至 ${newQueue.length} 条`);
    }
  }

  public clearQueue(group: string): boolean {
    if (this.sendQueueMap.has(group)) {
      this.sendQueueMap.delete(group);
      this.saveToFile();
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
  
    public startTimer(groupId: string, delay: number, callback: () => void): void {
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