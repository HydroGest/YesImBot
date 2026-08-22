import { readFile, readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import { DataService } from "@koishijs/console";
import {} from "@koishijs/loader";
import { Context } from "koishi";
import { formatElements } from "koishi-plugin-yesimbot";

const REFRESH_INTERVAL = 10_000;
const MAX_SESSION_ENTRIES = 3_000;
const MAX_ASSET_DATA_URL_BYTES = 1024 * 1024;
const COMPLETE_ASSET_ID = /^[a-f0-9]{32}$/;
const SESSION_FILE = /^[0-9A-Za-zTZ_-]+\.jsonl$/;

export interface ConversationRequest {
  readonly channel: string;
  readonly session: string;
}

export interface ConversationChannelSummary {
  readonly key: string;
  readonly type: "channel" | "guild" | "direct";
  readonly platform: string;
  readonly channelId: string;
  readonly guildId?: string;
  readonly userId?: string;
  readonly selfId?: string;
  readonly createdAt: string;
  readonly activeSession: string | null;
  readonly sessions: ConversationSessionSummary[];
  readonly totalSizeBytes: number;
  readonly lastActivityAt: number | null;
  readonly will: ConversationChannelWill;
}

export interface ConversationChannelWill {
  readonly matched: ConversationWillPolicy | null;
  readonly candidates: readonly ConversationWillPolicy[];
}

export interface ConversationSessionSummary {
  readonly filename: string;
  readonly isActive: boolean;
  readonly size: number;
  readonly createdAt: string;
  readonly lastActivityAt: number;
}

export interface ConversationIndex {
  readonly generatedAt: string;
  readonly channels: ConversationChannelSummary[];
  readonly totalChannels: number;
  readonly totalSessions: number;
  readonly totalSizeBytes: number;
  readonly will: ConversationWillSummary;
}

export interface ConversationWillPolicy {
  readonly id: string;
  readonly enabled: boolean;
  readonly engine: "routing" | "willingness";
  readonly priority?: number;
  readonly config?: Record<string, unknown>;
}

export interface ConversationWillSummary {
  readonly installed: boolean;
  readonly defaultLabel: string;
  readonly policies: ConversationWillPolicy[];
}

export interface ConversationEntryView {
  readonly id: string;
  readonly timestamp: number;
  readonly kind: "user" | "assistant" | "thought" | "tool-call" | "tool-result" | "compact" | "event" | "will";
  readonly text?: string;
  readonly sender?: string;
  readonly messageId?: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly args?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly name?: string; readonly message?: string };
  readonly assets?: ConversationAssetView[];
  readonly usage?: unknown;
  readonly finishReason?: string;
  readonly turnId?: string;
  readonly eventType?: string;
  readonly decision?: string;
  readonly willDebug?: unknown;
  readonly groupKey?: string;
  readonly sourceSession?: string;
}

export interface ConversationAssetView {
  readonly id: string;
  readonly kind: "image" | "file";
  readonly title?: string;
  readonly size: number;
  readonly dataUrl?: string;
}

export interface ConversationDetail {
  readonly channel: string;
  readonly session: string;
  readonly entries: ConversationEntryView[];
  readonly truncated: boolean;
  readonly summary: {
    readonly messageCount: number;
    readonly thoughtCount: number;
    readonly toolCallCount: number;
    readonly errorCount: number;
    readonly sizeBytes: number;
  };
}

interface ChannelManifest {
  readonly type: "channel" | "guild" | "direct";
  readonly platform: string;
  readonly channelId?: string;
  readonly guildId?: string;
  readonly userId?: string;
  readonly selfId?: string;
  readonly createdAt: string;
}

interface ChannelMatchContext {
  readonly platform: string;
  readonly channelId: string;
  readonly guildId?: string;
  readonly selfId?: string;
  readonly userId?: string;
  readonly type: "channel" | "guild" | "direct";
  readonly isDirect: boolean;
}

interface RawEntry {
  readonly id?: unknown;
  readonly timestamp?: unknown;
  readonly type?: unknown;
  readonly data?: unknown;
}

