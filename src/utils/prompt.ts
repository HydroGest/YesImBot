import fs from "fs";
import https from "https";
import { Context } from "koishi";
import { promisify } from "util";

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

export async function getBotName(config: any, session: any): Promise<string> {
  switch (config.Bot.SelfAwareness) {
    case "此页面设置的名字":
    default:
      return config.Bot.BotName;
    case "群昵称":
      const groupMember = session.groupMemberList.data.find(
        (member: any) => member.user.id === session.event.selfId
      );
      return groupMember ? groupMember.nick : config.Bot.BotName;
    case "用户昵称":
      return session.bot.user.name;
  }
}

export async function getMemberName(config: any, session: any) {
  if (session.event.selfId === session.event.user.id) {
    return await getBotName(config, session);
  }

  switch (config.Bot.NickorName) {
    case "用户昵称":
      return session.event.user.name;
    case "群昵称":
    default:
      const member = session.groupMemberList.data.find(
        (member: any) => member.user.id === session.event.user.id
      );
      return member ? member.nick : session.event.user.name;
  }
}

export async function genSysPrompt(
  config: any,
  curGroupName: string,
  session: any,
): Promise<string> {
  // 获取当前日期与时间
  const currentDate = new Date();
  const curYear: number = currentDate.getFullYear();
  const curMonth: number = currentDate.getMonth() + 1;
  const curDate: number = currentDate.getDate();
  const curHour: number = currentDate.getHours();
  const curMinute: number = currentDate.getMinutes();
  const curSecond: number = currentDate.getSeconds();

  let content = fs.readFileSync(
    getFileNameFromUrl(config.Bot.PromptFileUrl[config.Bot.PromptFileSelected]),
    "utf-8"
  );

  content = content.replaceAll("${config.Bot.BotName}", await getBotName(config, session));
  content = content.replaceAll("${config.Bot.WhoAmI}", config.Bot.WhoAmI);
  content = content.replaceAll(
    "${config.Bot.BotHometown}",
    config.Bot.BotHometown
  );
  content = content.replaceAll(
    "${config.Bot.BotYearold}",
    config.Bot.BotYearold
  );
  content = content.replaceAll(
    "${config.Bot.BotPersonality}",
    config.Bot.BotPersonality
  );
  content = content.replaceAll("${config.Bot.BotGender}", config.Bot.BotGender);
  content = content.replaceAll(
    "${config.Bot.BotHabbits}",
    config.Bot.BotHabbits
  );
  content = content.replaceAll(
    "${config.Bot.BotBackground}",
    config.Bot.BotBackground
  );
  content = content.replaceAll("${config.Bot.CuteMode}", config.Bot.CuteMode);

  content = content.replaceAll("${curYear}", curYear.toString());
  content = content.replaceAll("${curMonth}", curMonth.toString());
  content = content.replaceAll("${curDate}", curDate.toString());
  content = content.replaceAll("${curHour}", curHour.toString());
  content = content.replaceAll("${curMinute}", curMinute.toString());
  content = content.replaceAll("${curSecond}", curSecond.toString());

  content = content.replaceAll("${curGroupName}", curGroupName);

  return content;
}
