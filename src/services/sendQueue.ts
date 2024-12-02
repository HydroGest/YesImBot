import path from "path";

import { Config } from "../config";
import { QueueItem, QueueManager, QuietTimerManager, TriggerManager } from "../managers/queueManager";
import { parseTimestamp } from "../utils/timeUtils";
import { getMemberName } from "../utils/prompt";

export class SendQueue {
  private queueManager: QueueManager;
  private triggerManager: TriggerManager;
  private quietTimerManager: QuietTimerManager;

  constructor(private config: Config) {
    const filePath = path.join(__dirname, "../../data/queue.json");
    this.queueManager = new QueueManager(filePath);
    this.triggerManager = new TriggerManager(config);
    this.quietTimerManager = new QuietTimerManager();
  }

  public updateSendQueue(
    group: string,
    sender: string,
    sender_id: string,
    content: string,
    id: string,
    FilterList: string[],
    TriggerCount: number,
    selfId: string
  ): void {
    this.queueManager.enqueue(
      group,
      sender,
      sender_id,
      content,
      id,
      FilterList
    );

    const currentCount = this.triggerManager.getTriggerCount(group);
    this.triggerManager.setTriggerCount(
      group,
      selfId === sender_id ? currentCount : currentCount - 1
    );
  }

  public startQuietCheck(groupId: string, callback: () => void): void {
    this.quietTimerManager.startTimer(groupId, this.triggerManager.maxTriggerTime, callback);
  }

  public clearQuietTimeout(groupId: string): void {
    this.quietTimerManager.clearTimer(groupId);
  }

  public getLastTriggerTime(group: string): number {
    return this.triggerManager.getLastTriggerTime(group);
  }

  public updateLastTriggerTime(group: string): void {
    this.triggerManager.updateLastTriggerTime(group);
    this.quietTimerManager.clearTimer(group);
  }

  public checkQueueSize(group: string, size: number): boolean {
    const queue = this.queueManager.getQueue(group);
    console.log(`此会话的记忆容量: ${queue.length} / ${size}`);
    return queue.length >= size;
  }


  public getShouldIncludeQueue(groups: Set<string>, groupId?: string): { included: Set<string>, excluded: Set<string> } {
    const hasPrivateAll = groups.has('private:all');
    const hasAll = groups.has('all');

    const shouldIncludeQueue = (key: string): boolean => {
      if (hasPrivateAll && hasAll) return true;
      if (hasPrivateAll) return key.startsWith('private:') || groups.has(key);
      if (hasAll) return !key.startsWith('private:') || groups.has(key);
      return groups.has(key);
    };

    const keysToCheck = groupId
      ? [...this.queueManager.getGroupKeys(), groupId]
      : [...this.queueManager.getGroupKeys()];

    const included = new Set<string>();
    const excluded = new Set<string>();

    keysToCheck.forEach(key => {
      if (shouldIncludeQueue(key)) {
        included.add(key);
      } else {
        if (groups.has(key)) {
          excluded.add(key);
        }
      }
    });

    return { included, excluded };
  }

  public checkMixedQueueSize(groups: Set<string>, size: number): boolean {
    const { included } = this.getShouldIncludeQueue(groups);
    const totalLength = Array.from(included)
      .reduce((sum, key) => sum + (this.queueManager.getQueue(key).length || 0), 0);
    console.log(`记忆槽位的容量: ${totalLength} / ${size}`);
    return totalLength >= size;
  }

  public checkTriggerCount(group: string): boolean {
    return this.triggerManager.checkTrigger(group);
  }

  public resetTriggerCount(group: string, nextTriggerCount: number): void {
    this.triggerManager.resetTriggerCount(group, nextTriggerCount);
  }

  public resetSendQueue(group: string, maxQueueSize: number): void {
    this.queueManager.resetQueue(group, maxQueueSize);
  }

  public clearSendQueue(group: string): boolean {
    return this.queueManager.clearQueue(group);
  }

  public clearSendQueueByQQ(sender_id: string): boolean {
    return this.queueManager.clearBySenderId(sender_id);
  }

  public findGroupByMessageId(messageId: string, groups: Set<string>): string | null {
    return this.queueManager.findGroupByMessageId(messageId, groups);
  }

  public async getPrompt(groups: Set<string>, config: Config, session: any): Promise<string> {
    
    // 收集所有指定群组的消息
    const queues = this.queueManager.getQueuesByGroups(groups);
    let messages: QueueItem[] = [];
    for (const queue of queues) {
      messages = messages.concat(queue);
    }

    // 按照时间戳排序
    messages.sort((a, b) => {
      return parseTimestamp(a.timestamp).getTime() - parseTimestamp(b.timestamp).getTime();
    });

    // 如果超过长度限制，丢弃旧的消息
    const maxSize = config.MemorySlot.SlotSize;
    if (messages.length > maxSize) {
      messages = messages.slice(-maxSize);
    }

    if (messages.length === 0) {
      return "[]";
    }

    // 转换为 promptArr
    const promptArr = await Promise.all(messages.map(async (item) => {
      return {
        time: item.timestamp,
        session_id: item.guildId,
        id: item.id,
        author: await getMemberName(config, session, item.sender_id),
        author_id: item.sender_id,
        msg: item.content,
      };
    }));

    // 转换为字符串
    let promptStr = JSON.stringify(promptArr);

    // 处理 <img base64="xxx" /> 标签
    const imgTagRegex = /<img base64=\\"[^\\"]*\\"\s*\/?>/g;
    const matches = promptStr.match(imgTagRegex);
    if (matches && config.ImageViewer.Memory !== -1) {
      const imgCount = matches.length;
      const imgToKeep = config.ImageViewer.Memory;
      const imgToReplace = imgCount - imgToKeep;

      if (imgToReplace > 0) {
        let replacedCount = 0;
        promptStr = promptStr.replace(imgTagRegex, (match) => {
          if (replacedCount < imgToReplace) {
            replacedCount++;
            return "[图片]";
          }
          return match;
        });
      }
    }
    return promptStr;
  }
}