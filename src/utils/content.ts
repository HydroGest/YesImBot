import { getMemberName } from './prompt';
import https from 'https';
import axios from 'axios';
import {readFileSync} from 'fs';
import path from 'path';
import { replaceImageWith } from './image-viewer';

interface Emoji {
  id: string;
  name: string;
}

class EmojiManager {
  private idToName: { [key: string]: string } = {};
  private nameToId: { [key: string]: string } = {};

  constructor() {
    const emojisFile = path.join(__dirname, '../../data/emojis.json');
    const emojis: Emoji[] = JSON.parse(readFileSync(emojisFile, 'utf-8'));

    emojis.forEach(emoji => {
      this.idToName[emoji.id] = emoji.name;
      this.nameToId[emoji.name] = emoji.id;
    });
  }

  async getNameById(id: string): Promise<string | undefined> {
    return this.idToName[id];
  }

  async getIdByName(name: string): Promise<string | undefined> {
    return this.nameToId[name];
  }
}

export const emojiManager = new EmojiManager();

// 通过ID查询表情名称
// console.log(emojiManager.getNameById('1')); // 输出: '撇嘴'

// 通过表情名称查询ID
// console.log(emojiManager.getIdByName('撇嘴')); // 输出: '1'

// 对于QQ，只有type为1的表情才是QQ表情，其他的是普通emoji，无需转义。移除对type的处理

export async function replaceTags(str: string, config: any): Promise<string> {
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

  // url 转 base64 添加到 img 标签中
  const imgMatches = Array.from(finalString.matchAll(imgRegex));
  const imgReplacements = await Promise.all(imgMatches.map(async (match) => {
    const [fullMatch, src] = match;
    const imageUrl = src.replace(/&amp;/g, '&');
    try {
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        httpsAgent: new https.Agent({ rejectUnauthorized: false }), // 忽略SSL证书验证
        timeout: 5000  // 5秒超时
      });

      const buffer = Buffer.from(response.data);
      const contentType = response.headers['content-type'] || 'image/jpeg';
      const base64 = `data:${contentType};base64,${buffer.toString('base64')}`;

      return {
        match: fullMatch,
        replacement: `<img base64="${base64}" src="${imageUrl}"/>`
      };
    } catch (error) {
      console.error('Error converting image to base64:', error.message);
      return {
        match: fullMatch,
        replacement: `<img src="${imageUrl}"/>`
      };
    }
  }));

  if (config.ImageViewer.How !== 'LLM API 自带的多模态能力') {
    for (const { match, replacement } of imgReplacements) {
      const newReplacement = await replaceImageWith(replacement, config);
      finalString = finalString.replace(match, newReplacement);
    }
  } else {
    for (const { match, replacement } of imgReplacements) {
      finalString = finalString.replace(match, replacement);
    }
  }

  finalString = finalString.replace(videoRegex, "[视频]");
  finalString = finalString.replace(audioRegex, "[音频]");

  return finalString;
}

/*
    @description: 处理 人类 的消息
*/
export async function processUserContent(config: any, session: any): Promise<{ content: string, name: string }> {
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
