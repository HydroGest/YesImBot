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

export async function genSysPrompt(
  config: Config,
  extra: any
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
  let template = new Template(content);
  return template.render({
    config,
    currentDate: formattedDate,
    ...extra
  });
}

/**
 * 模板引擎
 * 
 * 和 JS 模板字符串差不多
 */
class Template {
  constructor(private templateString: string){}
  render(model: any){
    return this.templateString.replace(/\$\{(\w+(?:\.\w+)*)\}/g, (match, key) => {
      return this.getValue(model, key.split('.'));
    });
  }
  private getValue(data: any, keys: string[]) {
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