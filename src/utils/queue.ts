import { getMemberName } from './prompt';
import JSON5 from "json5";
import fs from 'fs';
import path from 'path';

function containsFilter(sessionContent: string, FilterList: any): boolean {
  for (const filterString of FilterList) {
    if (sessionContent.includes(filterString)) {
      return true;
    }
  }
  return false;
}

export class SendQueue {
  private sendQueueMap: Map<
    string,
    { id: number; sender: string; sender_id: string; content: string }[]
  >;
  private triggerCountMap: Map<string, number>;
  private readonly filePath: string;

  constructor() {
    this.filePath = path.join(__dirname, '../../data/queue.json')
    this.sendQueueMap = new Map<
      string,
      { id: number; sender: string; sender_id: string; content: string }[]
    >();
    this.triggerCountMap = new Map<string, number>();
    this.loadFromFile();
  }

  // 保存数据到文件
  public saveToFile(): void {
    try {
      const data = {
        sendQueueMap: Object.fromEntries(this.sendQueueMap),
        triggerCountMap: Object.fromEntries(this.triggerCountMap)
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

        // 将普通对象转换回 Map
        this.sendQueueMap = new Map(Object.entries(data.sendQueueMap));
        this.triggerCountMap = new Map(Object.entries(data.triggerCountMap));

        console.log('已从文件加载队列数据');
      }
    } catch (error) {
      console.error('加载队列数据失败:', error);
    }
  }

  // 消息入队
  updateSendQueue(
    group: string,
    sender: string,
    sender_id: any,
    content: string,
    id: any,
    FilterList: any,
    TriggerCount: number,
    selfId: string
  ) {
    if (this.sendQueueMap.has(group)) {
      if (containsFilter(content, FilterList)) return;
      const queue = this.sendQueueMap.get(group);
      queue.push({ id: Number(id), sender: sender, sender_id: sender_id, content: content });
      this.sendQueueMap.set(group, queue);
    } else {
      this.sendQueueMap.set(group, [{ id: Number(id), sender: sender, sender_id: sender_id, content: content }]);
    }

    // 更新触发计数
    const currentCount = this.triggerCountMap.get(group) ?? TriggerCount;
    this.triggerCountMap.set(group, selfId === sender_id ? currentCount : currentCount - 1); // 自己发的消息不计数
    this.saveToFile();
  }

  // 检查队列长度
  checkQueueSize(group: string, size: number): boolean {
    if (this.sendQueueMap.has(group)) {
      const queue = this.sendQueueMap.get(group);
      console.log(`记忆容量: ${queue.length} / ${size}`);
      return queue.length >= size;
    }
    return false;
  }

  // 检查与重置触发计数
  checkTriggerCount(group: string, nextTriggerCount: number, isAtMentioned: boolean): boolean {
    if (this.triggerCountMap.has(group)) {
      const count = this.triggerCountMap.get(group);
      console.log(`距离下一次触发还有: ${count} 条消息`);
      if (count <= 0) {
        this.triggerCountMap.set(group, nextTriggerCount);
        this.saveToFile();
        return true;
      }
      if (isAtMentioned) {
        this.triggerCountMap.set(group, nextTriggerCount);
        this.saveToFile();
      }
      return false;
    }
    return false;
  }

  // 消息出队到队列长度为maxQueueSize
  resetSendQueue(group: string, maxQueueSize: number) {
    const queue = this.sendQueueMap.get(group);
    if (queue && queue.length > 0) {
      const newQueue = queue.slice(-maxQueueSize);
      this.sendQueueMap.set(group, newQueue);
      this.saveToFile();
      console.log(`队列已满，已出队至 ${newQueue.length} 条`);
    }
  }

  // 清空队列
  clearSendQueue(group: string) {
    if (this.sendQueueMap.has(group)) {
      this.sendQueueMap.delete(group);
      this.triggerCountMap.delete(group);
      this.saveToFile();
      return true;
    } else {
      return false;
    }
  }

  async getPrompt(group: string, config: any, session: any): Promise<string> {
    if (this.sendQueueMap.has(group)) {
      const queue = this.sendQueueMap.get(group);
      const promptArr = await Promise.all(queue.map(async (item) => {
        return {
          id: item.id,
          author: await getMemberName(config, session, item.sender_id),
          author_id: item.sender_id,
          msg: item.content,
        };
      }));

      let promptStr = JSON5.stringify(promptArr, null, 2);

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
              return '[图片]';
            }
            return match;
          });
        }
      }

      return promptStr;
    }
    return "[]";
  }
}
