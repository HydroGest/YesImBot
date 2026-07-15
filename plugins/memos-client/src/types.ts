import type { ChannelScope } from "koishi-plugin-yesimbot";

export type MemosChannelType = "private" | "group";
export type MemosMemoryScope = "auto" | "channel" | "user";
export type ResolvedMemosMemoryScope = Exclude<MemosMemoryScope, "auto">;
export type MemosSearchFilterMode = "off" | "context" | "strict";
export type MemosConversationKind = "runtime_turn" | "qq_import";

export interface MemosSearchFilter {
  and?: Array<Record<string, unknown>>;
  or?: Array<Record<string, unknown>>;
}

export interface MemosClientConfig {
  baseUrl: string;
  apiKey: string;
  memoryScope: MemosMemoryScope;
  timeoutMs: number;
  searchMemoryLimit: number;
  searchPreferenceLimit: number;
  searchRelativity: number;
  includePreference: boolean;
  searchFilterMode: MemosSearchFilterMode;
  searchTags: string[];
  searchImportSources: string[];
  asyncMode: boolean;
  tags: string[];
  includeRawIdentityInfo: boolean;
  enableDebugTools: boolean;
}

export interface MemosIdentityInput {
  channelScope: ChannelScope;
  channelType: MemosChannelType;
  authorId: string;
  messageId?: string;
  turnId: string;
  memoryScope?: MemosMemoryScope;
  includeRawIdentityInfo?: boolean;
}

export interface MemosImportChunkIdentityInput {
  channelScope: ChannelScope;
  channelType: MemosChannelType;
  chunkStartIso: string;
  chunkEndIso: string;
  firstMessageId: string;
  lastMessageId: string;
  chunkIndex: number;
  includeRawIdentityInfo?: boolean;
}

export interface MemosIdentityInfo {
  scene: "group_chat" | "private_chat";
  platform: string;
  channel_type: MemosChannelType;
  channel_hash: string;
  subject_hash: string;
  author_hash?: string;
  message_hash?: string;
  turn_id: string;
  memory_scope: ResolvedMemosMemoryScope;
  conversation_kind: MemosConversationKind;
  chunk_id?: string;
  raw_channel_id?: string;
  raw_author_id?: string;
  raw_self_id?: string;
  raw_message_id?: string;
}

export interface MemosIdentity {
  userId: string;
  conversationId: string;
  agentId: string;
  info: MemosIdentityInfo;
}

export interface MemosApiResponse<TData = unknown> {
  code: number;
  data?: TData;
  message?: string;
}

export interface MemosMessage {
  role: string;
  content: string;
  chat_time?: string;
}

export interface MemosSearchMemoryRequest {
  user_id: string;
  query: string;
  conversation_id?: string;
  filter?: MemosSearchFilter;
  relativity?: number;
  memory_limit_number?: number;
  include_preference?: boolean;
  preference_limit_number?: number;
}

export interface MemosAddMessageRequest {
  user_id: string;
  conversation_id: string;
  messages: MemosMessage[];
  agent_id?: string;
  tags?: string[];
  info?: Record<string, unknown>;
  async_mode?: boolean;
  source?: string;
}
