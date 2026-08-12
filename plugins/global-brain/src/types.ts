import type { Universal } from "koishi";
import type { ChannelContext, EventRecord } from "koishi-plugin-yesimbot";
const DIRECT_CHANNEL_TYPE = 1 satisfies Universal.Channel.Type;
const TEXT_CHANNEL_TYPE = 0 satisfies Universal.Channel.Type;
export type BrainPostKind = "share" | "question" | "insight";

export type BrainReplySource = "agent" | "human";

export type BrainStatus = "open" | "resolved";

export type BrainContent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "asset"; readonly blobId: string; readonly mediaType?: string; readonly filename?: string }
  | { readonly kind: "artifact"; readonly blobId: string; readonly mediaType?: string; readonly filename?: string }
  | { readonly kind: "forward"; readonly platform: string; readonly forwardId: string; readonly summary?: string };

export interface BrainThread {
  readonly id: string;
  readonly kind: BrainPostKind;
  readonly sourceScope: ChannelContext;
  readonly content: string;
  readonly payload?: BrainContent;
  readonly tags: readonly string[];
  readonly status: BrainStatus;
  readonly createdAt: number;
  readonly resolvedAt?: number;
}

export interface BrainReply {
  readonly id: string;
  readonly threadId: string;
  readonly sourceScope: ChannelContext;
  readonly replySource: BrainReplySource;
  readonly author?: { readonly id: string; readonly name?: string };
  readonly content: string;
  readonly createdAt: number;
}

export interface BrainThreadView {
  readonly thread: BrainThread;
  readonly replies: readonly BrainReply[];
  readonly localAssetUri?: string;
  readonly localForward?: { readonly forwardId: string; readonly sendTool: string };
}

export interface BrainImmediateShare {
  readonly id: string;
  readonly kind: BrainPostKind;
  readonly content: string;
  readonly tags: readonly string[];
}

export interface BrainDigest {
  readonly threads: readonly BrainThread[];
  readonly replies: readonly BrainThreadView[];
}

export interface BrainThreadStatus {
  readonly thread: BrainThread;
  readonly replyCount: number;
}

export interface GlobalBrainConfig {
  readonly storageDir?: string;
  readonly brainPrompt?: string;
  readonly shareImmediately?: boolean;
  readonly maxDigestThreads: number;
  readonly maxDigestReplies: number;
  readonly maxDigestContentLength: number;
  readonly maxBlobBytes: number;
}
declare module "koishi-plugin-yesimbot" {
  interface EventMap {
    "global-brain.immediate": { thread: BrainImmediateShare };
  }
}
export function buildImmediateShareEvent(scope: ChannelContext, selfId: string, thread: BrainThread): EventRecord<"global-brain.immediate"> {
  const summary = thread.content.length > 160 ? `${thread.content.slice(0, 160)}...` : thread.content;
  return {
    eventType: "global-brain.immediate",
    platform: scope.platform,
    selfId,
    timestamp: Date.now(),
    channel: { id: scope.channelId, type: scope.type === "direct" ? DIRECT_CHANNEL_TYPE : TEXT_CHANNEL_TYPE },
    text: `Global brain immediate share [${thread.kind}] ${thread.id}: ${summary}`,
    thread: { id: thread.id, kind: thread.kind, content: thread.content, tags: [...thread.tags] },
  };
}

export function scopeKey(scope: ChannelContext): string {
  if (scope.type === "direct") return `direct:${scope.platform}:${scope.selfId}:${scope.channelId}`;
  // guild and channel use the same key as the old "shared" type for JSONL backward compat
  return `shared:${scope.platform}:${scope.channelId}`;
}
