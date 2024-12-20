import { h, Session } from 'koishi';

import { Config } from '../config';
import { ChannelType, ChatMessage } from '../models/ChatMessage';
import { Template } from './string';
import { getFileUnique, getMemberName, getFormatDateTime } from './toolkit';
import { ImageViewer } from '../services/imageViewer';
import { convertUrltoBase64 } from "../utils/imageUtils";
import { Message, AssistantMessage, ImageComponent, SystemMessage, TextComponent, UserMessage } from "../adapters/creators/component";


/**
 * 处理用户消息
 * @param config
 * @param session
 * @param messages
 * @returns
 */
export async function processContent(config: Config, session: Session, messages: ChatMessage[], imageViewer: ImageViewer): Promise<Message[]> {
  const processedMessage: Message[] = [];
  let pendingProcessImgCount = 0;

  for (let chatMessage of messages) {
    // 2024年12月3日星期二17:34:00
    const timeString = getFormatDateTime(chatMessage.sendTime);
    let senderName: string;
    switch (config.Bot.NickorName) {
      case "群昵称":
        senderName = chatMessage.senderNick;
        break;
      case "用户昵称":
      default:
        senderName = chatMessage.senderName;
        break;
    }
    const template = config.Settings.SingleMessageStrctureTemplate;
    const elements = h.parse(chatMessage.content);
    let components: (TextComponent | ImageComponent)[] = [];
    for (let elem of elements) {
      switch (elem.type) {
        case "text":
          // const { content } = elem.attrs;
          components.push(TextComponent(elem.attrs.content));
          break;
        case "at":
          const attrs = { ...elem.attrs };
          let userName: string;
          switch (config.Bot.NickorName) {
            case "群昵称":
              userName = messages.filter((m) => m.senderId === attrs.id)[0]?.senderNick;
              break;
            case "用户昵称":
            default:
              userName = messages.filter((m) => m.senderId === attrs.id)[0]?.senderName;
              break;
          }
          // 似乎getMemberName的实现有问题，无法正确获取到群昵称，总是获取到用户昵称。修复后，取消注释下面的代码
          attrs.name = userName || attrs.name || await getMemberName(config, session, attrs.id, chatMessage.channelId);
          const safeAttrs = Object.entries(attrs)
            .map(([key, value]) => {
              // 确保value是字符串
              const strValue = String(value);
              // 转义单引号和其他潜在的危险字符
              const safeValue = strValue
                .replace(/'/g, "&#39;")
                .replace(/"/g, "&quot;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");
              return `${key}='${safeValue}'`;
            })
            .join(' ');
          const atMessage = `<at ${safeAttrs}/>`;
          components.push(TextComponent(atMessage));
          break;
        case "quote":
          // const { id } = elem.attrs;
          chatMessage.quoteMessageId = elem.attrs.id;
          break;
        case "img":
          // const { src, summary, fileUnique } = elem.attrs;
          let cacheKey = getFileUnique(elem, session.bot.platform);
          elem.attrs.cachekey = cacheKey;
          components.push(ImageComponent(h.img(elem.attrs.src, { cachekey: elem.attrs.cachekey, summary: elem.attrs.summary }).toString()));
          pendingProcessImgCount++;
          break;
        case "face":
          // const { id, name } = elem.attrs;
          components.push(TextComponent(`[表情:${elem.attrs.name}]`));
          break;
        case "mface":
          // const { url, summary } = elem.attrs;
          components.push(TextComponent(`[表情:${elem.attrs.summary?.replace(/^\[|\]$/g, '')}]`));
          break;
        default:
      }
    }
    // [messageId][{date} from_guild:{channelId}] {senderName}<{senderId}> 说: {userContent}
    // [messageId][{date} from_guild:{channelId}] {senderName}<{senderId}> 回复({quoteMessageId}): {userContent}
    // [messageId][{date} from_private] {senderName}<{senderId}> 说: {userContent}
    // [messageId][{date} from_private] {senderName}<{senderId}> 回复({quoteMessageId}): {userContent}
    let messageText = new Template(template, /\{\{(\w+(?:\.\w+)*)\}\}/g, /\{\{(\w+(?:\.\w+)*),([^,]*),([^}]*)\}\}/g).render({
      messageId: chatMessage.messageId,
      date: timeString,
      channelType: chatMessage.channelType,
      channelInfo: (chatMessage.channelType === ChannelType.Guild) ? `from_guild:${chatMessage.channelId}` : `${ chatMessage.channelType === ChannelType.Private ? "from_private" : "from_sandbox" }`,
      channelId: chatMessage.channelId,
      senderName,
      senderId: chatMessage.senderId,
      userContent: "{{userContent}}",
      quoteMessageId: chatMessage.quoteMessageId || "",
      hasQuote: !!chatMessage.quoteMessageId,
      isPrivate: chatMessage.channelType === ChannelType.Private,
    });
    const parts = messageText.split(/({{userContent}})/);
    components = parts.flatMap(part => {
      if (part === '{{userContent}}') {
        return components;
      }
      return [TextComponent(part)];
    });
    if (chatMessage.senderId === session.bot.selfId) {
      processedMessage.push(AssistantMessage(...components));
    } else {
      processedMessage.push(UserMessage(...components));
    }
  }
  // 处理图片组件
  for (const message of processedMessage) {
    if (typeof message.content === 'string') continue;

    for (let i = 0; i < message.content.length; i++) {
      const component = message.content[i];
      if (component.type !== 'image_url') continue;
      // 解析图片URL中的属性
      const elem = h.parse((component as ImageComponent).image_url.url)[0];
      const cacheKey = elem.attrs.cachekey;
      const src = elem.attrs.src;
      const summary = elem.attrs.summary;

      if (pendingProcessImgCount > config.ImageViewer.Memory && config.ImageViewer.Memory !== -1) {
        // 获取图片描述
        const description = await imageViewer.getImageDescription(src, cacheKey, summary);
        message.content[i] = TextComponent(description);
      } else {
        // 转换为base64
        const base64 = await convertUrltoBase64(src);
        message.content[i] = ImageComponent(base64, config.ImageViewer.Server.Detail || "auto");
      }

      pendingProcessImgCount--;
    }

    // 合并每条message中相邻的 TextComponent
    message.content = message.content.reduce((acc, curr, i) => {
      if (i === 0) return [curr];

      const prev = acc[acc.length - 1];
      if (prev.type === 'text' && curr.type === 'text') {
        // 合并相邻的 TextComponent
        prev.text += (curr as TextComponent).text;
        return acc;
      }

      return [...acc, curr];
    }, []);
  }
  return processedMessage;
}




export function processText(splitRule: Config["Bot"]["BotReplySpiltRegex"], replaceRules: Config["Bot"]["BotSentencePostProcess"], text: string): string[] {
  const replacements = replaceRules.map(item => ({
    regex: new RegExp(item.replacethis, 'g'),
    replacement: item.tothis
  }));
  let quoteMessageId;
  let splitRegex = new RegExp(splitRule);
  const sentences: string[] = [];
  // 发送前先处理 Bot 消息
  h.parse(text).forEach((node) => {
    // 只针对纯文本进行处理
    if (node.type === "text") {
      let text: string = node.attrs.content;
      // 关键词替换
      for (let { regex, replacement } of replacements) {
        text = text.replace(regex, replacement);
      }
      // 分句
      let temp = text.split(splitRegex);
      let last = sentences.pop() || "";
      let first = temp.shift() || "";
      sentences.push(last + first, ...temp);
    } else if (node.type === "quote") {
      quoteMessageId = node.attrs.id;
    } else {
      let temp = sentences.pop() || "";
      temp += node.toString();
      sentences.push(temp);
    }
  });
  if (quoteMessageId) sentences[0] = h.quote(quoteMessageId).toString() + sentences[0];
  return sentences;
}