interface RawMessage {
  readonly id?: unknown;
  readonly role?: unknown;
  readonly type?: unknown;
  readonly content?: unknown;
  readonly data?: unknown;
  readonly usage?: unknown;
  readonly finishReason?: unknown;
}

declare module "@koishijs/console" {
  namespace Console {
    interface Services {
      yesimbotConversations: ConversationsProvider;
    }
  }

  interface Events {
    "yesimbot/conversation": (input: ConversationRequest) => Promise<ConversationDetail>;
  }
}

export class ConversationsProvider extends DataService<ConversationIndex> {
  public static readonly inject = ["console", "yesimbot", "loader"];

  private timer: (() => void) | undefined;

  public constructor(public readonly ctx: Context) {
    super(ctx, "yesimbotConversations");
    ctx.console.addListener("yesimbot/conversation", (input) => readConversationDetail(ctx, input));
    ctx.on("ready", () => {
      this.refresh();
      this.timer = ctx.setInterval(() => this.refresh(), REFRESH_INTERVAL);
    });
    ctx.on("dispose", () => {
      this.timer?.();
      this.timer = undefined;
    });
  }

  public async get(): Promise<ConversationIndex> {
    return buildConversationIndex(this.ctx);
  }
}

export async function parseConversationJsonl(
  content: string,
  session: string,
  channelRoot: string,
): Promise<{ entries: ConversationEntryView[]; truncated: boolean }> {
  const entries: ConversationEntryView[] = [];
  let sequence = 0;
  let truncated = false;
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    sequence += 1;
    const parsed = await parseRawEntry(raw, session, sequence, channelRoot);
    if (entries.length + parsed.length > MAX_SESSION_ENTRIES) {
      truncated = true;
      break;
    }
    entries.push(...parsed);
  }
  return { entries, truncated };
}

async function buildConversationIndex(ctx: Context): Promise<ConversationIndex> {
  const channelsPath = resolveChannelsPath(ctx);
  const will = collectWillPolicies(ctx);
  const channels = await scanChannelSummaries(channelsPath, will.policies);
  return {
    generatedAt: new Date().toISOString(),
    channels,
    totalChannels: channels.length,
    totalSessions: channels.reduce((sum, channel) => sum + channel.sessions.length, 0),
    totalSizeBytes: channels.reduce((sum, channel) => sum + channel.totalSizeBytes, 0),
    will,
  };
}

function collectWillPolicies(ctx: Context): ConversationWillSummary {
  const plugins = flattenPluginConfig(ctx.loader.config.plugins ?? {});
  const policies: ConversationWillPolicy[] = [];
  for (const [rawKey, value] of Object.entries(plugins)) {
    if (normalizePluginKey(rawKey) !== "yesimbot-will-policy") continue;
    const config = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    policies.push({
      id: rawKey,
      enabled: !rawKey.startsWith("~"),
      engine: config.engine === "willingness" ? "willingness" : "routing",
      priority: typeof config.priority === "number" ? config.priority : undefined,
      config,
    });
  }
  return {
    installed: policies.some((policy) => policy.enabled),
    defaultLabel: "默认策略：私聊与 @ 触发，普通群聊等待",
    policies,
  };
}

function matchChannelWill(context: ChannelMatchContext, policies: readonly ConversationWillPolicy[]): ConversationChannelWill {
  const enabled = policies.filter((policy) => policy.enabled);
  const sorted = [...enabled].sort((left, right) => (left.priority ?? Number.MAX_SAFE_INTEGER) - (right.priority ?? Number.MAX_SAFE_INTEGER));
  const matched = sorted.find((policy) => matchesFilter(policy.config?.["$filter"], context)) ?? null;
  return { matched, candidates: enabled };
}

function matchesFilter(filter: unknown, context: ChannelMatchContext): boolean {
  if (filter === undefined || filter === null) return true;
  if (Array.isArray(filter)) return filter.some((item) => matchesFilter(item, context));
  if (typeof filter !== "object") return true;
  for (const [key, raw] of Object.entries(filter as Record<string, unknown>)) {
    if (key === "$or") {
      if (!Array.isArray(raw) || !raw.some((item) => matchesFilter(item, context))) return false;
      continue;
    }
    if (key === "$and") {
      if (!Array.isArray(raw) || !raw.every((item) => matchesFilter(item, context))) return false;
      continue;
    }
    if (key === "$not") {
      if (matchesFilter(raw, context)) return false;
      continue;
    }
    if (key.startsWith("$")) continue;
    if (!matchesValue(channelField(context, key), raw)) return false;
  }
  return true;
}

