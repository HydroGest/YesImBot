import type { LanguageModel } from "ai";

export interface CompactPluginOptions {
  model?: LanguageModel;
  threshold?: number;
  charTokenRatio?: number;
  minMessages?: number;
  maxFailures?: number;
  contextLength?: number;
  persona: () => Promise<{ name: string; content: string }>;
  logger: { warn(event: string, fields?: Record<string, unknown>): void };
  onCompact?(compact: () => Promise<void>): void;
  onCompactStatus?(getFailures: () => number): void;
  scheduleAppend?(append: () => Promise<void>): Promise<void>;
}
