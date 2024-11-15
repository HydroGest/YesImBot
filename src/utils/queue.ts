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

  constructor() {
    this.sendQueueMap = new Map<
      string,
      { id: number; sender: string; sender_id: string, content: string }[]
    >();
  }

  updateSendQueue(
    group: string,
    sender: string,
    sender_id: any,
    content: string,
    id: any,
    FilterList: any
  ) {
    if (this.sendQueueMap.has(group)) {
      if (containsFilter(content, FilterList)) return;
      const queue = this.sendQueueMap.get(group);
      queue.push({ id: Number(id), sender: sender, sender_id: sender_id, content: content });
      this.sendQueueMap.set(group, queue);
    } else {
      this.sendQueueMap.set(group, [{ id: Number(id), sender: sender, sender_id: sender_id, content: content }]);
    }
  }

  // 检查队列长度
  checkQueueSize(group: string, size: number): boolean {
    if (this.sendQueueMap.has(group)) {
      const queue = this.sendQueueMap.get(group);
      console.log(`${queue.length} / ${size}`);
      return queue.length >= size;
    }
    return false;
  }

  // 重置消息队列
  resetSendQueue(group: string, popNumber: number) {
    const queue = this.sendQueueMap.get(group);
    if (queue && queue.length > 0) {
      const newQueue = queue.slice(popNumber);
      this.sendQueueMap.set(group, newQueue);
    }
  }

  getPrompt(group: string): string {
    if (this.sendQueueMap.has(group)) {
      const queue = this.sendQueueMap.get(group);
      const promptArr = queue.map((item) => ({
        id: item.id,
        author: item.sender,
        author_id: item.sender_id,
        msg: item.content,
      }));
      //ctx.logger.info(JSON.stringify(promptArr, null, 2));
      return JSON.stringify(promptArr, null, 2);
    }
    return "[]";
  }
}
