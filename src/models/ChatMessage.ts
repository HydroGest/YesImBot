import { Session } from "koishi";

import {} from "koishi-plugin-adapter-onebot";

export enum ChannelType {
  Guild,
  Private,
  Sandbox
}

export interface ChatMessage {
    senderId: string;    // 发送者平台 ID
    senderName: string;  // 发送者原始昵称
    senderNick: string;  // 发送者会话昵称

    messageId: string;   // 消息 ID

    channelId: string;   // 消息来源 ID
    channelType: ChannelType; // 消息类型

    sendTime: Date;      // 发送时间
    content: string;     // 消息内容

    quoteMessageId?: string; // 被引用消息

    raw?: string;        // 原始消息，可能是LLM输出或者客户端上报数据
}

export async function createMessage(session: Session, content?: string): Promise<ChatMessage> {
    const channelType = session.channelId.startsWith("private:") ? ChannelType.Private : (session.channelId === "#" ? ChannelType.Sandbox : ChannelType.Guild);
    let senderNick = session.author.name;
    if (channelType === ChannelType.Guild) {
        if (session.onebot) {
            const memberInfo = await session.onebot.getGroupMemberInfo(session.channelId, session.userId);
            senderNick = memberInfo.card || memberInfo.nickname;
        }
    };
    return {
        senderId: session.userId,
        senderName: session.author.name,
        senderNick,
        messageId: session.messageId,
        channelId: session.channelId,
        channelType,
        sendTime: new Date(session.event.timestamp),
        content: session.content || content,
        quoteMessageId: session.quote?.id
    };
}
