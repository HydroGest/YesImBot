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
  readonly summaryModel: string | undefined;
}

export type ProactiveEventKind = "global-brain" | "schedule" | "chat-learning";
