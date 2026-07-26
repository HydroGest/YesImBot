export type ControlElement = "inner_thought" | "sep" | "sleep" | "skip";

export interface ReplySegment {
  readonly text: string;
  readonly index: number;
  readonly total: number;
  readonly sleepHintMs: number;
}

export type DegradationReason =
  | "parse_failed"
  | "no_segments"
  | "residual_control_element"
  | "segment_limit_exceeded";

export interface ParsedReply {
  readonly segments: readonly ReplySegment[];
  readonly innerThoughts: readonly string[];
  readonly skipped: boolean;
  readonly degraded?: DegradationReason;
}

export interface OclLimits {
  readonly maxSegments: number;
}

export interface ProtectionZone {
  readonly start: number;
  readonly end: number;
}

export interface ControlElementMatch {
  readonly type: ControlElement;
  readonly start: number;
  readonly end: number;
  readonly raw: string;
}

const CONTROL_PATTERNS: ReadonlyArray<readonly [ControlElement, RegExp]> = [
  ["inner_thought", /<inner_thought>([\s\S]*?)<\/inner_thought>/g],
  ["sep", /<sep\s*\/>/g],
  ["sleep", /<sleep\s+ms="\d+"\s*\/>/g],
  ["skip", /<skip\s*\/>/g],
];

const INNER_THOUGHT_OPENING = "<inner_thought>";
const INNER_THOUGHT_CLOSING = "</inner_thought>";

interface SegmentCandidate {
  readonly text: string;
  readonly sleepHintMs: number;
}

export function parseReply(raw: string, limits: OclLimits): ParsedReply {
  try {
    const protectionZones = findProtectionZones(raw);
    const controls = findControlElements(raw, protectionZones);
    const innerThoughts = controls
      .filter((control) => control.type === "inner_thought")
      .map(innerThoughtText);
    const visibleControls = controls.filter(
      (control) => control.type !== "inner_thought" && !isInsideInnerThought(control, controls),
    );

    if (visibleControls.some((control) => control.type === "skip")) {
      return { segments: [], innerThoughts, skipped: true };
    }

    const candidates = buildSegmentCandidates(raw, controls, visibleControls);
    if (hasResidualControlElement(candidates)) {
      return degradedReply(raw, innerThoughts, "residual_control_element");
    }

    const segments = candidates
      .map(({ text, sleepHintMs }) => ({ text: unescapeControlEntities(text.trim()), sleepHintMs }))
      .filter(({ text }) => text.length > 0);

    if (segments.length === 0) {
      return degradedReply(raw, innerThoughts, "no_segments");
    }

    const maxSegments = validMaxSegments(limits.maxSegments);
    if (segments.length > maxSegments) {
      return {
        segments: withSegmentPositions(mergeExcessSegments(segments, maxSegments)),
        innerThoughts,
        skipped: false,
        degraded: "segment_limit_exceeded",
      };
    }

    return { segments: withSegmentPositions(segments), innerThoughts, skipped: false };
  } catch {
    return degradedReply(safeString(raw), [], "parse_failed");
  }
}

function buildSegmentCandidates(
  raw: string,
  controls: readonly ControlElementMatch[],
  visibleControls: readonly ControlElementMatch[],
): readonly SegmentCandidate[] {
  const innerThoughts = controls.filter((control) => control.type === "inner_thought");
  const tokens = [...innerThoughts, ...visibleControls]
    .filter((control) => control.type !== "skip")
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const candidates: SegmentCandidate[] = [];
  let text = "";
  let sleepHintMs = 0;
  let cursor = 0;

  for (const token of tokens) {
    text += raw.slice(cursor, token.start);
    cursor = token.end;

    if (token.type === "sep") {
      candidates.push({ text, sleepHintMs });
      text = "";
      sleepHintMs = 0;
    } else if (token.type === "sleep") {
      sleepHintMs += sleepHint(token);
    }
  }

  candidates.push({ text: text + raw.slice(cursor), sleepHintMs });
  return candidates;
}

function hasResidualControlElement(candidates: readonly SegmentCandidate[]): boolean {
  return candidates.some(
    ({ text }) => findControlElements(text, findProtectionZones(text)).length > 0,
  );
}

function degradedReply(
  raw: string,
  innerThoughts: readonly string[],
  degraded: DegradationReason,
): ParsedReply {
  return {
    segments: [{ text: sanitizeFallback(raw).trim(), sleepHintMs: 0, index: 1, total: 1 }],
    innerThoughts,
    skipped: false,
    degraded,
  };
}

