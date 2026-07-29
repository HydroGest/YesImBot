import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";


import { deriveMemosImportChunkIdentity } from "../src/identity.js";
import type { MemosAddMessageRequest, MemosMessage } from "../src/types.js";

const DEFAULT_MEMOS_BASE_URL = "https://memos.memtensor.cn/api/openmem/v1";
const DEFAULT_MAX_TOKENS = 16000;
const DEFAULT_MAX_MESSAGES = 400;
const DEFAULT_MAX_HOURS = 168;
const DEFAULT_OVERLAP_MESSAGES = 0;
const PLATFORM = "onebot";

type QqConversationType = "group" | "private";
type QqImportRole = "user" | "assistant";

interface RawQqExport {
  chatInfo: RawChatInfo;
  statistics: unknown;
  messages: RawMessage[];
  exportOptions: unknown;
}

interface RawChatInfo {
  name?: string;
  type?: string;
  channelId?: string;
  groupUin?: string;
  uin?: string;
}

interface RawMessage {
  id?: string;
  seq?: string;
  timestamp?: number | string;
  sender?: RawSender;
  type?: string;
  content?: RawContent;
  recalled?: boolean;
  system?: boolean;
}

interface RawSender {
  uid?: string;
  uin?: string;
  name?: string;
  nickname?: string;
  remark?: string;
  groupCard?: string;
}

interface RawContent {
  text?: string;
  elements?: RawElement[];
  resources?: RawResource[];
  mentions?: RawMention[];
}

interface RawElement {
  type?: string;
  data?: Record<string, unknown>;
}

interface RawResource {
  url?: string;
  filename?: string;
}

interface RawMention {
  uid?: string;
}

interface ParsedMessage {
  role: QqImportRole | "system";
  messageId: string;
  timestampMs: number;
  senderId: string;
  senderName: string;
  text: string;
  system: boolean;
  recalled: boolean;
  elementTypes: string[];
  resources: string[];
  conversationType: QqConversationType;
  channelId: string;
  sourceFileName: string;
}

type ImportMessage = MemosMessage & {
  role: "system" | "user" | "assistant";
  chat_time: string;
};

type ImportAddMessageRequest = MemosAddMessageRequest & {
  agent_id: string;
  messages: ImportMessage[];
  tags: string[];
  info: Record<string, unknown>;
  source: string;
  async_mode: boolean;
};

export interface QqMemosImportConfig {
  input: string;
  botSelfId: string;
  dryRun?: boolean;
  debug?: boolean;
  maxTokens?: number;
  maxMessages?: number;
  maxHours?: number;
  overlapMessages?: number;
  asyncMode?: boolean;
  baseUrl?: string;
  apiKey?: string;
}

export interface QqMemosImportChunk {
  id: string;
  conversationType: QqConversationType;
  channelId: string;
  startTime: string;
  endTime: string;
  importedMessageCount: number;
  estimatedTokens: number;
  request: ImportAddMessageRequest;
}

export interface QqMemosImportPlan {
  inputFileCount: number;
  parsedMessageCount: number;
  importedMessageCount: number;
  filteredMessageCount: number;
  duplicateMessageCount: number;
  chunks: QqMemosImportChunk[];
  defaults: {
    maxTokens: number;
    maxMessages: number;
    maxHours: number;
    overlapMessages: number;
  };
}

