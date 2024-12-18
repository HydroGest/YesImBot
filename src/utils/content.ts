import { h, Session } from 'koishi';

import { Config } from '../config';
import { ChatMessage } from '../models/ChatMessage';
import { Template } from './string';
import { getFileUnique, getMemberName } from './toolkit';
import { ImageViewer } from '../services/imageViewer';

/**
 * 处理用户消息
 * @param config
 * @param session
 * @param messages
 * @returns
 */
export async function processContent(config: Config, session: Session, messages: ChatMessage[], imageViewer: ImageViewer): Promise<string> {
  const processedMessage: string[] = [];

  for (let chatMessage of messages) {
    // 12月3日星期二 17:34:00
    const timeString = chatMessage.sendTime.toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
    const userContent = [];
    const template = config.Settings.SingleMessageStrctureTemplate;
    const elements = h.parse(chatMessage.content);
    for (let elem of elements) {
      switch (elem.type) {
        case "text":
          // const { content } = elem.attrs;
          userContent.push(elem.attrs.content);
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
          userContent.push(atMessage);
          break;
        case "quote":
          // const { id } = elem.attrs;
          chatMessage.quoteMessageId = elem.attrs.id;
          break;
        case "img":
          // const { src, summary, fileUnique } = elem.attrs;
          let cacheKey = getFileUnique(config, elem, session.bot.platform);
          userContent.push(await imageViewer.getImageDescription(elem.attrs.src, cacheKey, elem.attrs.summary, config.Debug.DebugAsInfo));
          break;
        case "face":
          // const { id, name } = elem.attrs;
          userContent.push(`[表情:${elem.attrs.name}]`);
          break;
        case "mface":
          // const { url, summary } = elem.attrs;
          userContent.push(`[表情:${elem.attrs.summary?.replace(/^\[|\]$/g, '')}]`);
          break;
        default:
      }
    }
    // [messageId][{date} from_guild:{channelId}] {senderName}<{senderId}> 说: {userContent}
    // [messageId][{date} from_guild:{channelId}] {senderName}<{senderId}> 回复({quoteMessageId}): {userContent}
    // [messageId][{date} from_private] {senderName}<{senderId}> 说: {userContent}
    // [messageId][{date} from_private] {senderName}<{senderId}> 回复({quoteMessageId}): {userContent}
    let messageText = new Template(template, /\{\{(\w+(?:\.\w+)*)\}\}/g).render({
      messageId: chatMessage.messageId,
      date: timeString,
      channelType: chatMessage.channelType,
      channelInfo: (chatMessage.channelType === "guild") ? `from_guild:${chatMessage.channelId}` : `from_${chatMessage.channelType}`,
      channelId: chatMessage.channelId,
      senderName,
      senderId: chatMessage.senderId,
      quoteMessageId: chatMessage.quoteMessageId || "",
      userContent: userContent.join(""),
    }).replace(/{{hasQuote,(.*?),(.*?)}}/, (_, arg1, arg2) =>
      chatMessage.quoteMessageId ? arg1 : arg2
    ).replace(/{{isPrivate,(.*?),(.*?)}}/, (_, arg1, arg2) =>
      chatMessage.channelType === "private" ? arg1 : arg2
    );
    processedMessage.push(messageText);
  }

  return processedMessage.join("\n");
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
