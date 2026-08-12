import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { createEntry, createJsonlStorage, type AgentEntry, type AgentStorage } from "@yesimbot/agent-runtime";
import type { LanguageModel } from "ai";

import type { MessageRecord } from "../messages/index.js";
import { executeCompact, filterEntriesForCompression } from "./compact.js";

export type CompactReason = "auto" | "idle" | "manual";

export type CompactResult = { readonly compacted: boolean; readonly reason?: string };

export type ConversationInfo = { filename: string; isActive: boolean; size: number; createdAt: string };

export type ConversationStatus = { active: ConversationInfo | null };

export interface CompactInput {
  model: LanguageModel;
  personaName: string;
  persona: string;
  signal?: AbortSignal;
}

export interface ConversationCompactConfig {
  minMessages: number;
  maxFailures: number;
  threshold?: number;
  charTokenRatio?: number;
}

export interface ConversationReadOptions {
  messageIds?: string[];
  before?: number;
  after?: number;
  from?: number;
  to?: number;
  userIds?: string[];
  limit?: number;
}

interface ReadMessage {
  readonly record: MessageRecord;
  readonly session: string;
  readonly index: number;
}

interface ReadSession {
  readonly filename: string;
  readonly messages: ReadMessage[];
}

export class Conversation {
  private readonly root: string;
  private readonly compactConfig;
  private storagePathValue: string | undefined;
  private fileStorageValue: AgentStorage<AgentEntry> | undefined;
  private failures = 0;
  private memory = "";

  public constructor(root: string, compactConfig: ConversationCompactConfig = { minMessages: 20, maxFailures: 3 }) {
    this.root = root;
    this.compactConfig = compactConfig;
  }

  public get storage(): AgentStorage<AgentEntry> {
    if (!this.storagePathValue) throw new Error("Conversation has not been initialized");
    return {
      append: (...entries) => this.currentStorage().append(...entries),
      read: () => this.currentStorage().read(),
      clear: () => this.currentStorage().clear(),
    };
  }

  public async init(): Promise<void> {
    if (this.storagePathValue) return;
    this.setStorage(await this.createOrResolve());
    await this.restoreMemory();
  }

  public async list(): Promise<ConversationInfo[]> {
    const active = this.storagePathValue;
    return Promise.all(
      (await this.files()).reverse().map(async (filename) => ({
        filename,
        isActive: join(this.sessionsPath(), filename) === active,
        size: (await stat(join(this.sessionsPath(), filename))).size,
        createdAt: basename(filename, ".jsonl"),
      })),
    );
  }

  public async status(): Promise<ConversationStatus> {
    return { active: (await this.list()).find((item) => item.isActive) ?? null };
  }

  public failuresCount(): number {
    return this.failures;
  }

  public async switch(id: string): Promise<void> {
    await this.init();
    const filename = id.endsWith(".jsonl") ? id : `${id}.jsonl`;
    if (!/^[0-9A-Za-zTZ_-]+\.jsonl$/.test(filename)) throw new Error("Invalid session id");
    const path = join(this.sessionsPath(), filename);
    await stat(path);
    this.setStorage(path);
    await this.restoreMemory();
  }

  public async archive(noSummary = false, input?: CompactInput): Promise<void> {
    await this.init();
    if ((await this.storage.read()).length === 0) throw new Error("Cannot archive an empty session");
    if (!noSummary && input) {
      const result = await this.compact("manual", input);
      if (result.compacted) {
        const compact = [...(await this.storage.read())].reverse().find((entry) => entry.type === "compact");
        this.setStorage(await this.createSession(compact ? [compact] : []));
        return;
      }
    }
    this.setStorage(await this.createSession());
  }

  public async archiveIfOversize(maxBytes: number, input?: CompactInput): Promise<boolean> {
    await this.init();
    if (maxBytes <= 0) return false;
    const active = (await this.status()).active;
    if (!active || active.size <= maxBytes) return false;
    const compact = [...(await this.storage.read())].reverse().find((entry) => entry.type === "compact");
    if (compact?.type === "compact") {
      this.setStorage(await this.createSession([compact]));
    } else {
      await this.archive(!input, input);
    }
    return true;
  }

