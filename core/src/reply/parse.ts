export type ReplyDegradation =
  | "parse_failed"
  | "segment_limit_exceeded"
  | "residual_control_element";

export interface ReplyPlan {
  readonly innerThought?: string;
  readonly segments: readonly { readonly text: string }[];
  readonly degraded?: ReplyDegradation;
}

type ControlMatch = {
  readonly kind: "innerThought" | "separator" | "residual";
  readonly start: number;
  readonly end: number;
  readonly innerThought?: string;
};

const INNER_THOUGHT = /<inner_thought>([\s\S]*?)<\/inner_thought>/g;
const SEPARATOR = /<sep\s*\/>/g;
const RESIDUAL_CONTROL = /<\/?inner_thought>|<sep\s*\/>/g;
const PROTECTED_LITERAL =
  /```[\s\S]*?```|`[^`]*`|https?:\/\/[^\s]*|<(?!(?:inner_thought|sep)\b)([a-z][\w-]*)\b[^>]*(?:\/>|>[\s\S]*?<\/\1>)/gi;

export function parseReply(raw: string, maxSegments: number): ReplyPlan {
  try {
    if (!Number.isSafeInteger(maxSegments) || maxSegments < 1) {
      throw new Error("maxSegments must be a positive integer");
    }

    const protectedRanges = findProtectedRanges(raw);
    const controls = findControls(raw, protectedRanges);
    const innerThought = controls
      .filter((control) => control.kind === "innerThought")
      .map((control) => control.innerThought)
      .filter((thought): thought is string => thought !== undefined)
      .join("\n");

    if (controls.some((control) => control.kind === "residual")) {
      return degradedReply(raw, protectedRanges, "residual_control_element");
    }

    const segments = splitVisibleSegments(raw, controls).map((text) => ({
      text: unescapeControlText(text),
    }));
    if (
      segments.some((segment) =>
        hasRecognizedControl(segment.text, findProtectedRanges(segment.text)),
      )
    ) {
      return degradedReply(raw, protectedRanges, "residual_control_element");
    }
    if (segments.length > maxSegments) {
      return {
        segments: segments.slice(0, maxSegments),
        degraded: "segment_limit_exceeded",
        ...(innerThought.length === 0 ? {} : { innerThought }),
      };
    }
    return {
      segments: segments.length === 0 ? [{ text: "" }] : segments,
      ...(innerThought.length === 0 ? {} : { innerThought }),
    };
  } catch {
    return degradedReply(raw, findProtectedRanges(raw), "parse_failed");
  }
}

function findControls(raw: string, protectedRanges: readonly Range[]): readonly ControlMatch[] {
  const innerThoughtRegions = [...raw.matchAll(INNER_THOUGHT)]
    .filter((match) => !isProtected(match.index, match.index + match[0].length, protectedRanges))
    .map((match) => ({
      kind: "innerThought" as const,
      start: match.index,
      end: match.index + match[0].length,
      innerThought: match[1] ?? "",
    }));
  const separators = [...raw.matchAll(SEPARATOR)]
    .filter((match) => !isProtected(match.index, match.index + match[0].length, protectedRanges))
    .filter(
      (match) =>
        !innerThoughtRegions.some(
          (thought) => match.index >= thought.start && match.index < thought.end,
        ),
    )
    .map((match) => ({
      kind: "separator" as const,
      start: match.index,
      end: match.index + match[0].length,
    }));
  const recognized = [...innerThoughtRegions, ...separators];
  const residual = [...raw.matchAll(RESIDUAL_CONTROL)]
    .filter((match) => !isProtected(match.index, match.index + match[0].length, protectedRanges))
    .filter(
      (match) =>
        !recognized.some((control) => match.index >= control.start && match.index < control.end),
    )
    .map((match) => ({
      kind: "residual" as const,
      start: match.index,
      end: match.index + match[0].length,
    }));
  return [...recognized, ...residual].sort((left, right) => left.start - right.start);
}

function splitVisibleSegments(raw: string, controls: readonly ControlMatch[]): readonly string[] {
  const segments: string[] = [];
  let visible = "";
  let cursor = 0;
  for (const control of controls) {
    visible += raw.slice(cursor, control.start);
    cursor = control.end;
    if (control.kind === "separator") {
      const text = visible.trim();
      if (text.length > 0) segments.push(text);
      visible = "";
    }
  }
  visible += raw.slice(cursor);
  const text = visible.trim();
  if (text.length > 0) segments.push(text);
  return segments;
}

function degradedReply(
  raw: string,
  protectedRanges: readonly Range[],
  degraded: ReplyDegradation,
): ReplyPlan {
  const controls = findControls(raw, protectedRanges);
  return {
    segments: [{ text: unescapeControlText(stripControls(raw, controls)).trim() }],
    degraded,
  };
}

function stripControls(raw: string, controls: readonly ControlMatch[]): string {
  let visible = "";
  let cursor = 0;
  for (const control of controls) {
    visible += raw.slice(cursor, control.start);
    if (raw.startsWith("<inner_thought>", control.start)) return visible;
    cursor = control.end;
  }
  return visible + raw.slice(cursor);
}

function hasRecognizedControl(raw: string, protectedRanges: readonly Range[]): boolean {
  return [...raw.matchAll(RESIDUAL_CONTROL)].some(
    (match) => !isProtected(match.index, match.index + match[0].length, protectedRanges),
  );
}

function unescapeControlText(raw: string): string {
  return raw.replace(
    /&lt;(\/?inner_thought|sep\s*\/)&gt;/g,
    (_, control: string) => `<${control}>`,
  );
}

type Range = { readonly start: number; readonly end: number };

function findProtectedRanges(raw: string): readonly Range[] {
  return [...raw.matchAll(PROTECTED_LITERAL)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function isProtected(start: number, end: number, ranges: readonly Range[]): boolean {
  return ranges.some((range) => start < range.end && end > range.start);
}