function matchesValue(actual: string | boolean | undefined, expected: unknown): boolean {
  if (expected === undefined || expected === null) return actual === undefined;
  if (Array.isArray(expected)) return expected.some((item) => String(item) === String(actual));
  if (typeof expected === "object" && expected !== null) {
    const expression = expected as Record<string, unknown>;
    if ("$in" in expression) return Array.isArray(expression.$in) && expression.$in.some((item) => String(item) === String(actual));
    if ("$nin" in expression) return !(Array.isArray(expression.$nin) && expression.$nin.some((item) => String(item) === String(actual)));
    if ("$ne" in expression) return String(expression.$ne) !== String(actual);
    if ("$eq" in expression) return String(expression.$eq) === String(actual);
  }
  return String(expected) === String(actual);
}

function channelField(context: ChannelMatchContext, key: string): string | boolean | undefined {
  switch (key) {
    case "platform":
      return context.platform;
    case "channelId":
      return context.channelId;
    case "guildId":
      return context.guildId;
    case "selfId":
      return context.selfId;
    case "userId":
      return context.userId;
    case "type":
      return context.type;
    case "subtype":
      return context.isDirect ? "private" : "group";
    case "isDirect":
      return context.isDirect;
    default:
      return undefined;
  }
}

async function scanChannelSummaries(channelsPath: string, policies: readonly ConversationWillPolicy[]): Promise<ConversationChannelSummary[]> {
  const entries = await readdir(channelsPath, { withFileTypes: true }).catch(() => []);
  const channels: ConversationChannelSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const root = join(channelsPath, entry.name);
    const manifest = await readChannelManifest(join(root, "channel.json"));
    if (!manifest) continue;
    const sessions = await scanSessionSummaries(join(root, "sessions"));
    const matchContext: ChannelMatchContext = {
      platform: manifest.platform,
      channelId: manifest.channelId ?? manifest.guildId ?? "",
      guildId: manifest.guildId,
      selfId: manifest.selfId,
      userId: manifest.userId,
      type: manifest.type,
      isDirect: manifest.type === "direct",
    };
    channels.push({
      key: entry.name,
      type: manifest.type,
      platform: manifest.platform,
      channelId: manifest.channelId ?? manifest.guildId ?? "",
      guildId: manifest.guildId,
      userId: manifest.userId,
      selfId: manifest.selfId,
      createdAt: manifest.createdAt,
      activeSession: sessions.find((session) => session.isActive)?.filename ?? null,
      sessions,
      totalSizeBytes: sessions.reduce((sum, session) => sum + session.size, 0),
      lastActivityAt: sessions.reduce<number | null>((latest, session) => {
        if (latest === null || session.lastActivityAt > latest) return session.lastActivityAt;
        return latest;
      }, null),
      will: matchChannelWill(matchContext, policies),
    });
  }
  return channels.sort((left, right) => (right.lastActivityAt ?? 0) - (left.lastActivityAt ?? 0));
}

async function readChannelManifest(filePath: string): Promise<ChannelManifest | undefined> {
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (typeof raw !== "object" || raw === null) return undefined;
    const value = raw as Record<string, unknown>;
    if (value.type !== "channel" && value.type !== "guild" && value.type !== "direct") return undefined;
    if (typeof value.platform !== "string" || typeof value.createdAt !== "string") return undefined;
    return {
      type: value.type,
      platform: value.platform,
      channelId: typeof value.channelId === "string" ? value.channelId : undefined,
      guildId: typeof value.guildId === "string" ? value.guildId : undefined,
      userId: typeof value.userId === "string" ? value.userId : undefined,
      selfId: typeof value.selfId === "string" ? value.selfId : undefined,
      createdAt: value.createdAt,
    };
  } catch {
    return undefined;
  }
}