function sanitizeFallback(raw: string): string {
  let sanitized = raw;

  while (true) {
    const controls = findControlElements(sanitized, findProtectionZones(sanitized));
    if (controls.length === 0) {
      return unescapeControlEntities(sanitized);
    }

    sanitized = removeMatches(sanitized, controls);
  }
}

function removeMatches(raw: string, matches: readonly ControlElementMatch[]): string {
  let result = "";
  let cursor = 0;

  for (const match of matches) {
    result += raw.slice(cursor, match.start);
    cursor = match.end;
  }

  return result + raw.slice(cursor);
}

function innerThoughtText(match: ControlElementMatch): string {
  return match.raw.slice(INNER_THOUGHT_OPENING.length, -INNER_THOUGHT_CLOSING.length);
}

function isInsideInnerThought(
  control: ControlElementMatch,
  controls: readonly ControlElementMatch[],
): boolean {
  return controls.some(
    (innerThought) =>
      innerThought.type === "inner_thought" &&
      control.start >= innerThought.start &&
      control.end <= innerThought.end,
  );
}

function sleepHint(control: ControlElementMatch): number {
  const match = /ms="(\d+)"/.exec(control.raw);
  if (match?.[1] === undefined) {
    throw new Error("recognized sleep control is missing milliseconds");
  }

  const milliseconds = Number(match[1]);
  if (!Number.isSafeInteger(milliseconds)) {
    throw new Error("sleep hint exceeds safe integer range");
  }

  return milliseconds;
}

function validMaxSegments(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("maxSegments must be a positive integer");
  }

  return value;
}

function mergeExcessSegments(
  segments: readonly Pick<ReplySegment, "text" | "sleepHintMs">[],
  maxSegments: number,
): readonly Pick<ReplySegment, "text" | "sleepHintMs">[] {
  const retained = segments.slice(0, maxSegments - 1);
  const overflow = segments.slice(maxSegments - 1);

  return [
    ...retained,
    {
      text: overflow.map((segment) => segment.text).join(""),
      sleepHintMs: overflow.reduce((total, segment) => total + segment.sleepHintMs, 0),
    },
  ];
}

function withSegmentPositions(
  segments: readonly Pick<ReplySegment, "text" | "sleepHintMs">[],
): readonly ReplySegment[] {
  return segments.map((segment, index) => ({
    ...segment,
    index: index + 1,
    total: segments.length,
  }));
}

function safeString(value: unknown): string {
  try {
    return typeof value === "string" ? value : String(value);
  } catch {
    return "";
  }
}

export function findProtectionZones(raw: string): readonly ProtectionZone[] {
  const zones: ProtectionZone[] = [];

  addFencedCodeZones(raw, zones);
  addInlineCodeZones(raw, zones);
  addUrlZones(raw, zones);
  addPlatformElementZones(raw, zones);

  return zones.sort((left, right) => left.start - right.start || left.end - right.end);
}

export function findControlElements(
  raw: string,
  protectionZones: readonly ProtectionZone[],
): readonly ControlElementMatch[] {
  const matches: ControlElementMatch[] = [];

  for (const [type, pattern] of CONTROL_PATTERNS) {
    for (const match of raw.matchAll(pattern)) {
      const start = match.index;
      const element = match[0];
      const end = start + element.length;
      if (!isProtected(start, end, protectionZones)) {
        matches.push({ type, start, end, raw: element });
      }
    }
  }

  return matches.sort((left, right) => left.start - right.start || left.end - right.end);
}

export function unescapeControlEntities(raw: string): string {
  return raw.replace(
    /&lt;(\/?inner_thought|sep\s*\/|sleep\s+ms=&quot;\d+&quot;\s*\/|skip\s*\/)&gt;/g,
    (_, element: string) => {
      return `<${element.replaceAll("&quot;", '"')}>`;
    },
  );
}

function addFencedCodeZones(raw: string, zones: ProtectionZone[]): void {
  let lineStart = 0;

  while (lineStart < raw.length) {
    const opening = fenceAtLineStart(raw, lineStart);
    if (opening === undefined) {
      lineStart = nextLineStart(raw, lineStart);
      continue;
    }

    const closing = findClosingFence(raw, nextLineStart(raw, lineStart), opening.length);
    const end = closing === undefined ? raw.length : lineEnd(raw, closing);
    addZone(zones, { start: lineStart, end });
    lineStart = end;
  }
}

