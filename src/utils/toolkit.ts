import { Session } from "koishi";

import { Config } from "../config";


export function isChannelAllowed(slotContains: string[], channelId: string): boolean {
  for (let slot of slotContains) {
    for (let channel of slot.split(",")) {
      channel = channel.trim();
      if (channelId === channel) {
        return true;
      } else if (channel === "all" && !channelId.startsWith("private:")) {
        return true;
      } else if (channel === "private:all" && channelId.startsWith("private:")) {
        return true;
      }
    }
  }

  return false;
}

export function containsFilter(sessionContent: string, FilterList: any): boolean {
  for (const filterString of FilterList) {
    if (sessionContent.includes(filterString)) {
      return true;
    }
  }
  return false;
}

export class ProcessingLock {
  private mutex: Mutex;
  private processingGroups: Set<string> = new Set();
  private readonly processCheckInterval = 30;

  constructor() {
    this.mutex = new Mutex();
  }

  private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    try {
      await this.mutex.acquire(id);
      return await fn();
    } finally {
      this.mutex.release(id);
    }
  }

  async waitForProcess(groupId: string, timeout = 5000): Promise<void> {
    const startTime = Date.now();

    while (true) {
      const isProcessing = await this.withLock('processCheck', async () => {
        return this.processingGroups.has(groupId);
      });

      if (!isProcessing) return;

      if (Date.now() - startTime > timeout) {
        throw new Error(`Wait timeout for group ${groupId}`);
      }

      await new Promise(resolve => setTimeout(resolve, this.processCheckInterval));
    }
  }

  async start(groupId: string): Promise<void> {
    await this.withLock('processUpdate', async () => {
      this.processingGroups.add(groupId);
    });
  }

  async end(groupId: string): Promise<void> {
    await this.withLock('processUpdate', async () => {
      this.processingGroups.delete(groupId);
    });
  }
}

export async function getBotName(botConfig: Config["Bot"], session: Session): Promise<string> {
  switch (botConfig.SelfAwareness) {
    case "群昵称":
      if (session.guildId){
        const memberInfo = await session.onebot?.getGroupMemberInfo(session.guildId, session.bot.userId);
        return memberInfo?.card || memberInfo?.nickname || session.bot.user.name;
      } else {
        return session.bot.user.name;
      }
    case "用户昵称":
      return session.bot.user.name;
    case "此页面设置的名字":
    default:
      return botConfig.BotName;
  }
}

export async function getMemberName(config: Config, session: Session, userId?: string, groupId?: string): Promise<string> {
  if (session.userId === session.selfId) {
    return await getBotName(config.Bot, session);
  }
  if (!groupId && !userId) {
    groupId = session.guildId;
    userId = session.userId;
  }
  try {
    const memberInfo = await session.onebot.getGroupMemberInfo(groupId, userId);
    switch (config.Bot.NickorName) {
      case "用户昵称":
        return memberInfo.card || memberInfo.nickname;
      case "群昵称":
      default:
        return memberInfo.nickname;;
    }
  } catch (error) {
    try {
      return (await session.bot.getUser(userId, groupId)).name;
    } catch (error) {
      throw new Error(`Failed to fetch user from backup API`);
    }
  }
}

export async function ensureGroupMemberList(session: any, channelId?: string) {
  let groupMemberList = {
    data: [
      {
        user:
        {
          id: `${session.event.user.id}`,
          name: `${session.event.user.name}`,
          userId: `${session.event.user.id}`,
          avatar: `http://q.qlogo.cn/headimg_dl?dst_uin=${session.event.user.id}&spec=640`,
          username: `${session.event.user.name}`
        },
        nick: `${session.event.user.name}`,
        roles: ['member']
      },
      {
        user:
        {
          id: `${session.event.selfId}`,
          name: `${session.bot.user.name}`,
          userId: `${session.event.selfId}`,
          avatar: `http://q.qlogo.cn/headimg_dl?dst_uin=${session.event.selfId}&spec=640`,
          username: `${session.bot.user.name}`
        },
        nick: `${session.bot.user.name}`,
        roles: ['member']
      }
    ]
  };
  const isPrivateChat = channelId ? channelId.startsWith("private:") : session.channelId.startsWith("private:");
  if (!isPrivateChat) {
    try {
      const response = await session.bot.getGuildMemberList(channelId || session.channelId);
      if (response?.data) {
        const processedMembers = response.data.map(member => {
          if (member.userId === member.username && !member.user) {
            member.user = {
              id: member.userId,
              name: member.username,
              userId: member.userId,
            };
            member.nick = member.username;
            member.roles = ['member'];
          }
          if (!member.nick) {
            member.nick = member.user.name || member.user.username;
          }
          return member;
        });

        groupMemberList.data = processedMembers;
      }
    } catch (error) {
      logger.warn('Failed to fetch guild member list:', error);
    }
  }

  return groupMemberList;
}

/**
 * 简单的 Mutex 实现
 * @author deepseek
 **/
export class Mutex {
  private checkInterval: number;
  private isLocked: Map<string, boolean> = new Map();

  constructor(checkInterval: number = 30) {
    this.checkInterval = checkInterval;
  }

  async acquire(id: string): Promise<void> {
    return new Promise((resolve) => {
      if (!this.isLocked.get(id)) {
        this.isLocked.set(id, true);
        resolve();
      } else {
        const check = () => {
          if (!this.isLocked.get(id)) {
            this.isLocked.set(id, true);
            resolve();
          } else {
            setTimeout(check, this.checkInterval);
          }
        };
        check();
      }
    });
  }

  release(id: string): void {
    this.isLocked.set(id, false);
  }
}
