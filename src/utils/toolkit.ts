import { Session } from "koishi";

import { Config } from "../config";


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

export async function getBotName(botConfig: Config["Bot"], session: Session): Promise<string> {
  switch (botConfig.SelfAwareness) {
    case "群昵称":
      const memberInfo = await session.onebot?.getGroupMemberInfo(session.guildId, session.bot.userId);
      return memberInfo?.card || memberInfo?.nickname || session.bot.user.name;
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
    groupMemberList = (await session.bot.getGuildMemberList(channelId || session.channelId)).data.forEach(member => {
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
  }
  return groupMemberList;
}