function addInlineCodeZones(raw: string, zones: ProtectionZone[]): void {
  let index = 0;

  while (index < raw.length) {
    if (isProtected(index, index + 1, zones) || raw[index] !== "`") {
      index += 1;
      continue;
    }

    const delimiterLength = backtickRunLength(raw, index);
    const closing = findInlineClosingDelimiter(
      raw,
      index + delimiterLength,
      delimiterLength,
      zones,
    );
    if (closing === undefined) {
      index += delimiterLength;
      continue;
    }

    addZone(zones, { start: index, end: closing + delimiterLength });
    index = closing + delimiterLength;
  }
}

function addUrlZones(raw: string, zones: ProtectionZone[]): void {
  const urls = /https?:\/\/[^\s]*?(?=<(?:at|img|quote)\b|\s|$)/g;

  for (const match of raw.matchAll(urls)) {
    const start = match.index;
    const end = start + match[0].length;
    if (end > start && !isProtected(start, end, zones)) {
      addZone(zones, { start, end });
    }
  }
}

function addPlatformElementZones(raw: string, zones: ProtectionZone[]): void {
  const tags = /<([a-z][\w-]*)\b[^>]*>/gi;

  for (const match of raw.matchAll(tags)) {
    const start = match.index;
    const openingTag = match[0];
    const name = match[1]?.toLowerCase();
    if (
      name === undefined ||
      isRecognizedControlTag(openingTag) ||
      isProtected(start, start + openingTag.length, zones)
    ) {
      continue;
    }

    const end = openingTag.endsWith("/>")
      ? start + openingTag.length
      : platformElementEnd(raw, name, start, openingTag);
    addZone(zones, { start, end });
  }
}

function fenceAtLineStart(raw: string, lineStart: number): { readonly length: number } | undefined {
  let index = lineStart;
  while (index < raw.length && index - lineStart < 3 && raw[index] === " ") {
    index += 1;
  }

  const length = backtickRunLength(raw, index);
  return length >= 3 ? { length } : undefined;
}

function findClosingFence(
  raw: string,
  lineStart: number,
  delimiterLength: number,
): number | undefined {
  let currentLineStart = lineStart;
  while (currentLineStart < raw.length) {
    const fence = fenceAtLineStart(raw, currentLineStart);
    if (fence !== undefined && fence.length >= delimiterLength) {
      return currentLineStart;
    }
    currentLineStart = nextLineStart(raw, currentLineStart);
  }
}

function findInlineClosingDelimiter(
  raw: string,
  start: number,
  delimiterLength: number,
  zones: readonly ProtectionZone[],
): number | undefined {
  let index = start;
  while (index < raw.length) {
    if (isProtected(index, index + 1, zones) || raw[index] !== "`") {
      index += 1;
      continue;
    }

    const length = backtickRunLength(raw, index);
    if (length === delimiterLength) {
      return index;
    }
    index += length;
  }
}

function platformElementEnd(raw: string, name: string, start: number, openingTag: string): number {
  const contentStart = start + openingTag.length;
  const tags = new RegExp(`<(\\/?)${name}\\b[^>]*>`, "gi");
  let depth = 1;

  for (const tag of raw.slice(contentStart).matchAll(tags)) {
    if (tag[1] === "/") {
      depth -= 1;
      if (depth === 0) {
        return contentStart + tag.index + tag[0].length;
      }
    } else if (!tag[0].endsWith("/>")) {
      depth += 1;
    }
  }

  return raw.length;
}

function isRecognizedControlTag(tag: string): boolean {
  return /^<inner_thought>$|^<sep\s*\/>$|^<sleep\s+ms="\d+"\s*\/>$|^<skip\s*\/>$/.test(tag);
}

function addZone(zones: ProtectionZone[], zone: ProtectionZone): void {
  if (!isProtected(zone.start, zone.end, zones)) {
    zones.push(zone);
  }
}

function isProtected(start: number, end: number, zones: readonly ProtectionZone[]): boolean {
  return zones.some((zone) => start < zone.end && end > zone.start);
}

function backtickRunLength(raw: string, start: number): number {
  let end = start;
  while (raw[end] === "`") {
    end += 1;
  }
  return end - start;
}

function nextLineStart(raw: string, start: number): number {
  const newline = raw.indexOf("\n", start);
  return newline === -1 ? raw.length : newline + 1;
}

function lineEnd(raw: string, start: number): number {
  const newline = raw.indexOf("\n", start);
  return newline === -1 ? raw.length : newline;
}
