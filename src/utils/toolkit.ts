import crypto from "crypto";
import fs from "fs";
import https from "https";
import { h, Session } from "koishi";
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

/**
 * 消息内容是否包含过滤词
 * @param content
 * @param FilterList
 * @returns
 */
export function containsFilter(content: string, FilterList: string[]): boolean {

  // 这样好像不能保证正则的正确性
  //let re = new RegExp(FilterList.join("|"), "gi");
  //return re.test(content);

  for (const filter of FilterList) {
    let regex = new RegExp(filter, "gi");
    if (regex.test(content))
      return true;
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

// 计算 MD5 值作为缓存键
export function computeMD5(input: string): string {
  return crypto.createHash("md5").update(input).digest("hex");
}

// 按照平台从img中获取fileUnique
export function getFileUnique(config: Config, element: h, platform: string): string {
  if (config.Debug.FileUniqueField) {
    return element.attrs[config.Debug.FileUniqueField];
  }
  switch (platform) {
    case "onebot":
      return element.attrs.fileid;
    // 其他平台有待添加
  }
}


export function getFileNameFromUrl(url: string): string {
  try {
    const parsedUrl = new URL(url);
    const filePath = parsedUrl.pathname;
    return filePath.substring(filePath.lastIndexOf("/") + 1);
  } catch (error) {
    // 根据文档，此时认为用户输入的是文件名
    if (error instanceof TypeError && error.message.includes("Invalid URL")) {
      return url;
    } else {
      // 重新抛出非 "Invalid URL" 的错误
      throw error;
    }
  }
}

// 下载文件小助手
export function downloadFile(url, filePath, debug) {
  const file = fs.createWriteStream(filePath);
  const request = https.get(url, (response) => {
    response.pipe(file);
    file.on("finish", () => {
      file.close();
      if (debug) logger.info("Successfully downloaded prompt file.");
    });
  });

  request.on("error", (err) => {
    fs.unlink(filePath, () => { });
    if (debug)
      logger.error("An error occurred while downloading prompt file: ", err.message.toString());
  });
};
