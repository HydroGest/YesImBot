import type { ChannelScope } from "koishi-plugin-yesimbot";

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
  readonly sourceScope: ChannelScope;
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
  readonly sourceScope: ChannelScope;
  readonly replySource: BrainReplySource;
  readonly author?: {
    readonly id: string;
    readonly name?: string;
  };
  readonly content: string;
  readonly createdAt: number;
}

export interface BrainThreadView {
  readonly thread: BrainThread;
  readonly replies: readonly BrainReply[];
  readonly localAssetUri?: string;
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
  readonly maxDigestThreads: number;
  readonly maxDigestReplies: number;
  readonly maxDigestContentLength: number;
  readonly maxBlobBytes: number;
}

export function scopeKey(scope: ChannelScope): string {
  return `${scope.type}:${scope.platform}:${scope.selfId}:${scope.channelId}`;
}
