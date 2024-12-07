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
      let messagePrefix = `[${timeString} ${chatMessage.channelType === "guild" ? `from:${chatMessage.channelId}` : `from:dm`}]`;
      let userName: string;
      switch (config.Bot.NickorName) {
        case "群昵称":
          userName = chatMessage.senderNick;
        case "用户昵称":
        default:
          userName = chatMessage.senderName;
      }
      messagePrefix += `\n${userName}(${chatMessage.senderId}): `;
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
            userContent.push(`@${await getMemberName(config, session, elem.attrs.id, chatMessage.channelId)}`);
            break;
          case "quote":
            // const { id } = elem.attrs;
            userContent.unshift(`${h.quote(elem.attrs.id)}`); // 保证历史消息中同一个消息元素的呈现方式是一致的
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
      // [msgId:{messageId}][{date} from:{channelId}]\n{senderName}: {userContent}
      // [msgId:{messageId}][{date} from:dm]\n{senderName}: {userContent}
      // [msgId:{messageId}][{date} from:{channelId}]\n{senderName}: <quote id="{quoteMessageId}"/>{userContent}
      processedMessage.push(`[msgId:${chatMessage.messageId}]${messagePrefix}${chatMessage.quoteMessageId ? `${h.quote(chatMessage.quoteMessageId)}` : ""}${userContent.join("")}`);
  }

  return processedMessage.join("\n");
}
