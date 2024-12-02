import fs from "fs";
import https from "https";
import { Context } from "koishi";
import { promisify } from "util";
import { Config } from "../config";

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

// 将 fs.exists 转换为 Promise 版本
const exists = promisify(fs.exists);

export async function ensurePromptFileExists(
  url: string,
  ctx: Context | null,
  forceLoad: boolean = false
): Promise<void> {
  const debug = ctx !== null;
  const filePath = getFileNameFromUrl(url);

  const fileExists = await exists(filePath);

  // 检查 URL 是否合法
  let isURL = true;
  try {
    new URL(url);
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("Invalid URL")) {
      isURL = false;
    } else {
      // 重新抛出非 "Invalid URL" 的错误
      throw error;
    }
  }

  // 下载文件小助手
  const downloadFile = (url, filePath, debug, ctx) => {
    const file = fs.createWriteStream(filePath);
    const request = https.get(url, (response) => {
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        if (debug) ctx.logger.info("Successfully downloaded prompt file.");
      });
    });

    request.on("error", (err) => {
      fs.unlink(filePath, () => { });
      if (debug)
        ctx.logger.error("An error occurred while downloading prompt file: ", err.message.toString());
    });
  };

  // 文件存在
  if (fileExists) {
    // 如果需要强制加载且URL合法，下载文件
    if (forceLoad && isURL) {
      downloadFile(url, filePath, debug, ctx);
    } else {
      if (debug) ctx.logger.info("Prompt file already exists.");
    }
  } else {
    // 文件不存在且URL合法，下载文件
    if (isURL) {
      if (debug) ctx.logger.info("Prompt file not found, downloading ...");
      downloadFile(url, filePath, debug, ctx);
    } else {
      if (debug) ctx.logger.error("Prompt file not found.");
    }
  }
}

export async function getBotName(config: Config, session: any): Promise<string> {
  switch (config.Bot.SelfAwareness) {
    case "此页面设置的名字":
    default:
      return config.Bot.BotName;
    case "群昵称":
      const groupMember = session.groupMemberList?.data.find(
        (member: any) => member.user.id === session.event.selfId
      );
      return groupMember ? groupMember.nick : config.Bot.BotName;
    case "用户昵称":
      return session.bot.user.name;
  }
}

export async function getMemberName(config: Config, session: any, byID?: string): Promise<string> {
  const fetchUserName = async (id: string) => {
    try {
      return await session.bot.getUser(id);
    } catch (error) {
      try {
        const response = await fetch(`https://api.usuuu.com/qq/${id}`);
        const userData = await response.json();
        if (!response.ok)
          throw new Error(`Failed to fetch user from backup API`);
        return userData.data.name;
      } catch {
        throw new Error(`Failed to fetch user from backup API`);
      }
    }
  };

  if (session.event.selfId === session.event.user.id) {
    return await getBotName(config, session);
  }

  const member = session.groupMemberList?.data.find(
    (member: any) => member.user.id === (byID || session.event.user.id)
  );

  if (config.Bot.NickorName === "用户昵称") {
    return byID ? await fetchUserName(byID) : session.event.user.name;
  }

  return member?.nick || (byID ? await fetchUserName(byID) : session.event.user.name);
}

export async function genSysPrompt(
  config: Config,
  curGroupName: string,
  session: any,
): Promise<string> {
  // 获取当前日期与时间
  const currentDate = new Date();
  // 2024年12月2日星期一 00:25:12
  const formattedDate = currentDate.toLocaleString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "long"
  });
  let content = fs.readFileSync(
    getFileNameFromUrl(config.Bot.PromptFileUrl[config.Bot.PromptFileSelected]),
    "utf-8"
  );
  content = content.replaceAll("${config.Bot.BotName}", await getBotName(config, session));
  content = content.replaceAll("${config.Bot.WhoAmI}", config.Bot.WhoAmI);
  content = content.replaceAll("${config.Bot.BotHometown}", config.Bot.BotHometown);
  content = content.replaceAll("${config.Bot.BotYearold}", config.Bot.BotYearold);
  content = content.replaceAll("${config.Bot.BotPersonality}", config.Bot.BotPersonality);
  content = content.replaceAll("${config.Bot.BotGender}", config.Bot.BotGender);
  content = content.replaceAll("${config.Bot.BotHabbits}", config.Bot.BotHabbits);
  content = content.replaceAll("${config.Bot.BotBackground}", config.Bot.BotBackground);
  content = content.replaceAll("${config.Bot.CuteMode}", `${config.Bot.CuteMode ? "开启" : "关闭"}`);
  content = content.replaceAll("${currentDate}", formattedDate);
  content = content.replaceAll("${curGroupName}", curGroupName);
  return content;
}

/**
 * 模板引擎
 */
class Template {
  constructor(private templateString: string){}
  render(model: any){
    return this.templateString.replace(/\{(\w+(?:\.\w+)*)\}/g, (match, key) => {
      return this.getValue(model, key.split('.'));
    });
  }
  getValue(data: any, keys: string[]) {
    let value = data;
    for (let key of keys) {
      if (value && typeof value === 'object') {
        value = value[key];
      } else {
        return '';
      }
    }
    return value || '';
  };
}