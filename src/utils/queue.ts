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
    { id: number; sender: string; sender_id: string; content: string; session: any }[]
  >;
  private triggerCountMap: Map<string, number>;

  constructor() {
    this.sendQueueMap = new Map<
      string,
      { id: number; sender: string; sender_id: string; content: string; session: any }[]
    >();
    this.triggerCountMap = new Map<string, number>();
  }

  // 消息入队
  updateSendQueue(
    group: string,
    sender: string,
    sender_id: any,
    content: string,
    id: any,
    FilterList: any,
    session: any,
    TriggerCount: number
  ) {
    if (this.sendQueueMap.has(group)) {
      if (containsFilter(content, FilterList)) return;
      const queue = this.sendQueueMap.get(group);
      queue.push({ id: Number(id), sender: sender, sender_id: sender_id, content: content, session: session });
      this.sendQueueMap.set(group, queue);
    } else {
      this.sendQueueMap.set(group, [{ id: Number(id), sender: sender, sender_id: sender_id, content: content, session: session }]);
    }

    // 更新触发计数
    if (this.triggerCountMap.has(group)) {
      this.triggerCountMap.set(group, this.triggerCountMap.get(group) - 1);
    } else {
      this.triggerCountMap.set(group, TriggerCount - 1 );
    }
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
  checkTriggerCount(group: string, nextTriggerCount: number, isAtMentioned: boolean ): boolean {
    if (this.triggerCountMap.has(group)) {
      const count = this.triggerCountMap.get(group);
      console.log(`距离下一次触发还有: ${count} 条消息`);
      if (count <= 0 || isAtMentioned) {
        this.triggerCountMap.set(group, nextTriggerCount);
        return true;
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
      console.log(`队列已满，已出队至 ${newQueue.length} 条`);
    }
  }

  getPrompt(group: string, session: any): string {
    const groupMemberList = session.groupMemberList;
    if (this.sendQueueMap.has(group)) {
      const queue = this.sendQueueMap.get(group);
      const promptArr = queue.map((item) => {
        return {
          id: item.id,
          author: groupMemberList.data.find((member) => member.user.id === item.sender_id).nick,
          author_id: item.sender_id,
          msg: item.content,
        };
      });
      //ctx.logger.info(JSON.stringify(promptArr, null, 2));
      return JSON.stringify(promptArr, null, 2);
    }
    return "[]";
  }
}
