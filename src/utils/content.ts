import { h, Session } from 'koishi';

import { getImageDescription } from '../services/imageViewer';
import { Config } from '../config';
import { ChatMessage } from '../models/ChatMessage';
import { Template } from './string';

/**
 * 处理用户消息
 * @param config 
 * @param session 
 * @param messages 
 * @returns 
 */
export async function processContent(config: Config, session: Session, messages: ChatMessage[]): Promise<string> {
  const processedMessage: string[] = [];
  for (let chatMessage of messages) {
    // 12月3日星期二 17:34:00
    const timeString = chatMessage.sendTime.toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    let userName: string;
    switch (config.Bot.NickorName) {
      case "群昵称":
        userName = chatMessage.senderNick;
      case "用户昵称":
      default:
        userName = chatMessage.senderName;
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
          const safeAttrs = Object.entries(elem.attrs)
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
          userContent.push(await getImageDescription(elem.attrs.src, config, elem.attrs.summary, elem.attrs.fileUnique));
          break;
        case "face":
          // const { id, name } = elem.attrs;
          userContent.push(`[表情:${elem.attrs.name}]`);
          break;
        case "mface":
          // const { url, summary } = elem.attrs;
          userContent.push(`[表情:${elem.attrs.summary}]`);
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
      channelInfo: (chatMessage.channelType === "guild") ? `from_guild:${chatMessage.channelId}` : (chatMessage.channelType === "sandbox") ? "from_sandbox" : "from_private",
      channelId: chatMessage.channelId,
      senderName: userName,
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

export function processText(rules: Config["Bot"]["BotSentencePostProcess"], text: string): string[] {
  const replacements = rules.map(item => ({
    regex: new RegExp(item.replacethis, 'g'),
    replacement: item.tothis
  }));
  let quoteMessageId;
  let splitRegex = /(?<=[。?!？！])\s*/;
  const sentences: string[] = [];
  // 发送前先处理 Bot 消息
  h.parse(text).forEach((node) => {
    // 只针对纯文本进行处理
    if (node.type === "text") {
      let text = node.attrs.content;
      // 关键词替换
      for (let { regex, replacement } of replacements) {
        text = text.replace(regex, replacement);
      }
      // 分句
      sentences.push(...text.split(splitRegex));
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
