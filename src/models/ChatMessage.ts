import { Session } from "koishi";

import {} from "koishi-plugin-adapter-onebot";

export interface ChatMessage {
    senderId: string;    // 发送者平台 id
    senderName: string;  // 发送者原始昵称
    senderNick: string;  // 发送者会话昵称

    messageId: string;   // 消息 id

    channelId: string;   //
    channelType: string; // 消息类型

    sendTime: Date;      // 发送时间
    content: string;     // 消息内容
}

export async function createMessage(session: Session): Promise<ChatMessage> {
    const channelType = session.channelId.startsWith("private:") ? "private" : (session.channelId === "#" ? "sandbox" : "guild");
    let senderNick = session.author.name;
    if (channelType === "guild") {
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
        content: session.content
    };
}