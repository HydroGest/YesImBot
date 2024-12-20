import { Context } from "koishi";

import { DATABASE_NAME } from "..";
import { ChatMessage } from "../models/ChatMessage";

declare module "koishi" {
  interface Tables {
    [DATABASE_NAME]: ChatMessage;
  }
}

export function initDatabase(ctx: Context) {
  ctx.model.extend(DATABASE_NAME, {
      senderId: "string",
      senderName: "string",
      senderNick: "string",
      messageId: "string",
      channelId: "string",
      channelType: "integer",
      sendTime: "timestamp",
      content: "string",
      quoteMessageId: "string",
      raw: {
        type: "string",
        nullable: true,
        initial: null,
      },
    }, {
      primary: "messageId", // 主键名
      autoInc: false,       // 不使用自增主键
    }
  );
}
