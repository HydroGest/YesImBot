export type LinkKind = "quote" | "reply" | "at" | "adjacent" | "entity";

export interface MessageTurn {
  readonly id: string;
  readonly messageId: string;
  readonly userId: string;
  readonly userName: string | undefined;
  readonly timestamp: number;
  readonly text: string;
  readonly elementKinds: readonly string[];
  readonly hasImage: boolean;
  readonly quoteId: string | undefined;
  readonly quoteType: "quote" | "reply" | undefined;
  readonly mentionIds: readonly string[];
}

export interface MessageLink {
  readonly from: string;
  readonly to: string | null;
  readonly kind: LinkKind;
  readonly confidence: number;
  readonly evidence: readonly string[];
}

export type LinkCorrectionAction = "add" | "remove";

export interface LinkCorrection {
  readonly id: string;
  readonly action: LinkCorrectionAction;
  readonly from: string;
  readonly to: string | null;
  readonly kind: LinkKind | "*";
  readonly confidence: number;
  readonly createdAt: number;
  readonly note: string | undefined;
}

export interface ConversationSegment {
  readonly id: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly turns: readonly MessageTurn[];
}

export type ResponseIntent = "ack" | "agree" | "question" | "joke" | "roast" | "empathy" | "refuse";
export type InitiationIntent = "share" | "question" | "react" | "recall" | "opinion";

export interface ResponsePattern {
  readonly intent: ResponseIntent;
  readonly phrase: string;
  readonly frequency: number;
  readonly sampleIds: readonly string[];
}

export interface InitiationPattern {
  readonly intent: InitiationIntent;
  readonly phrase: string;
  readonly frequency: number;
  readonly sampleIds: readonly string[];
}

export interface LocalChainPattern {
  readonly chain: readonly string[];
  readonly frequency: number;
}

export type GlobalPatternKind = "response" | "initiation";

export interface GlobalChannelStat {
  readonly key: string;
  readonly frequency: number;
  readonly lastSeenAt: number;
}

export interface GlobalPattern {
  readonly kind: GlobalPatternKind;
  readonly intent: string;
  readonly phrase: string;
  readonly channels: readonly GlobalChannelStat[];
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  readonly embedding?: readonly number[];
}

export interface GlobalChainPattern {
  readonly chain: readonly string[];
  readonly channels: readonly GlobalChannelStat[];
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
}

export interface GlobalRuleBank {
  readonly version: number;
  readonly updatedAt: number;
  readonly patterns: readonly GlobalPattern[];
  readonly chains: readonly GlobalChainPattern[];
}

export interface ChatLearningState {
  readonly lastEntryId: string | undefined;
  readonly builtAt: number;
  readonly turns: readonly MessageTurn[];
  readonly links: readonly MessageLink[];
  readonly segments: readonly ConversationSegment[];
  readonly responsePatterns: readonly ResponsePattern[];
  readonly initiationPatterns: readonly InitiationPattern[];
}

export interface ChatLearningConfig {
  readonly maxExamples: number;
  readonly maxMessagesPerExample: number;
  readonly maxHistoryAgeDays: number;
  readonly maxScanMessages: number;
  readonly refreshIntervalMinutes: number;
  readonly maxPromptTokens: number;
  readonly maskNames: boolean;
  readonly blockedUserIds: string[];
  readonly blockedUserPatterns: string[];
  readonly autoBlockBotNames: boolean;
  readonly observeAllChannels: boolean;
  readonly globalRulePath: string | undefined;
  readonly globalSyncIntervalMinutes: number;
  readonly minGlobalChannels: number;
  readonly maxGlobalPatterns: number;
  readonly summaryModel: string | undefined;
  readonly embeddingModel: string | undefined;
  readonly embeddingSimilarity: number;
  readonly maxModelThreads: number;
  readonly maxModelThreadMessages: number;
  readonly reflectionModel: string | undefined;
  readonly maxReflectionMessages: number;
  readonly reflectionIntervalMinutes: number;
}

export type ProactiveEventKind = "global-brain" | "schedule" | "chat-learning";
