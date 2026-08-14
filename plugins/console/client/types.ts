export interface ConversationRequest {
  channel: string;
  session: string;
}

export interface ConversationSessionSummary {
  filename: string;
  isActive: boolean;
  size: number;
  createdAt: string;
  lastActivityAt: number;
}

export interface ConversationChannelSummary {
  key: string;
  type: "channel" | "guild" | "direct";
  platform: string;
  channelId: string;
  guildId?: string;
  userId?: string;
  selfId?: string;
  createdAt: string;
  activeSession: string | null;
  sessions: ConversationSessionSummary[];
  totalSizeBytes: number;
  lastActivityAt: number | null;
  will: ConversationChannelWill;
}

export interface ConversationChannelWill {
  matched: ConversationWillPolicy | null;
  candidates: ConversationWillPolicy[];
}

export interface ConversationIndex {
  generatedAt: string;
  channels: ConversationChannelSummary[];
  totalChannels: number;
  totalSessions: number;
  totalSizeBytes: number;
  will: ConversationWillSummary;
}

export interface ConversationWillPolicy {
  id: string;
  enabled: boolean;
  engine: "routing" | "willingness";
  priority?: number;
  config?: Record<string, unknown>;
}

export interface ConversationWillSummary {
  installed: boolean;
  defaultLabel: string;
  policies: ConversationWillPolicy[];
}

export interface ConversationEntryView {
  id: string;
  timestamp: number;
  kind: "user" | "assistant" | "thought" | "tool-call" | "tool-result" | "compact" | "event" | "will";
  text?: string;
  sender?: string;
  messageId?: string;
  toolName?: string;
  toolCallId?: string;
  args?: unknown;
  result?: unknown;
  error?: { name?: string; message?: string };
  assets?: ConversationAssetView[];
  usage?: unknown;
  finishReason?: string;
  turnId?: string;
  eventType?: string;
  decision?: string;
  willDebug?: unknown;
  groupKey?: string;
  sourceSession?: string;
}

export interface ConversationAssetView {
  id: string;
  kind: "image" | "file";
  title?: string;
  size: number;
  dataUrl?: string;
}

export interface ConversationDetail {
  channel: string;
  session: string;
  entries: ConversationEntryView[];
  truncated: boolean;
  summary: {
    messageCount: number;
    thoughtCount: number;
    toolCallCount: number;
    errorCount: number;
    sizeBytes: number;
  };
}
