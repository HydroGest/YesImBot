import { Session } from 'koishi';

import { getImageDescription } from '../services/imageViewer';
import { Config } from '../config';
import { emojiManager } from '../managers/emojiManager';
import { convertUrltoBase64 } from './imageUtils';
import { getMemberName } from './toolkit';


// 对于QQ，只有type为1的表情才是QQ表情，其他的是普通emoji，无需转义。移除对type的处理

export async function replaceTags(str: string, config: Config): Promise<string> {
  const faceidRegex = /<face id="(\d+)"(?: name="([^"]*)")?(?: platform="[^"]*")?><img src="[^"]*"?\/><\/face>/g;
  const imgRegex = /<img[^>]+src\s*=\s*"([^"]+)"[^>]*\/>/g;
  const videoRegex = /<video[^>]+\/>/g;
  const audioRegex = /<audio[^>]+\/>/g;

  let finalString: string = str;

  const faceidMatches = Array.from(finalString.matchAll(faceidRegex));
  const faceidReplacements = await Promise.all(faceidMatches.map(async (match) => {
    let [, id, name] = match;
    if (!name) {
      const emojiName = await emojiManager.getNameById(id);
      name = emojiName ? emojiName : "未知";
    }
    return {
      match: match[0],
      replacement: `[表情: ${name}]`,
    };
  }));
  faceidReplacements.forEach(({ match, replacement }) => {
    finalString = finalString.replace(match, replacement);
  });

  const imgMatches = Array.from(finalString.matchAll(imgRegex));
  for (const match of imgMatches) {
    const [fullMatch, src] = match;
    const imageUrl = src.replace(/&amp;/g, '&');
    let replacement = fullMatch;

    if (config.ImageViewer.How === 'LLM API 自带的多模态能力') {
      const base64 = await convertUrltoBase64(imageUrl);
      replacement = `<img base64="${base64}" src="${imageUrl}"/>`;
    } else {
      replacement = await getImageDescription(fullMatch, config);
    }

    finalString = finalString.replace(fullMatch, replacement);
  }

  finalString = finalString.replace(videoRegex, "[视频]");
  finalString = finalString.replace(audioRegex, "[音频]");

  return finalString;
}

/*
    @description: 处理 人类 的消息
*/
export async function processUserContent(config: Config, session: Session): Promise<{ content: string, name: string }> {
  const regex = /<at id="([^"]+)"(?:\s+name="([^"]+)")?\s*\/>/g;
  // 转码 <at> 消息，把<at id="0" name="YesImBot" /> 转换为 @Athena 或 @YesImBot
  const matches = Array.from(session.content.matchAll(regex));
  let finalName = "";

  const userContentPromises = matches.map(async (match) => {

    const id = match[1].trim();
    const name = match[2]?.trim(); // 可能获取到 name

    const memberName = await getMemberName(config, session, id);
    finalName = memberName ? memberName : (name ? name : "UserNotFound");
    return {
      match: match[0],
      replacement: `@${finalName}`,
    }
  });

  const userContents = await Promise.all(userContentPromises);
  let userContent: string = session.content;
  userContents.forEach(({ match, replacement }) => {
    userContent = userContent.replace(match, replacement);
  });

  // 替换 <at type="all"/> 和 <at type="here"/>
  userContent = userContent.replace(/<at type="all"\s*\/>/g, '@全体成员');
  userContent = userContent.replace(/<at type="here"\s*\/>/g, '@在线成员');

  userContent = await replaceTags(userContent, config);
  return { content: userContent, name: finalName };
}
