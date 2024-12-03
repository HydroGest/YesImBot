import { Context, Session } from "koishi";
import { Config } from "../config";
import { QueueManager } from "../managers/queueManager";
import { ChatMessage, createMessage } from "../models/ChatMessage";

export class SendQueue {
  private slotContains: Set<string>[] = [];
  private slotSize: number;
  private queueManager: QueueManager;

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

  async getQueue(channelId: string, count: number): Promise<ChatMessage[]> {
    return this.queueManager.getQueue(channelId, count);
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
  async addMessage(session: Session) {
    this.queueManager.enqueue(await createMessage(session));
  }

  async clearBySenderId(senderId: string) {
    return this.queueManager.clearBySenderId(senderId);
  }

  async clearChannel(channelId: string) {
    return this.queueManager.clearChannel(channelId);
  }

  async clearAll() {
    return this.queueManager.clearAll();
  }

  async clearPrivateAll() {
    return this.queueManager.clearPrivateAll();
  }
}