interface CliRuntime {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

interface ParsedArgs {
  input?: string;
  botSelfId?: string;
  dryRun: boolean;
  debug: boolean;
  maxTokens: number;
  maxMessages: number;
  maxHours: number;
  overlapMessages: number;
  asyncMode: boolean;
  baseUrl?: string;
}

function parseBoolean(value: string, flagName: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${flagName} must be true or false`);
}

function requireValue(value: string | undefined, flagName: string): string {
  if (value?.trim()) return value;
  throw new Error(`Missing required ${flagName}`);
}

function parsePositiveInteger(value: string | undefined, flagName: string): number {
  const parsed = Number.parseInt(requireValue(value, flagName), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string | undefined, flagName: string): number {
  const parsed = Number.parseInt(requireValue(value, flagName), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flagName} must be a non-negative integer`);
  }
  return parsed;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    dryRun: false,
    debug: false,
    maxTokens: DEFAULT_MAX_TOKENS,
    maxMessages: DEFAULT_MAX_MESSAGES,
    maxHours: DEFAULT_MAX_HOURS,
    overlapMessages: DEFAULT_OVERLAP_MESSAGES,
    asyncMode: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--input":
        parsed.input = requireValue(argv[index + 1], "--input");
        index += 1;
        break;
      case "--bot-self-id":
        parsed.botSelfId = requireValue(argv[index + 1], "--bot-self-id");
        index += 1;
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--debug":
        parsed.debug = true;
        break;
      case "--max-tokens":
        parsed.maxTokens = parsePositiveInteger(argv[index + 1], "--max-tokens");
        index += 1;
        break;
      case "--max-messages":
        parsed.maxMessages = parsePositiveInteger(argv[index + 1], "--max-messages");
        index += 1;
        break;
      case "--max-hours":
        parsed.maxHours = parsePositiveInteger(argv[index + 1], "--max-hours");
        index += 1;
        break;
      case "--overlap-messages":
        parsed.overlapMessages = parseNonNegativeInteger(argv[index + 1], "--overlap-messages");
        index += 1;
        break;
      case "--async-mode":
        parsed.asyncMode = parseBoolean(
          requireValue(argv[index + 1], "--async-mode"),
          "--async-mode",
        );
        index += 1;
        break;
      case "--base-url":
        parsed.baseUrl = requireValue(argv[index + 1], "--base-url");
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!parsed.input) throw new Error("Missing required --input");
  if (!parsed.botSelfId) throw new Error("Missing required --bot-self-id");
  if (parsed.overlapMessages >= parsed.maxMessages) {
    throw new Error("--overlap-messages must be smaller than --max-messages");
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRawQqExport(value: unknown): value is RawQqExport {
  return (
    isRecord(value) &&
    isRecord(value.chatInfo) &&
    "statistics" in value &&
    Array.isArray(value.messages) &&
    isRecord(value.exportOptions)
  );
}

function normalizeConversationType(value: unknown): QqConversationType {
  if (value === "group" || value === "private") return value;
  throw new Error(`Unsupported QQ conversation type: ${String(value)}`);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function inferGroupChannelId(fileName: string, chatInfo: RawChatInfo): string | undefined {
  return (
    fileName.match(/\(([^()]+)\)(?:_[^.]*)?\.json$/u)?.[1] ??
    readString(chatInfo.channelId) ??
    readString(chatInfo.groupUin) ??
    readString(chatInfo.uin)
  );
}

function inferPrivateChannelId(
  messages: RawMessage[],
  botSelfId: string,
  chatInfo: RawChatInfo,
): string | undefined {
  for (const message of messages) {
    const senderId = readString(message.sender?.uin);
    if (senderId && senderId !== botSelfId) return senderId;
  }
  return readString(chatInfo.channelId) ?? readString(chatInfo.uin);
}

function inferChannelId(
  filePath: string,
  conversationType: QqConversationType,
  chatInfo: RawChatInfo,
  messages: RawMessage[],
  botSelfId: string,
): string {
  const fileName = basename(filePath);
  const channelId =
    conversationType === "group"
      ? inferGroupChannelId(fileName, chatInfo)
      : `private:${inferPrivateChannelId(messages, botSelfId, chatInfo)}`;
  if (!channelId) throw new Error(`Unable to infer QQ channel id for ${fileName}`);
  return channelId;
}

function getElementText(element: RawElement): string | undefined {
  if (element.type !== "text" && element.type !== "reply") return undefined;
  const text = readString(element.data?.text);
  return text ?? readString(element.data?.content);
}

function normalizeText(content?: RawContent): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  const push = (value?: string): void => {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    parts.push(trimmed);
  };

  push(content?.text);
  for (const element of content?.elements ?? []) {
    push(getElementText(element));
  }
  return parts.join("\n");
}

function normalizeResources(content?: RawContent): string[] {
  const values = new Set<string>();
  for (const resource of content?.resources ?? []) {
    const value = readString(resource.url) ?? readString(resource.filename);
    if (value) values.add(value);
  }
  return [...values];
}

function getTimestampMs(timestamp: number | string | undefined): number {
  if (typeof timestamp === "number")
    return timestamp >= 1_000_000_000_000 ? timestamp : timestamp * 1000;
  const trimmed = timestamp?.trim();
  if (!trimmed) throw new Error("QQ message timestamp is missing");
  if (/^\d+$/u.test(trimmed)) {
    const numeric = Number(trimmed);
    return numeric >= 1_000_000_000_000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid QQ message timestamp: ${trimmed}`);
  return parsed;
}

function getSenderName(sender: RawSender | undefined): string {
  return (
    readString(sender?.groupCard) ??
    readString(sender?.remark) ??
    readString(sender?.nickname) ??
    readString(sender?.name) ??
    readString(sender?.uin) ??
    readString(sender?.uid) ??
    "Unknown"
  );
}

function normalizeMessage(
  message: RawMessage,
  index: number,
  filePath: string,
  conversationType: QqConversationType,
  channelId: string,
  botSelfId: string,
): ParsedMessage {
  const senderId = readString(message.sender?.uin) ?? readString(message.sender?.uid) ?? "unknown";
  const system = Boolean(message.system);
  return {
    role: system ? "system" : senderId === botSelfId ? "assistant" : "user",
    messageId: readString(message.id) ?? `${basename(filePath)}:${index}`,
    timestampMs: getTimestampMs(message.timestamp),
    senderId,
    senderName: getSenderName(message.sender),
    text: normalizeText(message.content),
    system,
    recalled: Boolean(message.recalled),
    elementTypes: (message.content?.elements ?? [])
      .map((element) => element.type)
      .filter((type): type is string => typeof type === "string" && type.length > 0),
    resources: normalizeResources(message.content),
    conversationType,
    channelId,
    sourceFileName: basename(filePath),
  };
}

async function parseQqExportFile(filePath: string, botSelfId: string): Promise<ParsedMessage[]> {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!isRawQqExport(parsed)) throw new Error(`Unsupported QQ export shape: ${basename(filePath)}`);
  const conversationType = normalizeConversationType(parsed.chatInfo.type);
  const channelId = inferChannelId(
    filePath,
    conversationType,
    parsed.chatInfo,
    parsed.messages,
    botSelfId,
  );
  return parsed.messages.map((message, index) =>
    normalizeMessage(message, index, filePath, conversationType, channelId, botSelfId),
  );
}

async function discoverInputFiles(input: string): Promise<string[]> {
  const inputStat = await stat(input);
  if (inputStat.isFile()) {
    if (!input.toLocaleLowerCase().endsWith(".json"))
      throw new Error("--input file must be a JSON file");
    return [input];
  }
  if (!inputStat.isDirectory()) throw new Error("--input must be a JSON file or directory");
  const entries = await readdir(input, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLocaleLowerCase().endsWith(".json"))
    .map((entry) => join(input, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function shouldImportMessage(message: ParsedMessage): boolean {
  if (message.system || message.role === "system") return false;
  const hasText = message.text.trim().length > 0;
  if (message.recalled && !hasText) return false;
  if (hasText) return true;
  return false;
}

function hashText(value: string): string {
  return createHash("sha256")
    .update(value.trim().replace(/\s+/gu, " ").toLocaleLowerCase())
    .digest("hex")
    .slice(0, 16);
}

function conversationKey(message: ParsedMessage): string {
  return `${message.conversationType}:${message.channelId}`;
}

function dedupeMessages(messages: ParsedMessage[]): {
  messages: ParsedMessage[];
  duplicates: number;
} {
  const seenPrimary = new Set<string>();
  const seenFallback = new Set<string>();
  const kept: ParsedMessage[] = [];
  let duplicates = 0;

  for (const message of messages) {
    const key = conversationKey(message);
    const primary = `${key}|id|${message.messageId}`;
    const fallback = `${key}|fallback|${message.timestampMs}|${message.senderId}|${hashText(message.text)}`;
    if (seenPrimary.has(primary) || seenFallback.has(fallback)) {
      duplicates += 1;
      continue;
    }
    seenPrimary.add(primary);
    seenFallback.add(fallback);
    kept.push(message);
  }

  return { messages: kept, duplicates };
}

function formatChatTime(timestampMs: number): string {
  const date = new Date(timestampMs);
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  const hours = `${date.getUTCHours()}`.padStart(2, "0");
  const minutes = `${date.getUTCMinutes()}`.padStart(2, "0");
  const seconds = `${date.getUTCSeconds()}`.padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 2);
}

function estimateRequestTokens(messages: ImportMessage[]): number {
  return messages.reduce(
    (total, message) =>
      total + estimateTokens(`${message.role}\n${message.content}\n${message.chat_time}`),
    0,
  );
}

function createChunk(
  messages: ParsedMessage[],
  chunkIndex: number,
  config: Required<Pick<QqMemosImportConfig, "botSelfId" | "asyncMode">>,
): QqMemosImportChunk {
  const first = messages[0];
  const last = messages[messages.length - 1];
  if (!first || !last) throw new Error("Cannot create an empty import chunk");
  const startChatTime = formatChatTime(first.timestampMs);
  const endChatTime = formatChatTime(last.timestampMs);
  const startTime = new Date(first.timestampMs).toISOString();
  const endTime = new Date(last.timestampMs).toISOString();
  const channelScope = {
    platform: PLATFORM,
    selfId: config.botSelfId,
    channelId: first.channelId,
    isDirect: first.conversationType === "private",
  };
  const identity = deriveMemosImportChunkIdentity({
    channelScope,
    channelType: first.conversationType,
    chunkStartIso: startTime,
    chunkEndIso: endTime,
    firstMessageId: first.messageId,
    lastMessageId: last.messageId,
    chunkIndex,
  });
  const sourceFileCount = new Set(messages.map((message) => message.sourceFileName)).size;

  let systemMessage: ImportMessage;
  if (first.conversationType === "private") {
    systemMessage = {
      role: "system",
      chat_time: startChatTime,
      content: [
        `这是助手(${config.botSelfId})与用户(${first.senderName} / ${first.senderId})之间的一段私聊对话记录`,
        "消息记录以 `<senderName>(<senderId>): <messageText>` 的格式呈现",
        `平台标识符：${PLATFORM}`,
        `频道 ID：${first.channelId}`,
        `时间范围：${startChatTime} 至 ${endChatTime}`,
        `来源文件数：${sourceFileCount}`,
        `消息数量：${messages.length}`,
      ].join("\n"),
    };
  } else {
    systemMessage = {
      role: "system",
      chat_time: startChatTime,
      content: [
        `这是一段有多个参与者的群聊对话记录，助手(${config.botSelfId})是群聊中的一名成员`,
        "消息记录以 `<senderName>(<senderId>): <messageText>` 的格式呈现",
        `平台标识符：${PLATFORM}`,
        `频道 ID：${first.channelId}`,
        `时间范围：${startChatTime} 至 ${endChatTime}`,
        `来源文件数：${sourceFileCount}`,
        `消息数量：${messages.length}`,
      ].join("\n"),
    };
  }
  const importMessages = messages.map((message) => ({
    role: message.role as QqImportRole,
    content: `${message.senderName}(${message.senderId}): ${message.text}`,
    chat_time: formatChatTime(message.timestampMs),
  }));
  const request: ImportAddMessageRequest = {
    messages: [systemMessage, ...importMessages],
    user_id: identity.userId,
    conversation_id: identity.conversationId,
    agent_id: identity.agentId,
    tags: ["yesimbot", "qq_import", "trusted_source"],
    info: {
      import_source: "qq_chat",
      importer: "qq-memos-import",
      ...identity.info,
      source_file_count: sourceFileCount,
      start_time: startTime,
      end_time: endTime,
    },
    source: "yesimbot.qq_import",
    async_mode: config.asyncMode,
  };

  return {
    id: `${first.channelId}_${new Date(first.timestampMs).toISOString().slice(0, 10)}_${chunkIndex + 1}`,
    conversationType: first.conversationType,
    channelId: first.channelId,
    startTime,
    endTime,
    importedMessageCount: messages.length,
    estimatedTokens: estimateRequestTokens(request.messages),
    request,
  };
}

function compareMessages(left: ParsedMessage, right: ParsedMessage): number {
  return left.timestampMs - right.timestampMs || left.messageId.localeCompare(right.messageId);
}

function shouldSplitChunk(
  current: ParsedMessage[],
  next: ParsedMessage,
  options: {
    maxMessages: number;
    maxTokens: number;
    maxHours: number;
    botSelfId: string;
    asyncMode: boolean;
  },
): boolean {
  if (current.length === 0) return false;
  if (current.length + 1 > options.maxMessages) return true;
  const first = current[0];
  if (first && next.timestampMs - first.timestampMs > options.maxHours * 60 * 60 * 1000)
    return true;
  return (
    createChunk([...current, next], 0, {
      botSelfId: options.botSelfId,
      asyncMode: options.asyncMode,
    }).estimatedTokens > options.maxTokens
  );
}

function createChunks(
  messages: ParsedMessage[],
  config: Required<Pick<QqMemosImportConfig, "botSelfId" | "asyncMode">> & {
    maxTokens: number;
    maxMessages: number;
    maxHours: number;
    overlapMessages: number;
  },
): QqMemosImportChunk[] {
  const grouped = new Map<string, ParsedMessage[]>();
  for (const message of messages) {
    const key = conversationKey(message);
    grouped.set(key, [...(grouped.get(key) ?? []), message]);
  }

  const chunks: QqMemosImportChunk[] = [];
  for (const key of [...grouped.keys()].sort()) {
    const conversationMessages = [...(grouped.get(key) ?? [])].sort(compareMessages);
    let current: ParsedMessage[] = [];
    for (const message of conversationMessages) {
      if (shouldSplitChunk(current, message, config)) {
        chunks.push(createChunk(current, chunks.length, config));
        current = config.overlapMessages > 0 ? current.slice(-config.overlapMessages) : [];
      }
      current.push(message);
    }
    if (current.length > 0) chunks.push(createChunk(current, chunks.length, config));
  }
  return chunks;
}

export async function buildQqMemosImportPlan(
  config: QqMemosImportConfig,
): Promise<QqMemosImportPlan> {
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  const maxMessages = config.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const maxHours = config.maxHours ?? DEFAULT_MAX_HOURS;
  const overlapMessages = config.overlapMessages ?? DEFAULT_OVERLAP_MESSAGES;
  const asyncMode = config.asyncMode ?? true;
  if (overlapMessages >= maxMessages) {
    throw new Error("overlapMessages must be smaller than maxMessages");
  }

  const inputFiles = await discoverInputFiles(config.input);
  const parsedMessages = (
    await Promise.all(inputFiles.map((file) => parseQqExportFile(file, config.botSelfId)))
  ).flat();
  const deduped = dedupeMessages(parsedMessages);
  const importable = deduped.messages.filter(shouldImportMessage);
  const chunks = createChunks(importable, {
    botSelfId: config.botSelfId,
    asyncMode,
    maxTokens,
    maxMessages,
    maxHours,
    overlapMessages,
  });

  return {
    inputFileCount: inputFiles.length,
    parsedMessageCount: parsedMessages.length,
    importedMessageCount: importable.length,
    filteredMessageCount: parsedMessages.length - importable.length - deduped.duplicates,
    duplicateMessageCount: deduped.duplicates,
    chunks,
    defaults: {
      maxTokens,
      maxMessages,
      maxHours,
      overlapMessages,
    },
  };
}

function createSummary(plan: QqMemosImportPlan, dryRun: boolean, committed = 0) {
  return {
    dryRun,
    files: plan.inputFileCount,
    chunks: plan.chunks.length,
    committed,
    messages: {
      parsed: plan.parsedMessageCount,
      imported: plan.importedMessageCount,
      filtered: plan.filteredMessageCount,
      duplicates: plan.duplicateMessageCount,
    },
    defaults: plan.defaults,
  };
}

function debugLog(enabled: boolean, stderr: (line: string) => void, message: string): void {
  if (enabled) stderr(`[qq-memos-import] ${message}`);
}

function sanitizeErrorMessage(message: string, apiKey: string): string {
  return message.replaceAll(`Token ${apiKey}`, "Token [REDACTED]").replaceAll(apiKey, "[REDACTED]");
}

async function postMemosRequest(
  request: ImportAddMessageRequest,
  options: { baseUrl: string; apiKey: string; fetch: typeof fetch },
): Promise<void> {
  const response = await options.fetch(`${options.baseUrl.replace(/\/+$/u, "")}/add/message`, {
    method: "POST",
    headers: new Headers({
      Authorization: `Token ${options.apiKey}`,
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(request),
  });
  const responseText = await response.text();
  let parsed: { code?: number; message?: string } = {};
  if (responseText.trim()) parsed = JSON.parse(responseText) as { code?: number; message?: string };
  if (!response.ok || parsed.code !== 0) {
    const reason = parsed.message ?? response.statusText;
    throw new Error(`MemOS add_message failed: ${sanitizeErrorMessage(reason, options.apiKey)}`);
  }
}

export async function runQqMemosImportCli(argv: string[], runtime: CliRuntime = {}): Promise<void> {
  const env = runtime.env ?? process.env;
  const stdout = runtime.stdout ?? ((line: string) => console.log(line));
  const stderr = runtime.stderr ?? ((line: string) => console.error(line));
  const parsed = parseArgs(argv);
  const baseUrl = parsed.baseUrl ?? env.MEMOS_BASE_URL ?? DEFAULT_MEMOS_BASE_URL;
  const plan = await buildQqMemosImportPlan({
    input: parsed.input!,
    botSelfId: parsed.botSelfId!,
    dryRun: parsed.dryRun,
    debug: parsed.debug,
    maxTokens: parsed.maxTokens,
    maxMessages: parsed.maxMessages,
    maxHours: parsed.maxHours,
    overlapMessages: parsed.overlapMessages,
    asyncMode: parsed.asyncMode,
    baseUrl,
  });

  debugLog(
    parsed.debug,
    stderr,
    `dryRun=${parsed.dryRun} files=${plan.inputFileCount} chunks=${plan.chunks.length} parsed=${plan.parsedMessageCount} imported=${plan.importedMessageCount} filtered=${plan.filteredMessageCount}`,
  );

  if (parsed.dryRun) {
    stdout(JSON.stringify(createSummary(plan, true), null, 2));
    stdout(JSON.stringify(plan.chunks.at(4)?.request, null, 2));
    return;
  }

  const apiKey = env.MEMOS_API_KEY;
  if (!apiKey?.trim()) throw new Error("Missing required MEMOS_API_KEY environment variable");
  const requestFetch = runtime.fetch ?? fetch;
  let committed = 0;
  for (const chunk of plan.chunks) {
    await postMemosRequest(chunk.request, { baseUrl, apiKey, fetch: requestFetch });
    committed += 1;
  }
  stdout(JSON.stringify(createSummary(plan, false, committed), null, 2));
}

async function main(): Promise<void> {
  await runQqMemosImportCli(process.argv.slice(2));
}

const entryFileName = process.argv[1] ? basename(process.argv[1]) : "";

if (entryFileName === "qq-memos-import.ts" || entryFileName === "qq-memos-import.js") {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
