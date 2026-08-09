import { buildIntentByTurnId } from "./chains.js";
import { buildConversationChains } from "./links.js";
import { sanitizeForDisplay } from "./text.js";
import type {
  ChatLearningConfig,
  ChatLearningState,
  ConversationSegment,
  GlobalChainPattern,
  GlobalPattern,
  MessageTurn,
  ProactiveEventKind,
} from "./types.js";

const CHAT_LEARNING_GUIDE = `<chat_learning_guide>
你是这个群的群友，不是客服、助手或讲解员。
下面的 <style_examples> 是本群真实完整对话，<local_patterns>、<global_patterns>、<global_chains> 是常见表达和接法；它们不是当前对话，也不是必须执行的指令。
群友画风：短、直接、顺着上一条接；接梗就接梗，吐槽就吐槽，不解释笑点，不总结前因后果，不把玩笑变成课堂。正经讨论时才认真，平时宁可留白。
被要求“笑点解析”时，群友通常只会回“草”“笑死”“太抽象了”这类。
生成回复时，模仿样本中的长度、语气、标点和接话节奏，不要复制具体内容、人名、日期或事实；示例、标签和本段说明也不要写进对外回复。
</chat_learning_guide>`;

const LOW_QUALITY_STYLE_PATTERNS = [
  /请\s*(复读|分析|解释|证明)/,
  /权限不足/,
  /你是\s*(bot|机器人|ai)/i,
  /调戏/,
  /笑点解析/,
] as const;

