import fs from "fs";
import { promisify } from "util";

import { Template } from "./string";
import { downloadFile, getFileNameFromUrl } from "./toolkit";


// 将 fs.exists 转换为 Promise 版本
const exists = promisify(fs.exists);

export async function ensurePromptFileExists(
  url: string,
  forceLoad: boolean = false,
  debug: boolean = false,
): Promise<void> {
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


  if (fileExists) {
    if (forceLoad && isURL) {
      // 如果需要强制加载且URL合法，下载文件
      downloadFile(url, filePath, debug);
    } else {
      if (debug) logger.info("Prompt file already exists.");
    }
  } else if (isURL) {
    // 文件不存在且URL合法，下载文件
    if (debug) logger.info("Prompt file not found, downloading ...")
    downloadFile(url, filePath, debug);
  } else if (debug) {
    logger.error("Prompt file not found.");
  }
}

export async function genSysPrompt(
  PromptFileUrl: string,
  extra: any
): Promise<string> {
  let content = fs.readFileSync(getFileNameFromUrl(PromptFileUrl),"utf-8");
  let template = new Template(content);
  return template.render({
    ...extra
  });
}