  public async compact(reason: CompactReason, input: CompactInput): Promise<CompactResult> {
    await this.init();
    if (this.failures >= this.compactConfig.maxFailures) return { compacted: false, reason: "failure_limit" };
    const entries = await this.storage.read();
    const lastCompactIndex = entries.reduce((last, entry, index) => (entry.type === "compact" ? index : last), -1);
    const sourceEntries = lastCompactIndex === -1 ? entries : entries.slice(lastCompactIndex + 1);
    const messages = sourceEntries.filter((entry) => entry.type === "message");
    if (messages.length < this.compactConfig.minMessages) return { compacted: false, reason: "minimum_messages" };
    const content = filterEntriesForCompression(sourceEntries);
    if (!content) return { compacted: false, reason: "empty_input" };
    try {
      const summary = (
        await executeCompact({
          model: input.model,
          personaName: input.personaName,
          persona: input.persona,
          previousMemory: this.memory,
          conversation: content,
          signal: input.signal,
        })
      ).slice(0, 30_000);
      if (!summary) {
        this.failures += 1;
        return { compacted: false, reason: "empty_summary" };
      }
      const compact = createEntry("compact", { summary, lastEntryId: messages.at(-1)!.id, sourceSession: basename(this.storagePathValue!, ".jsonl") });
      await this.storage.append(compact);
      this.memory = summary;
      this.failures = 0;
      return { compacted: true };
    } catch (cause) {
      this.failures += 1;
      if (input.signal?.aborted) throw cause;
      return {
        compacted: false,
        reason: cause instanceof Error && cause.message === "Compaction produced an empty summary." ? "empty_summary" : "model_failure",
      };
    }
  }

  public async read(options: ConversationReadOptions = {}): Promise<MessageRecord[]> {
    validateReadOptions(options);
    const sessions: ReadSession[] = [];
    const sourceMatches = new Map<string, ReadMessage[]>();

    for (const filename of await this.files()) {
      const messages: ReadMessage[] = [];
      for (const entry of await createJsonlStorage(join(this.sessionsPath(), filename)).read()) {
        if (entry.type !== "message" || !isPlatformMessage(entry.data)) continue;
        messages.push({ record: { ...entry.data.data, timestamp: entry.data.timestamp }, session: filename, index: messages.length });
      }
      sessions.push({ filename, messages });
      for (const message of messages) {
        if (!options.messageIds?.includes(message.record.messageId)) continue;
        const matches = sourceMatches.get(message.record.messageId) ?? [];
        matches.push(message);
        sourceMatches.set(message.record.messageId, matches);
      }
    }

    const sourceIds = options.messageIds ?? [];
    for (const sourceId of sourceIds) {
      const matches = sourceMatches.get(sourceId) ?? [];
      if (matches.length !== 1)
        throw new Error(`Conversation source message ID ${JSON.stringify(sourceId)} ${matches.length ? "is duplicated" : "is missing"}`);
    }

    const selected = sourceIds.length ? selectSourceWindows(sessions, sourceMatches, options) : sessions.flatMap(({ messages }) => messages);
    const filtered = selected.filter((message) => matchesReadFilter(message.record, options));
    const limited = sourceIds.length ? limitSourceMessages(filtered, sourceMatches, options.limit) : limitNewestMessages(filtered, options.limit);
    return limited.sort((left, right) => left.record.timestamp - right.record.timestamp).map(({ record }) => record);
  }

  private setStorage(path: string): void {
    this.storagePathValue = path;
    this.fileStorageValue = createJsonlStorage(path);
  }

  private currentStorage(): AgentStorage<AgentEntry> {
    if (!this.fileStorageValue) throw new Error("Conversation has not been initialized");
    return this.fileStorageValue;
  }

  private async restoreMemory(): Promise<void> {
    const compact = [...(await this.storage.read())].reverse().find((entry) => entry.type === "compact");
    this.memory = compact?.type === "compact" ? compact.data.summary : "";
  }

  private async createOrResolve(): Promise<string> {
    await mkdir(this.sessionsPath(), { recursive: true });
    const files = await this.files();
    return files.at(-1) ? join(this.sessionsPath(), files.at(-1)!) : this.createSession();
  }

