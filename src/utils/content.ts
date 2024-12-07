import { h, Session } from 'koishi';

import { getImageDescription } from '../services/imageViewer';
import { Config } from '../config';
import { getMemberName } from './toolkit';
import { ChatMessage } from '../models/ChatMessage';


export async function processContent(config: Config, session: Session, messages: ChatMessage[]): Promise<string> {
  const processedMessage: string[]= [];
  for (let chatMessage of messages) {
      // 12月3日星期二 17:34:00
      const timeString = chatMessage.sendTime.toLocaleString("zh-CN", {month: "long",day: "numeric",hour: "2-digit",minute: "2-digit",second: "2-digit"});
      let messagePrefix = `[${timeString} ${chatMessage.channelType === "guild" ? `from_channel:${chatMessage.channelId} sender_id:${chatMessage.senderId}` : `from_qq:${chatMessage.senderId}`}]`;
      let userName: string;
      switch (config.Bot.NickorName) {
        case "群昵称":
          userName = chatMessage.senderNick;
        case "用户昵称":
        default:
          userName = chatMessage.senderName;
      }
      messagePrefix += ` "${userName}"`;
      const userContent = [];
      const elements = h.parse(chatMessage.content);
      for (let elem of elements) {
        switch (elem.type){
          case "text":
            // const { content } = elem.attrs;
            userContent.push(elem.attrs.content);
            break;
          case "at":
            // const { id } = elem.attrs;
            if (elem.attrs.id === "0" && elem.attrs.name === "@全体成员") {
              userContent.push("@全体成员");
              break;
            }
            if (elem.attrs.type === "here") {
              userContent.push("@在线成员");
              break;
            }
            userContent.push(h.at(elem.attrs.id, {
              name: await getMemberName(config, session, elem.attrs.id, chatMessage.channelId)
            }));
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
      // [messageId][{date} from_channel:{channelId} sender_id:{senderId}] "{senderName}" 说: {userContent}
      // [messageId][{date} from_qq:{senderId}] "{senderName}" 说: {userContent}
      // [messageId][{date} from_channel:{channelId} sender_id:{senderId}] "{senderName}" 回复({quoteMessageId}): {userContent}
      processedMessage.push(`[${chatMessage.messageId}]${messagePrefix} ${chatMessage.quoteMessageId ? `回复(${chatMessage.quoteMessageId}):` : "说:"} ${userContent.join("")}`);
  }

  return processedMessage.join("\n");
}