async function scanSessionSummaries(sessionsPath: string): Promise<ConversationSessionSummary[]> {
  const filenames = (await readdir(sessionsPath).catch(() => [])).filter((name) => SESSION_FILE.test(name)).sort();
  const sessions: ConversationSessionSummary[] = [];
  for (const filename of filenames) {
    try {
      const info = await stat(join(sessionsPath, filename));
      sessions.push({
        filename,
        isActive: false,
        size: info.size,
        createdAt: basename(filename, ".jsonl"),
        lastActivityAt: info.mtimeMs,
      });
    } catch {
      continue;
    }
  }
  const active = sessions.at(-1);
  if (active) sessions[sessions.length - 1] = { ...active, isActive: true };
  return sessions;
}

async function readConversationDetail(ctx: Context, request: ConversationRequest): Promise<ConversationDetail> {
  const channelsPath = resolveChannelsPath(ctx);
  const channelPath = safeJoin(channelsPath, request.channel);
  if (!channelPath) throw new Error("Invalid channel");
  const sessionPath = safeJoin(join(channelPath, "sessions"), request.session);
  if (!sessionPath) throw new Error("Invalid session");
  const info = await stat(sessionPath);
  if (!info.isFile()) throw new Error("Session file not found");
  const parsed = await readSessionEntries(sessionPath, request.session, channelPath);
  return {
    channel: request.channel,
    session: request.session,
    entries: parsed.entries,
    truncated: parsed.truncated,
    summary: {
      messageCount: parsed.entries.filter((entry) => entry.kind === "user" || entry.kind === "assistant").length,
      thoughtCount: parsed.entries.filter((entry) => entry.kind === "thought").length,
      toolCallCount: parsed.entries.filter((entry) => entry.kind === "tool-call").length,
      errorCount: parsed.entries.filter((entry) => entry.kind === "event" && entry.eventType?.includes("failed")).length,
      sizeBytes: info.size,
    },
  };
}

async function readSessionEntries(filePath: string, session: string, channelRoot: string): Promise<{ entries: ConversationEntryView[]; truncated: boolean }> {
  const content = await readFile(filePath, "utf8");
  return parseConversationJsonl(content, session, channelRoot);
}

async function parseRawEntry(raw: unknown, session: string, sequence: number, channelRoot: string): Promise<ConversationEntryView[]> {
  const entry = raw as RawEntry;
  const timestamp = numberValue(entry.timestamp) ?? Date.now();
  const id = `${sequence}-${stringValue(entry.id) ?? sequence}`;
  const groupKey = stringValue(entry.id) ?? String(sequence);
  if (entry.type === "message") return parseMessageEntry(entry.data, { id, timestamp, groupKey, sourceSession: session }, channelRoot);
  if (entry.type === "compact") {
    const data = objectValue(entry.data);
    const summary = typeof data?.summary === "string" ? data.summary : undefined;
    return summary ? [{ id, timestamp, kind: "compact", text: summary, groupKey, sourceSession: session }] : [];
  }
  if (entry.type === "event") {
    const event = objectValue(entry.data);
    if (event?.type === "will.decision") {
      return [
        {
          id,
          timestamp,
          kind: "will",
          eventType: "will.decision",
          decision: stringValue(event.decision),
          willDebug: event.debug,
          groupKey,
          sourceSession: session,
        },
      ];
    }
    return [
      {
        id,
        timestamp,
        kind: "event",
        eventType: stringValue(event?.type),
        text: diagnosticText(event),
        error: diagnosticError(event),
        turnId: stringValue(event?.turnId),
        groupKey,
        sourceSession: session,
      },
    ];
  }
  return [];
}

async function parseMessageEntry(
  raw: unknown,
  base: { id: string; timestamp: number; groupKey: string; sourceSession: string },
  channelRoot: string,
): Promise<ConversationEntryView[]> {
  const message = raw as RawMessage;
  if (message.role === "custom") return parseCustomMessage(message, base, channelRoot);
  if (message.role === "user") {
    const text = extractText(message.content);
    return text ? [{ ...base, kind: "user", text }] : [];
  }
  if (message.role === "assistant") {
    const { thoughts, visibleText } = extractAssistantContent(message.content);
    const result: ConversationEntryView[] = [];
    for (const thought of thoughts) {
      result.push({ ...base, id: `${base.id}-thought-${result.length}`, kind: "thought", text: thought });
    }
    if (visibleText) {
      result.push({
        ...base,
        id: `${base.id}-assistant`,
        kind: "assistant",
        text: visibleText,
        usage: message.usage,
        finishReason: stringValue(message.finishReason),
      });
    }
    result.push(...parseToolCalls(message.content, base));
    return result;
  }
  if (message.role === "tool") return parseToolResults(message.content, base);
  return [];
}

