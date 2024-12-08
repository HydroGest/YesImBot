import { Session } from "koishi";
import { Mutex } from 'async-mutex';

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
  private readonly locks: Map<string, {
    mutex: Mutex;
    waiters: Array<(value: void) => void>;
  }> = new Map();

  constructor() {
    this.locks = new Map();
  }

  private getLockData(id: string) {
    if (!this.locks.has(id)) {
      this.locks.set(id, {
        mutex: new Mutex(),
        waiters: []
      });
    }
    return this.locks.get(id);
  }

  private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const lockData = this.getLockData(id);
    return await lockData.mutex.runExclusive(fn);
  }

  async waitForProcess(groupId: string, timeout = 5000): Promise<void> {
    const lockData = this.locks.get(groupId);
    if (!lockData) return;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = lockData.waiters.indexOf(resolve);
        if (index > -1) lockData.waiters.splice(index, 1);
        reject(new Error('Timeout waiting for process'));
      }, timeout);

      lockData.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async start(groupId: string): Promise<void> {
    await this.withLock(groupId, async () => {
      this.getLockData(groupId);
    });
  }

  async end(groupId: string): Promise<void> {
    await this.withLock(groupId, async () => {
      const lockData = this.locks.get(groupId);
      if (lockData) {
        lockData.waiters.forEach(resolve => resolve());
        this.locks.delete(groupId);
      }
    });
  }
}


export async function getBotName(botConfig: Config["Bot"], session: Session): Promise<string> {
  switch (botConfig.SelfAwareness) {
    case "群昵称":
      if (session.guildId) {
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

