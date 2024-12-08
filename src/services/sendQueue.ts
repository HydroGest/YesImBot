import { Context } from "koishi";
import { defineAccessor } from "@satorijs/core";
import { Mutex } from "async-mutex";
import { Config } from "../config";
import { QueueManager } from "../managers/queueManager";
import { ChatMessage } from "../models/ChatMessage";
import { foldText } from "../utils/string";
import { isChannelAllowed, ProcessingLock } from "../utils/toolkit";

export enum MarkType {
  Command = "指令消息",
  LogicRedirect = "逻辑重定向",
  LLM = "和LLM交互的消息",
  Added = "已被添加",
  Unknown = "未标记"
}

export interface SendQueue {
  getQueue(channelId: string): Promise<ChatMessage[]>;
  clearBySenderId(senderId: string): Promise<boolean>;
  clearChannel(channelId: string): Promise<boolean>;
  clearAll(): Promise<boolean>;
  clearPrivateAll(): Promise<boolean>;
}
export class SendQueue {
  private slotContains: Set<string>[] = [];
  private slotSize: number;
  private queueManager: QueueManager;
  private triggerCount: Map<string, number> = new Map();
  private mark = new Map<string, MarkType>();
  readonly processingLock = new ProcessingLock();
  private channelMutexes: Map<string, Mutex> = new Map();

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
      if (slotContain.has(channelId) || channelId.startsWith("private:") && slotContain.has("private:all") || !channelId.startsWith("private:") && slotContain.has("all")) {
        return await this.queueManager.getMixedQueue(
          slotContain,
          this.slotSize
        );
      }
    }
    return [];
  }

  // 向数据库中添加一条消息
  // TODO: 删除过期消息并进行总结
  // TODO: 防提示词注入
  async addMessage(message: ChatMessage) {
    if (!isChannelAllowed(this.config.MemorySlot.SlotContains, message.channelId)) return;
    this.processingLock.start(message.messageId);
    const markType = this.getMark(message.messageId) || MarkType.Unknown;
    //@ts-ignore
    if (markType === MarkType.Unknown || this.config.Settings.SelfReport.includes(markType)) {
      // 调用 Bot 指令的消息不知道怎么清除
      // 这是ctx.command先于addMessage执行完毕的原因，导致ctx.command未能清除新添加的消息
      this.setMark(message.messageId, MarkType.Added);
      await this.queueManager.enqueue(message);
      logger.info(`New message received, guildId = ${message.channelId}, content = ${foldText(message.content, 1000)}`);
    }
    this.processingLock.end(message.messageId);
  }

  getChannelMutex(channelId: string): Mutex {
    let mutex = this.channelMutexes.get(channelId);
    if (!mutex) {
      mutex = new Mutex();
      this.channelMutexes.set(channelId, mutex);
    }
    return mutex;
  }

  getMark(messageId: string): MarkType {
    return this.mark.get(messageId);
  }

  setMark(messageId: string, mark: MarkType) {
    this.mark.set(messageId, mark);
  }

  setTriggerCount(channelId: string, nextTriggerCount: number) {
    this.triggerCount.set(channelId, nextTriggerCount);
    logger.info(`触发次数已被设置为 ${nextTriggerCount}`)
  }

  // 如果没有触发，将触发次数-1
  // 关于 triggerCount 的含义:
  // prompt 中有写到 `那么你可能会想要把这个值设为1，表示再收到一条消息你就会立马发言一次。`
  // 所以为 1 时就应该返回 true，而这个值不应该是 0
  checkTriggerCount(channelId: string): boolean {
    let triggerCount =
      this.triggerCount.get(channelId) ??
      this.config.MemorySlot.FirstTriggerCount;
    if (triggerCount > 1) {
      this.triggerCount.set(channelId, --triggerCount);
      logger.info(`距离下次回复还剩 ${triggerCount} 次`);
      return false;
    }
    return true;
  }
}

defineAccessor(SendQueue.prototype, "getQueue", ["queueManager", "getQueue"])
defineAccessor(SendQueue.prototype, "clearBySenderId", ["queueManager", "clearBySenderId"])
defineAccessor(SendQueue.prototype, "clearChannel", ["queueManager", "clearChannel"])
defineAccessor(SendQueue.prototype, "clearAll", ["queueManager", "clearAll"])
defineAccessor(SendQueue.prototype, "clearPrivateAll", ["queueManager", "clearPrivateAll"])
//defineAccessor(SendQueue.prototype, "addMessage", ["queueManager", "enqueue"])