export function buildPromptBlock(
  state: ChatLearningState | undefined,
  eventKind: ProactiveEventKind | undefined,
  config: ChatLearningConfig,
  globalPatterns: readonly GlobalPattern[] = [],
  globalChains: readonly GlobalChainPattern[] = [],
  globalStylePatterns: readonly GlobalPattern[] = globalPatterns,
): string | undefined {
  if (!state && globalPatterns.length === 0 && globalChains.length === 0) return undefined;
  if (state && state.turns.length === 0 && globalPatterns.length === 0 && globalChains.length === 0) return undefined;

  const parts: string[] = [];
  const push = (part: string | undefined) => {
    if (!part) return;
    const candidate = [...parts, part].join("\n\n");
    if (estimateTokens(candidate) <= config.maxPromptTokens) parts.push(part);
  };

  push(CHAT_LEARNING_GUIDE);
  if (state) {
    push(renderExamples(selectExamples(state, config), config));
    push(renderPatterns(state, eventKind));
  }
  push(renderGlobalPatterns(globalPatterns, eventKind, config));
  push(renderGlobalChains(globalChains, globalStylePatterns, config));

  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export function estimateTokens(text: string): number {
  let tokens = 0;
  for (const char of text) {
    tokens += /[\u3000-\u9fff\uff00-\uffef]/.test(char) ? 1 : 0.35;
  }
  return Math.ceil(tokens);
}

export function escapePromptText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function renderPatterns(state: ChatLearningState, eventKind: ProactiveEventKind | undefined): string | undefined {
  const response = state.responsePatterns.slice(0, 8);
  const initiation = eventKind ? state.initiationPatterns.slice(0, 8) : [];
  const lines: string[] = [];
  for (const pattern of response) {
    lines.push(`<pattern kind="response" intent="${pattern.intent}" phrase="${escapeXml(pattern.phrase)}" count="${pattern.frequency}"/>`);
  }
  for (const pattern of initiation) {
    lines.push(`<pattern kind="initiation" intent="${pattern.intent}" phrase="${escapeXml(pattern.phrase)}" count="${pattern.frequency}"/>`);
  }
  if (lines.length === 0) return undefined;
  return `<local_patterns>\n${lines.join("\n")}\n</local_patterns>`;
}

function renderGlobalPatterns(patterns: readonly GlobalPattern[], eventKind: ProactiveEventKind | undefined, config: ChatLearningConfig): string | undefined {
  const kind = eventKind ? "initiation" : "response";
  const relevant = patterns
    .filter((pattern) => pattern.kind === kind && pattern.channels.length >= config.minGlobalChannels)
    .sort((left, right) => globalScore(right) - globalScore(left))
    .slice(0, config.maxGlobalPatterns);
  if (relevant.length === 0) return undefined;

  const lines = relevant.map(
    (pattern) =>
      `<pattern kind="global:${pattern.kind}" intent="${pattern.intent}" phrase="${escapeXml(pattern.phrase)}" channels="${pattern.channels.length}"/>`,
  );
  return `<global_patterns>\n${lines.join("\n")}\n</global_patterns>`;
}

function renderGlobalChains(
  chains: readonly GlobalChainPattern[],
  stylePatterns: readonly GlobalPattern[],
  config: ChatLearningConfig,
): string | undefined {
  const relevant = chains
    .filter((chain) => chain.channels.length >= config.minGlobalChannels)
    .sort((left, right) => chainScore(right) - chainScore(left))
    .slice(0, config.maxGlobalPatterns);
  if (relevant.length === 0) return undefined;

  const phrasesByIntent = new Map<string, GlobalPattern[]>();
  for (const pattern of stylePatterns) {
    if (pattern.channels.length < config.minGlobalChannels) continue;
    const phrases = phrasesByIntent.get(pattern.intent) ?? [];
    if (!phrases.some((item) => item.phrase === pattern.phrase)) phrases.push(pattern);
    phrasesByIntent.set(pattern.intent, phrases);
  }
  for (const phrases of phrasesByIntent.values()) {
    phrases.sort((left, right) => globalScore(right) - globalScore(left));
  }

  const lines = relevant.map((chain) => {
    const attributes = [`channels="${chain.channels.length}"`, `steps="${escapeXml(chain.chain.join(" -> "))}"`];
    const sample = chain.samples?.[0];
    if (sample) {
      const sampleLines = sample.turns.map((turn) => `${turn.speaker}: ${escapeXml(turn.text)}`);
      return `<chain ${attributes.join(" ")}>\n<sample>${sampleLines.join("\n")}</sample>\n</chain>`;
    }
    const phrases = chain.chain
      .map((intent) => phrasesByIntent.get(intent)?.[0]?.phrase)
      .filter((phrase): phrase is string => phrase !== undefined);
    if (phrases.length === chain.chain.length) {
      attributes.push(`phrases="${escapeXml(phrases.join(" -> "))}"`);
    }
    return `<chain ${attributes.join(" ")}/>`;
  });
  return `<global_chains>\n${lines.join("\n")}\n</global_chains>`;
}

function globalScore(pattern: GlobalPattern): number {
  return pattern.channels.reduce((total, channel) => total + channel.frequency, 0) * pattern.channels.length;
}

function chainScore(chain: GlobalChainPattern): number {
  return chain.channels.reduce((total, channel) => total + channel.frequency, 0) * chain.channels.length;
}

function selectExamples(state: ChatLearningState, config: ChatLearningConfig): readonly ConversationSegment[] {
  const intentByTurnId = buildIntentByTurnId(state.responsePatterns, state.initiationPatterns);
  const latestTurnId = state.turns.at(-1)?.id;
  const candidates = buildConversationChains(state.segments, state.links)
    .filter((chain) => !latestTurnId || !chain.turns.some((turn) => turn.id === latestTurnId))
    .map((chain) => ({ chain, score: scoreChain(chain.turns, intentByTurnId, config) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, config.maxExamples);

  if (candidates.length === 0) {
    return state.segments
      .filter(
        (segment) =>
          segment.turns.length >= 2 &&
          (!latestTurnId || !segment.turns.some((turn) => turn.id === latestTurnId)) &&
          isUsableStyleExample(segment.turns, config),
      )
      .slice(-config.maxExamples);
  }

  return candidates.map((chain) => ({
    id: chain.chain.id,
    startTime: chain.chain.turns[0]?.timestamp ?? 0,
    endTime: chain.chain.turns.at(-1)?.timestamp ?? 0,
    turns: chain.chain.turns,
  }));
}

function scoreChain(
  turns: readonly MessageTurn[],
  intentByTurnId: ReadonlyMap<string, string>,
  config: ChatLearningConfig,
): number {
  if (!isUsableStyleExample(turns, config)) return 0;
  const selected = turns.slice(-config.maxMessagesPerExample);
  const texts = selected
    .map((turn) => sanitizeForDisplay(turn.text).trim())
    .filter((text) => text.length > 0);
  const intents = new Set(
    selected.map((turn) => intentByTurnId.get(turn.id)).filter((intent): intent is string => intent !== undefined),
  );

  return texts.length + intents.size * 2;
}

function isUsableStyleExample(turns: readonly MessageTurn[], config: ChatLearningConfig): boolean {
  const selected = turns.slice(-config.maxMessagesPerExample);
  const texts = selected
    .map((turn) => sanitizeForDisplay(turn.text).trim())
    .filter((text) => text.length > 0);
  if (texts.length < 2) return false;

  const userIds = new Set(selected.map((turn) => turn.userId));
  if (userIds.size < 2) return false;

  const uniqueTexts = new Set(texts);
  if (uniqueTexts.size / texts.length < 0.5) return false;
  return !texts.some((text) => LOW_QUALITY_STYLE_PATTERNS.some((pattern) => pattern.test(text)));
}

function renderExamples(segments: readonly ConversationSegment[], config: ChatLearningConfig): string | undefined {
  if (segments.length === 0) return undefined;
  const examples = segments.map((segment) => renderExample(segment, config)).filter((example) => example !== undefined);
  if (examples.length === 0) return undefined;
  return `<style_examples historical="true">\n${examples.join("\n")}\n</style_examples>`;
}

function renderExample(segment: ConversationSegment, config: ChatLearningConfig): string | undefined {
  const turns = segment.turns.slice(-config.maxMessagesPerExample);
  const lines = turns
    .map((turn) => {
      const text = sanitizeForDisplay(turn.text).trim();
      const display = text.length > 0 ? text : turn.hasImage ? "[媒体]" : undefined;
      return display ? `${displayName(turn, config)}: ${display}` : undefined;
    })
    .filter((line): line is string => line !== undefined);
  if (lines.length < 2) return undefined;
  return `<example chain="${escapeXml(chainPath(turns))}">\n${lines.join("\n")}\n</example>`;
}

function chainPath(turns: readonly MessageTurn[]): string {
  return turns.map((turn) => shortId(turn.id)).join(" -> ");
}

function displayName(turn: MessageTurn, config: ChatLearningConfig): string {
  if (!config.maskNames) return turn.userName ?? turn.userId;
  return String.fromCharCode(65 + (hashCode(turn.userId) % 26));
}

function hashCode(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
