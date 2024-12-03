import { Session } from "koishi";

import { Config } from "../config";
import { Adapter, register } from "../adapters";

// 检查群组是否在允许的群组组合列表中，并返回首个匹配到的群组组合配置或者所有匹配到的群组组合配置
export function isGroupAllowed(groupId: string, allowedGroups: string[], debug: boolean = false): [boolean, Set<string>] {
  const isPrivate = groupId.startsWith("private:");
  const matchedGroups = new Set<string>();

  // 遍历每个allowedGroups元素
  for (const groupConfig of allowedGroups) {
    // 使用Set去重
    const groups = new Set(
      groupConfig.split(",")
        .map(g => g.trim())
        .filter(g => g)  // 移除空字符串
    );

    for (const group of groups) {
      // 检查全局允许
      if (!isPrivate && group === "all") {
        if (debug) {
          groups.forEach(g => matchedGroups.add(g));
        } else {
          return [true, groups];
        }
      }
      // 检查全局私聊允许
      if (isPrivate && group === "private:all") {
        if (debug) {
          groups.forEach(g => matchedGroups.add(g));
        } else {
          return [true, groups];
        }
      }
      // 精确匹配
      if (groupId === group) {
        if (debug) {
          groups.forEach(g => matchedGroups.add(g));
        } else {
          return [true, groups];
        }
      }
    }
  }

  if (debug && matchedGroups.size > 0) {
    return [true, matchedGroups];
  }

  return [false, new Set()];
}


export function isChannelAllowed(slotContains: string[], channelId: string): boolean {
  for (let slot of slotContains) {
    if (slot.includes("private:all") && channelId.startsWith("private:")) {
      return true;
    } else if (slot.includes("all") && !channelId.startsWith("private:")) {
      return true;
    }

    for (let channel of slot.split(",")) {
      channel = channel.trim();
      if (channel === channelId) {
        return true;
      }
    }
  }
}

export function containsFilter(sessionContent: string, FilterList: any): boolean {
  for (const filterString of FilterList) {
    if (sessionContent.includes(filterString)) {
      return true;
    }
  }
  return false;
}

export class APIStatus {
  private currentStatus: number = 0;

  updateStatus(APILength: number): void {
    this.currentStatus++;
    if (this.currentStatus >= APILength) {
      this.currentStatus = 0;
    }
  }
  getStatus(): number {
    return this.currentStatus;
  }
}

export class ProcessingLock {
  private processingGroups: Set<string> = new Set();

  async waitForProcessing(groupId: string): Promise<void> {
    while (this.processingGroups.has(groupId)) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  startProcessing(groupId: string): void {
    this.processingGroups.add(groupId);
  }

  endProcessing(groupId: string): void {
    this.processingGroups.delete(groupId);
  }
}

export function updateAdapters(APIList: Config["API"]["APIList"]): Adapter[] {
  let adapters: Adapter[] = [];
  for (const adapter of APIList) {
    adapters.push(register(
      adapter.APIType,
      adapter.BaseURL,
      adapter.APIKey,
      adapter.UID,
      adapter.AIModel
    ))
  }
  return adapters;
}

export function addQuoteTag(session: Session, content: string): string {
  if (session.event.message.quote) {
    return `<quote id="${session.event.message.quote.id}"/>${content}`;
  } else {
    return content;
  }
}

export async function ensureGroupMemberList(session: any, groupId?: string) {
  const isPrivateChat = groupId.startsWith("private:");
  if (!session.groupMemberList && !isPrivateChat) {
    session.groupMemberList = await session.bot.getGuildMemberList(session.guildId);
    session.groupMemberList.data.forEach(member => {
      // 沙盒获取到的 member 数据不一样
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
    });
  } else if (isPrivateChat) {
    session.groupMemberList = {
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
  }
}

export async function getBotName(config: Config, session: Session): Promise<string> {
  switch (config.Bot.SelfAwareness) {
    case "群昵称":
      const memberInfo = await session.onebot.getGroupMemberInfo(session.channelId, session.userId);
      return memberInfo.card || memberInfo.nickname;
    case "用户昵称":
      return session.bot.user.name;
    case "此页面设置的名字":
    default:
      return config.Bot.BotName;
  }
}

export async function getMemberName(config: Config, session: Session, userId?: string, groupId?: string): Promise<string> {
  if (session.userId === session.selfId) {
    return await getBotName(config, session);
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
    return (await session.bot.getUser(userId, groupId)).name;
  }
}