  private async createSession(entries: readonly AgentEntry[] = []): Promise<string> {
    await mkdir(this.sessionsPath(), { recursive: true });
    const payload = entries.length ? `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n` : "";
    for (;;) {
      const path = join(this.sessionsPath(), `${formatTimestamp(new Date())}.jsonl`);
      try {
        await writeFile(path, payload, { flag: "wx" });
        return path;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
      }
    }
  }

  private async files(): Promise<string[]> {
    try {
      return (await readdir(this.sessionsPath())).filter((name) => name.endsWith(".jsonl") && name !== "messages.jsonl").sort();
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw cause;
    }
  }

  private sessionsPath(): string {
    return join(this.root, "sessions");
  }
}

function validateReadOptions(options: ConversationReadOptions): void {
  for (const name of ["before", "after"] as const) {
    const value = options[name];
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) throw new Error(`Conversation read ${name} must be a non-negative integer`);
  }
  if (options.from !== undefined && !Number.isFinite(options.from)) throw new Error("Conversation read from must be a finite timestamp");
  if (options.to !== undefined && !Number.isFinite(options.to)) throw new Error("Conversation read to must be a finite timestamp");
  if (options.from !== undefined && options.to !== undefined && options.from > options.to) throw new Error("Conversation read from must not exceed to");
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit <= 0))
    throw new Error("Conversation read limit must be a positive integer");
}

function selectSourceWindows(
  sessions: readonly ReadSession[],
  matches: ReadonlyMap<string, readonly ReadMessage[]>,
  options: ConversationReadOptions,
): ReadMessage[] {
  const selected = new Map<string, ReadMessage>();
  const before = options.before ?? 0;
  const after = options.after ?? 0;
  for (const source of matches.values()) {
    const message = source[0]!;
    const session = sessions.find(({ filename }) => filename === message.session)!;
    const start = Math.max(0, message.index - before);
    const end = Math.min(session.messages.length, message.index + after + 1);
    for (const nearby of session.messages.slice(start, end)) selected.set(readMessageKey(nearby), nearby);
  }
  return [...selected.values()];
}

function matchesReadFilter(record: MessageRecord, options: ConversationReadOptions): boolean {
  return (
    (options.from === undefined || record.timestamp >= options.from) &&
    (options.to === undefined || record.timestamp <= options.to) &&
    (options.userIds === undefined || options.userIds.includes(record.user.id))
  );
}

function limitSourceMessages(messages: readonly ReadMessage[], matches: ReadonlyMap<string, readonly ReadMessage[]>, limit: number | undefined): ReadMessage[] {
  if (limit === undefined) return [...messages];
  const sourceKeys = new Set([...matches.values()].map(([message]) => readMessageKey(message!)));
  const sources = messages.filter((message) => sourceKeys.has(readMessageKey(message)));
  if (sources.length >= limit) return sources;
  const distance = (message: ReadMessage) =>
    Math.min(...sources.filter((source) => source.session === message.session).map((source) => Math.abs(source.index - message.index)));
  return [
    ...sources,
    ...messages
      .filter((message) => !sourceKeys.has(readMessageKey(message)))
      .sort((left, right) => distance(left) - distance(right) || left.record.timestamp - right.record.timestamp)
      .slice(0, limit - sources.length),
  ];
}

function limitNewestMessages(messages: readonly ReadMessage[], limit: number | undefined): ReadMessage[] {
  if (limit === undefined) return [...messages];
  return [...messages].sort((left, right) => right.record.timestamp - left.record.timestamp).slice(0, limit);
}

function readMessageKey(message: ReadMessage): string {
  const { platform, selfId, channel, messageId } = message.record;
  return `${platform}\u0000${selfId}\u0000${channel.id}\u0000${messageId}`;
}

function isPlatformMessage(value: AgentEntry["data"]): value is {
  readonly role: "custom";
  readonly id: string;
  readonly type: "yesimbot.message";
  readonly timestamp: number;
  readonly data: Omit<MessageRecord, "timestamp">;
} {
  return typeof value === "object" && value !== null && "role" in value && value.role === "custom" && "type" in value && value.type === "yesimbot.message";
}

function formatTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}
