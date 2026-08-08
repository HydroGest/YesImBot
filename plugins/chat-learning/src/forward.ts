import type { Session } from "koishi";

const MAX_FORWARD_NODES = 50;
const MAX_NODE_CHARS = 1500;

interface OneBotForwardInternal {
  sendGroupForwardMsg?(groupId: string | number, messages: readonly OneBotForwardNode[]): Promise<unknown>;
  sendPrivateForwardMsg?(userId: string | number, messages: readonly OneBotForwardNode[]): Promise<unknown>;
}

interface OneBotForwardNode {
  readonly type: "node";
  readonly data: {
    readonly name: string;
    readonly uin: string;
    readonly content: readonly { readonly type: "text"; readonly data: { readonly text: string } }[];
    readonly time: string;
  };
}

export async function sendChatLearningForward(session: Session, text: string): Promise<boolean> {
  const internal = (session.bot as unknown as { internal?: OneBotForwardInternal } | undefined)?.internal;
  if (!internal || !session.channelId || !session.selfId) return false;

  const nodes = createForwardNodes(session.selfId, text);
  if (nodes.length === 0) return false;

  const channelId = session.isDirect ? stripPrivatePrefix(session.channelId) : session.channelId;
  if (session.isDirect) {
    if (typeof internal.sendPrivateForwardMsg !== "function") return false;
    await internal.sendPrivateForwardMsg(channelId, nodes);
  } else {
    if (typeof internal.sendGroupForwardMsg !== "function") return false;
    await internal.sendGroupForwardMsg(channelId, nodes);
  }
  return true;
}

function createForwardNodes(selfId: string, text: string): readonly OneBotForwardNode[] {
  const chunks = chunkText(text);
  const time = String(Math.floor(Date.now() / 1000));
  return chunks.map((content) => ({
    type: "node" as const,
    data: {
      name: "chat-learning",
      uin: selfId,
      content: [{ type: "text" as const, data: { text: content } }],
      time,
    },
  }));
}

function chunkText(text: string): readonly string[] {
  const lines = text.split("\n");
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const candidate = current.length === 0 ? line : `${current}\n${line}`;
    if (candidate.length > MAX_NODE_CHARS && current.length > 0) {
      chunks.push(current);
      current = line;
      if (chunks.length === MAX_FORWARD_NODES) break;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0 && chunks.length < MAX_FORWARD_NODES) chunks.push(current);
  if (chunks.length >= MAX_FORWARD_NODES) {
    const last = chunks.at(-1);
    if (last && last.length > 0) chunks[chunks.length - 1] = `${last}\n...[已截断]`;
  }
  return chunks;
}

function stripPrivatePrefix(channelId: string): string {
  return channelId.startsWith("private:") ? channelId.slice("private:".length) : channelId;
}
