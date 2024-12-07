import { Context } from "koishi";
import { defineAccessor } from "@satorijs/core";

import { Config } from "../config";
import { QueueManager } from "../managers/queueManager";
import { ChatMessage } from "../models/ChatMessage";

export interface SendQueue {
  getQueue(channelId: string): Promise<ChatMessage[]>;
  clearBySenderId(senderId: string): Promise<boolean>;
  clearChannel(channelId: string): Promise<boolean>;
  clearAll(): Promise<boolean>;
  clearPrivateAll(): Promise<boolean>;
  addMessage(message: ChatMessage): Promise<void>;
}
export class SendQueue {
  private slotContains: Set<string>[] = [];
  private slotSize: number;
  private queueManager: QueueManager;
  private triggerCount: Map<string, number> = new Map();
  constructor(private ctx: Context, private config: Config) {
    for (let slotContain of config.MemorySlot.SlotContains) {
      this.slotContains.push(
        new Set(slotContain.split(",").map((slot) => slot.trim()))
      );
    }
    this.slotSize = config.MemorySlot.SlotSize;
    this.queueManager = new QueueManager(ctx);
  }
  async checkQueueSize(channelId: string): Promise<boolean> {
    return (
      (await this.queueManager.getQueue(channelId, this.slotSize)).length >
      this.slotSize
    );
  }

  async checkMixedQueueSize(channelId: string): Promise<boolean> {
    for (let slotContain of this.slotContains) {
      if (slotContain.has(channelId)) {
        return (
          (await this.queueManager.getMixedQueue(slotContain, this.slotSize))
            .length > this.slotSize
        );
      }
    }
    return false;
  }

  async getMixedQueue(channelId: string): Promise<ChatMessage[]> {
    for (let slotContain of this.slotContains) {
      if (slotContain.has(channelId)) {
        return await this.queueManager.getMixedQueue(
          slotContain,
          this.slotSize
        );
      }
    }
    return [];
  }

  // 向数据库中添加一条消息
  //TODO: 删除过期消息并进行总结
  async addMessage(message: ChatMessage) {
    this.queueManager.enqueue(message);
  }

  setTriggerCount(channelId: string, nextTriggerCount: number) {
    this.triggerCount.set(channelId, nextTriggerCount);
    console.log(`距离下次回复还剩 ${nextTriggerCount} 次`)
  }
  // 如果没有触发，将触发次数-1
  // newTriggerCount 到 0 时返回 true
  checkTriggerCount(channelId: string): boolean {
    let triggerCount = this.triggerCount.get(channelId) ?? this.config.MemorySlot.FirstTriggerCount;
    const newTriggerCount = triggerCount - 1;
    if (triggerCount > 0) {
      this.setTriggerCount(channelId, newTriggerCount);
    }
    if (newTriggerCount <= 0) {
      return true;
    }
    return false;
  }
}

defineAccessor(SendQueue.prototype, "getQueue", ["queueManager", "getQueue"])
defineAccessor(SendQueue.prototype, "clearBySenderId", ["queueManager", "clearBySenderId"])
defineAccessor(SendQueue.prototype, "clearChannel", ["queueManager", "clearChannel"])
defineAccessor(SendQueue.prototype, "clearAll", ["queueManager", "clearAll"])
defineAccessor(SendQueue.prototype, "clearPrivateAll", ["queueManager", "clearPrivateAll"])
//defineAccessor(SendQueue.prototype, "addMessage", ["queueManager", "enqueue"])
