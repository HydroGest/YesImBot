import { createHash } from "node:crypto";

import type {
  MemosChannelType,
  MemosImportChunkIdentityInput,
  MemosIdentity,
  MemosIdentityInfo,
  MemosIdentityInput,
  ResolvedMemosMemoryScope,
} from "./types.js";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

function legacyChannelHash(input: { readonly channelScope: MemosIdentityInput["channelScope"] }): string {
  const scope = input.channelScope;
  const canonical = scope.isDirect
    ? ["yesimbot.channel", 1, "direct", scope.platform, scope.selfId, scope.channelId]
    : ["yesimbot.channel", 1, "shared", scope.platform, null, scope.channelId];
  const bytes = createHash("sha256").update(JSON.stringify(canonical), "utf8").digest().subarray(0, 16);
  let buffer = 0;
  let bits = 0;
  let output = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32[(buffer >>> bits) & 31];
    }
  }
  if (bits > 0) output += BASE32[(buffer << (5 - bits)) & 31];
  return output;
}

function hashMemosIdParts(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("base64url").slice(0, 22);
}

function resolveMemoryScope(input: MemosIdentityInput): ResolvedMemosMemoryScope {
  if (input.memoryScope === "channel" || input.memoryScope === "user") {
    return input.memoryScope;
  }

  return input.channelType === "group" ? "channel" : "user";
}

function sceneForChannelType(channelType: MemosChannelType): MemosIdentityInfo["scene"] {
  return channelType === "group" ? "group_chat" : "private_chat";
}

function deriveSubjectHash(
  platform: string,
  channelType: MemosChannelType,
  subjectRawId: string,
): string {
  return hashMemosIdParts(["memos-subject-v1", platform, channelType, subjectRawId]);
}

function deriveAgentHash(platform: string, selfId: string): string {
  return hashMemosIdParts(["memos-agent-v1", platform, selfId]);
}

function deriveRuntimeConversationHash(input: MemosIdentityInput, subjectRawId: string): string {
  return hashMemosIdParts([
    "memos-conversation-v1",
    "runtime_turn",
    input.channelScope.platform,
    input.channelType,
    subjectRawId,
    input.turnId,
  ]);
}

function deriveImportChunkConversationHash(input: MemosImportChunkIdentityInput): string {
  const subjectRawId = input.channelScope.channelId;
  return hashMemosIdParts([
    "memos-conversation-v1",
    "qq_import",
    input.channelScope.platform,
    input.channelType,
    subjectRawId,
    input.chunkStartIso,
    input.chunkEndIso,
    input.firstMessageId,
    input.lastMessageId,
    input.chunkIndex,
  ]);
}

export function deriveMemosIdentity(input: MemosIdentityInput): MemosIdentity {
  const channelScopeId = legacyChannelHash(input);
  const subjectRawId = input.channelScope.channelId;
  const subjectHash = deriveSubjectHash(
    input.channelScope.platform,
    input.channelType,
    subjectRawId,
  );
  const agentHash = deriveAgentHash(input.channelScope.platform, input.channelScope.selfId);
  const authorHash = hashMemosIdParts([
    "memos-author-v1",
    input.channelScope.platform,
    input.authorId,
  ]);
  const messageHash = input.messageId
    ? hashMemosIdParts(["memos-message-v1", input.channelScope.platform, input.messageId])
    : undefined;
  const memoryScope = resolveMemoryScope(input);

  const info: MemosIdentityInfo = {
    scene: sceneForChannelType(input.channelType),
    platform: input.channelScope.platform,
    channel_type: input.channelType,
    channel_hash: channelScopeId,
    subject_hash: subjectHash,
    author_hash: authorHash,
    turn_id: input.turnId,
    memory_scope: memoryScope,
    conversation_kind: "runtime_turn",
    ...(messageHash ? { message_hash: messageHash } : {}),
  };

  if (input.includeRawIdentityInfo) {
    info.raw_channel_id = input.channelScope.channelId;
    info.raw_author_id = input.authorId;
    info.raw_self_id = input.channelScope.selfId;
    if (input.messageId) {
      info.raw_message_id = input.messageId;
    }
  }

  return {
    userId: `yb_subject_${subjectHash}`,
    conversationId: `yb_conv_${deriveRuntimeConversationHash(input, subjectRawId)}`,
    agentId: `yb_agent_${agentHash}`,
    info,
  };
}

export function deriveMemosImportChunkIdentity(
  input: MemosImportChunkIdentityInput,
): MemosIdentity {
  const channelScopeId = legacyChannelHash(input);
  const subjectRawId = input.channelScope.channelId;
  const subjectHash = deriveSubjectHash(
    input.channelScope.platform,
    input.channelType,
    subjectRawId,
  );
  const conversationHash = deriveImportChunkConversationHash(input);
  const memoryScope: ResolvedMemosMemoryScope = input.channelType === "group" ? "channel" : "user";
  const info: MemosIdentityInfo = {
    scene: sceneForChannelType(input.channelType),
    platform: input.channelScope.platform,
    channel_type: input.channelType,
    channel_hash: channelScopeId,
    subject_hash: subjectHash,
    turn_id: "qq-import",
    memory_scope: memoryScope,
    conversation_kind: "qq_import",
    chunk_id: `qq_import_${conversationHash}`,
  };

  if (input.includeRawIdentityInfo) {
    info.raw_channel_id = input.channelScope.channelId;
    info.raw_self_id = input.channelScope.selfId;
  }

  return {
    userId: `yb_subject_${subjectHash}`,
    conversationId: `yb_conv_${conversationHash}`,
    agentId: `yb_agent_${deriveAgentHash(input.channelScope.platform, input.channelScope.selfId)}`,
    info,
  };
}
