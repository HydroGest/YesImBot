import type {
  ChatLearningConfig,
  ChatLearningState,
  ConversationSegment,
  MessageLink,
  MessageTurn,
  ProactiveEventKind,
} from "./types.js";

export function buildPromptBlock(
  state: ChatLearningState | undefined,
  eventKind: ProactiveEventKind | undefined,
  config: ChatLearningConfig,
): string | undefined {
  if (!state || state.turns.length === 0) return undefined;

  const parts: string[] = [];
  const push = (part: string | undefined) => {
    if (!part) return;
    const candidate = [...parts, part].join("\n\n");
    if (estimateTokens(candidate) <= config.maxPromptTokens) parts.push(part);
  };

  push(renderEventContext(eventKind));
  push(renderLinks(state.links, state.turns.slice(-config.maxMessagesPerExample * 4)));
  push(renderActiveChain(state.turns.slice(-config.maxMessagesPerExample * 4), config));
  push(renderPatterns(state, eventKind));
  push(renderExamples(selectExamples(state.segments, config), config));

  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export function estimateTokens(text: string): number {
  let tokens = 0;
  for (const char of text) {
    tokens += /[\u3000-\u9fff\uff00-\uffef]/.test(char) ? 1 : 0.35;
  }
  return Math.ceil(tokens);
}

function renderEventContext(eventKind: ProactiveEventKind | undefined): string | undefined {
  if (!eventKind) return undefined;
  return `<event_context>\nproactive=${eventKind}\n</event_context>`;
}

function renderLinks(links: readonly MessageLink[], recentTurns: readonly MessageTurn[]): string | undefined {
  const ids = new Set(recentTurns.map((turn) => turn.id));
  const labels = new Map<string, string>();
  recentTurns.forEach((turn, index) => labels.set(turn.id, `m${index + 1}`));
  const visible = links
    .filter((link) => ids.has(link.from) && (link.to === null || ids.has(link.to)))
    .filter((link) => link.kind === "quote" || link.kind === "reply" || link.kind === "at")
    .slice(0, 12);
  if (visible.length === 0) return undefined;

  const lines = visible.map((link) => {
    const target = link.to ? (labels.get(link.to) ?? shortId(link.to)) : "null";
    return `<edge from="${labels.get(link.from) ?? shortId(link.from)}" to="${target}" kind="${link.kind}" confidence="${link.confidence}"/>`;
  });
  return `<message_links>\n${lines.join("\n")}\n</message_links>`;
}

function renderActiveChain(turns: readonly MessageTurn[], config: ChatLearningConfig): string | undefined {
  if (turns.length === 0) return undefined;
  const lines = turns.map((turn, index) => `m${index + 1}: ${displayName(turn, config)}: ${turn.text}`);
  return `<active_chain>\n${lines.join("\n")}\n</active_chain>`;
}

function renderPatterns(state: ChatLearningState, eventKind: ProactiveEventKind | undefined): string | undefined {
  const response = state.responsePatterns.slice(0, 8);
  const initiation = eventKind ? state.initiationPatterns.slice(0, 8) : [];
  const lines: string[] = [];
  for (const pattern of response) {
    lines.push(
      `<pattern kind="response" intent="${pattern.intent}" phrase="${escapeXml(pattern.phrase)}" count="${pattern.frequency}"/>`,
    );
  }
  for (const pattern of initiation) {
    lines.push(
      `<pattern kind="initiation" intent="${pattern.intent}" phrase="${escapeXml(pattern.phrase)}" count="${pattern.frequency}"/>`,
    );
  }
  if (lines.length === 0) return undefined;
  return `<local_patterns>\n${lines.join("\n")}\n</local_patterns>`;
}

function selectExamples(
  segments: readonly ConversationSegment[],
  config: ChatLearningConfig,
): readonly ConversationSegment[] {
  return segments
    .filter((segment) => segment.turns.length >= 2)
    .slice(-config.maxExamples)
    .reverse();
}

function renderExamples(segments: readonly ConversationSegment[], config: ChatLearningConfig): string | undefined {
  if (segments.length === 0) return undefined;
  const examples = segments.map((segment) => renderExample(segment, config)).filter((example) => example !== undefined);
  if (examples.length === 0) return undefined;
  return `<group_examples>\n${examples.join("\n")}\n</group_examples>`;
}

function renderExample(segment: ConversationSegment, config: ChatLearningConfig): string | undefined {
  const turns = segment.turns.slice(-config.maxMessagesPerExample);
  const lines = turns.map((turn) => `${displayName(turn, config)}: ${turn.text}`);
  if (lines.length < 2) return undefined;
  return `<example>\n${lines.join("\n")}\n</example>`;
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
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