async function parseCustomMessage(
  message: RawMessage,
  base: { id: string; timestamp: number; groupKey: string; sourceSession: string },
  channelRoot: string,
): Promise<ConversationEntryView[]> {
  if (message.type === "yesimbot.message") {
    const data = objectValue(message.data);
    const elements = Array.isArray(data?.elements) ? (data.elements as unknown[]) : [];
    const user = objectValue(data?.user);
    const sender = typeof user?.name === "string" ? `${user.name} (${stringValue(user.id) ?? ""})` : stringValue(user?.id);
    const assets = await resolveAssetViews(elements, channelRoot);
    let text = "";
    try {
      text = formatElements(elements as never);
    } catch {
      text = JSON.stringify(elements);
    }
    return [
      {
        ...base,
        kind: "user",
        text,
        sender: sender || undefined,
        assets: assets.length ? assets : undefined,
        messageId: stringValue(data?.messageId),
      },
    ];
  }
  if (message.type === "yesimbot.event") {
    const data = objectValue(message.data);
    return [
      {
        ...base,
        kind: "event",
        eventType: stringValue(data?.eventType),
        text: stringValue(data?.text),
        error: diagnosticError(data),
        sourceSession: base.sourceSession,
      },
    ];
  }
  return [];
}

async function resolveAssetViews(elements: unknown[], channelRoot: string): Promise<ConversationAssetView[]> {
  const result: ConversationAssetView[] = [];
  const visit = async (nodes: unknown[]): Promise<void> => {
    for (const node of nodes) {
      const element = objectValue(node);
      if (!element) continue;
      const attrs = objectValue(element.attrs);
      const id = stringValue(element.id) ?? stringValue(attrs?.id);
      if ((element.type === "img" || element.type === "file") && id && COMPLETE_ASSET_ID.test(id)) {
        const assetPath = safeJoin(join(channelRoot, "assets"), id);
        if (assetPath) {
          try {
            const bytes = await readFile(assetPath);
            const kind: ConversationAssetView["kind"] = element.type === "img" ? "image" : "file";
            const title = stringValue(attrs?.title) ?? stringValue(attrs?.file) ?? stringValue(element.title);
            const mediaType = kind === "image" ? detectImageType(bytes) : "application/octet-stream";
            const dataUrl = bytes.byteLength <= MAX_ASSET_DATA_URL_BYTES ? `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}` : undefined;
            result.push({ id, kind, title, size: bytes.byteLength, dataUrl });
          } catch {
            continue;
          }
        }
      }
      if (Array.isArray(element.children)) await visit(element.children);
    }
  };
  await visit(elements);
  return result;
}

function detectImageType(bytes: Uint8Array): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  )
    return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "image/webp";
  return "application/octet-stream";
}

function parseToolCalls(content: unknown, base: { id: string; timestamp: number; groupKey: string; sourceSession: string }): ConversationEntryView[] {
  if (!Array.isArray(content)) return [];
  const result: ConversationEntryView[] = [];
  for (const part of content) {
    const raw = objectValue(part);
    if (raw?.type !== "tool-call") continue;
    result.push({
      ...base,
      id: `${base.id}-tool-call-${result.length}`,
      kind: "tool-call",
      toolName: stringValue(raw.toolName),
      toolCallId: stringValue(raw.toolCallId),
      args: raw.args ?? raw.input,
    });
  }
  return result;
}

