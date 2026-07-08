import { encode } from "@toon-format/toon";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface PreviewOptions {
  maxChars: number;
  redactKeys: readonly string[];
}

const REDACTED = "[redacted]";
const TRUNCATED = "\n[truncated]";

export function isJsonLike(value: unknown): value is JsonValue {
  return isJsonValue(value, false);
}

function isJsonValue(value: unknown, allowString: boolean): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "number" || typeof value === "boolean") return Number.isFinite(value);
  if (typeof value === "string") return allowString;
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry, true));
  if (!isPlainObject(value)) return false;
  return Object.values(value).every((entry) => isJsonValue(entry, true));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function redactJsonLike(value: JsonValue, keys: readonly string[]): JsonValue {
  const redactedKeys = new Set(keys.map((key) => key.toLowerCase()));
  return redact(value, redactedKeys);
}

function redact(value: JsonValue, redactedKeys: ReadonlySet<string>): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry, redactedKeys));
  }
  if (!isJsonObject(value)) {
    return value;
  }

  const next: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = redactedKeys.has(key.toLowerCase()) ? REDACTED : redact(entry, redactedKeys);
  }
  return next;
}

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function formatPreview(value: unknown, options: PreviewOptions): string {
  const redacted = redactUnknown(value, options.redactKeys);
  const formatted = isJsonLike(redacted) ? encode(redacted) : safeText(redacted);
  return truncate(formatted, options.maxChars);
}

function redactUnknown(value: unknown, keys: readonly string[]): unknown {
  return redactAny(value, new Set(keys.map((key) => key.toLowerCase())), new WeakSet());
}

function redactAny(
  value: unknown,
  redactedKeys: ReadonlySet<string>,
  seen: WeakSet<object>,
): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value.map((entry) => redactAny(entry, redactedKeys, seen));
  }

  if (!isPlainObject(value)) {
    return typeof value === "object" && value !== null ? summarizeObject(value) : value;
  }

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "function") {
      continue;
    }
    next[key] = redactedKeys.has(key.toLowerCase())
      ? REDACTED
      : redactAny(entry, redactedKeys, seen);
  }
  return next;
}

export function formatToon(value: JsonValue): string {
  return formatValue(value, 0, "items");
}

function formatValue(value: JsonValue, indent: number, arrayName: string): string {
  if (Array.isArray(value)) {
    return formatArray(value, indent, arrayName);
  }
  if (isJsonObject(value)) {
    return formatObject(value, indent);
  }
  return formatScalar(value);
}

function formatArray(value: JsonValue[], indent: number, arrayName: string): string {
  if (value.length === 0) {
    return `${arrayName}[0]: []`;
  }

  const lines = [`${arrayName}[${value.length}]:`];
  for (const entry of value) {
    const formatted = formatValue(entry, indent + 2, "items");
    const [first = "", ...rest] = formatted.split("\n");
    lines.push(`${spaces(indent + 2)}- ${first.trimStart()}`);
    for (const line of rest) {
      lines.push(`${spaces(indent + 4)}${line.trimStart()}`);
    }
  }
  return lines.join("\n");
}

function formatObject(value: Record<string, JsonValue>, indent: number): string {
  return Object.entries(value)
    .map(([key, entry]) => {
      if (Array.isArray(entry) || isJsonObject(entry)) {
        const formatted = formatValue(entry, indent + 2, key);
        return `${spaces(indent)}${key}:\n${indentBlock(formatted, indent + 2)}`;
      }
      return `${spaces(indent)}${key}: ${formatScalar(entry)}`;
    })
    .join("\n");
}

function formatScalar(value: JsonPrimitive): string {
  if (value === null) return "null";
  return String(value);
}

function indentBlock(value: string, indent: number): string {
  return value
    .split("\n")
    .map((line) => `${spaces(indent)}${line}`)
    .join("\n");
}

function spaces(count: number): string {
  return " ".repeat(count);
}

function safeText(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    const serialized = JSON.stringify(value);
    return serialized ?? String(value);
  } catch {
    return String(value);
  }
}

function summarizeObject(value: object): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }

  const name = value.constructor?.name;
  return `[${name && name !== "Object" ? name : "Object"}]`;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  const bodyLength = Math.max(0, maxChars - TRUNCATED.length - 3);
  return `${value.slice(0, bodyLength)}...${TRUNCATED}`;
}
