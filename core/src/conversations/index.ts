import { randomUUID } from "node:crypto";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { createEntry, createJsonlStorage, type AgentEntry, type AgentStorage } from "@yesimbot/agent-runtime";
import type { LanguageModel, LanguageModelUsage } from "ai";

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
  onUsage?: (usage: LanguageModelUsage) => unknown;
}

export interface ConversationCompactConfig {
  minMessages: number;
  maxFailures: number;
  threshold?: number;
  charTokenRatio?: number;
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
      (await this.files())
        .reverse()
        .map(async (filename) => ({
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
          onUsage: input.onUsage,
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
    const path = join(this.sessionsPath(), `${formatTimestamp(new Date())}-${randomUUID()}.jsonl`);
    const payload = entries.length ? `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n` : "";
    await writeFile(path, payload, { flag: "wx" });
    return path;
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

function formatTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}