function parseToolResults(content: unknown, base: { id: string; timestamp: number; groupKey: string; sourceSession: string }): ConversationEntryView[] {
  if (!Array.isArray(content)) return [];
  const result: ConversationEntryView[] = [];
  for (const part of content) {
    const raw = objectValue(part);
    if (raw?.type !== "tool-result") continue;
    result.push({
      ...base,
      id: `${base.id}-tool-result-${result.length}`,
      kind: "tool-result",
      toolName: stringValue(raw.toolName),
      toolCallId: stringValue(raw.toolCallId),
      result: raw.output ?? raw.result,
      error: raw.isError ? diagnosticError(raw) : undefined,
    });
  }
  return result;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      const raw = objectValue(part);
      return typeof raw?.text === "string" ? raw.text : "";
    })
    .join("");
}

function extractAssistantContent(content: unknown): { thoughts: string[]; visibleText: string } {
  const thoughts: string[] = [];
  const visibleParts: string[] = [];
  if (typeof content === "string") {
    thoughts.push(...extractThoughts(content));
    const visible = stripInnerThoughts(content);
    if (visible) visibleParts.push(visible);
    return { thoughts, visibleText: visibleParts.join("\n") };
  }
  if (!Array.isArray(content)) return { thoughts, visibleText: "" };
  for (const part of content) {
    if (typeof part === "string") {
      thoughts.push(...extractThoughts(part));
      const visible = stripInnerThoughts(part);
      if (visible) visibleParts.push(visible);
      continue;
    }
    const raw = objectValue(part);
    if (!raw) continue;
    if ((raw.type === "reasoning" || raw.type === "reasoning_text" || raw.type === "thinking") && typeof raw.text === "string" && raw.text.trim()) {
      thoughts.push(raw.text.trim());
      continue;
    }
    if (raw.type === "text" && typeof raw.text === "string") {
      thoughts.push(...extractThoughts(raw.text));
      const visible = stripInnerThoughts(raw.text);
      if (visible) visibleParts.push(visible);
    }
  }
  return { thoughts, visibleText: visibleParts.join("\n") };
}

function extractThoughts(text: string): string[] {
  const result: string[] = [];
  for (const match of text.matchAll(/<inner_thought\b[^>]*>([\s\S]*?)<\/inner_thought\s*>/gi)) {
    const thought = match[1]?.trim();
    if (thought) result.push(thought);
  }
  return result;
}

function stripInnerThoughts(text: string): string {
  return text
    .replace(/<inner_thought\b[^>]*\/>/gi, "")
    .replace(/<inner_thought\b[^>]*>[\s\S]*?<\/inner_thought\s*>/gi, "")
    .trim();
}

function resolveChannelsPath(ctx: Context): string {
  const plugins = flattenPluginConfig(ctx.loader.config.plugins ?? {});
  const coreEntry = Object.entries(plugins).find(([key]) => normalizePluginKey(key) === "yesimbot");
  const raw = coreEntry?.[1] as Record<string, unknown> | undefined;
  const basePath = typeof raw?.basePath === "string" ? raw.basePath : "data/yesimbot";
  return resolve(ctx.baseDir, basePath, "channels");
}

function flattenPluginConfig(plugins: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(plugins)) {
    if (key.startsWith("group:")) {
      if (!value || typeof value !== "object") continue;
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        if (childKey === "$collapsed" || childKey === "$label") continue;
        result[childKey] = childValue;
      }
      continue;
    }
    result[key] = value;
  }
  return result;
}

function normalizePluginKey(key: string): string {
  const bare = key.startsWith("~") ? key.slice(1) : key;
  const instanceIndex = bare.indexOf(":");
  return instanceIndex < 0 ? bare : bare.slice(0, instanceIndex);
}

function safeJoin(root: string, segment: string): string | undefined {
  if (!segment || segment.includes("/") || segment.includes("\\") || segment.includes("..")) return undefined;
  const target = join(root, segment);
  const rel = relative(root, target);
  if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) return undefined;
  return target;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function diagnosticText(value: Record<string, unknown> | undefined): string | undefined {
  const error = objectValue(value?.error);
  return stringValue(error?.message) ?? stringValue(value?.message) ?? stringValue(value?.reason);
}

function diagnosticError(value: Record<string, unknown> | undefined): { name?: string; message?: string } | undefined {
  const error = objectValue(value?.error);
  if (!error) return undefined;
  return {
    name: stringValue(error.name),
    message: stringValue(error.message),
  };
}
