import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { createEntry, createJsonlStorage, type AgentEntry, type AgentStorage } from "@yesimbot/agent-runtime";
import type { LanguageModel } from "ai";

import { executeCompact, filterEntriesForCompression } from "./compact.js";

export type CompactReason = "auto" | "idle" | "manual";
export type CompactResult = { readonly compacted: boolean; readonly reason?: string };
export interface CompactInput {
  readonly model: LanguageModel;
  readonly personaName: string;
  readonly persona: string;
  readonly signal?: AbortSignal;
}
export interface ConversationCompactConfig {
  readonly threshold: number;
  readonly charTokenRatio: number;
  readonly minMessages: number;
  readonly maxFailures: number;
}
export type ConversationInfo = {
  readonly filename: string;
  readonly isActive: boolean;
  readonly size: number;
  readonly createdAt: string;
};
export type ConversationStatus = { readonly active: ConversationInfo | null };

export class Conversation {
  private storageValue: AgentStorage<AgentEntry> | undefined;
  private storagePathValue: string | undefined;
  private failures = 0;
  private memory = "";

  public constructor(
    private readonly root: string,
    private readonly compactConfig: ConversationCompactConfig = {
      threshold: 0.9,
      charTokenRatio: 1.8,
      minMessages: 20,
      maxFailures: 3,
    },
  ) {}

  public get storage(): AgentStorage<AgentEntry> {
    if (!this.storageValue) throw new Error("Conversation has not been initialized");
    return this.storageValue;
  }
  public async init(): Promise<void> {
    if (!this.storageValue) this.setStorage(await this.createOrResolve());
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
  public async switch(id: string): Promise<void> {
    await this.init();
    const filename = id.endsWith(".jsonl") ? id : `${id}.jsonl`;
    if (!/^[0-9A-Za-zTZ_-]+\.jsonl$/.test(filename)) throw new Error("Invalid session id");
    const path = join(this.sessionsPath(), filename);
    await stat(path);
    this.setStorage(path);
  }
  public async archive(noSummary = false, input?: CompactInput): Promise<void> {
    await this.init();
    if ((await this.storage.read()).length === 0) throw new Error("Cannot archive an empty session");
    if (!noSummary && input) await this.compact("manual", input);
    else this.setStorage(await this.createSession());
  }

  public async compact(reason: CompactReason, input: CompactInput): Promise<CompactResult> {
    await this.init();
    if (this.failures >= this.compactConfig.maxFailures) return { compacted: false, reason: "failure_limit" };
    const entries = await this.storage.read();
    const messages = entries.filter((entry) => entry.type === "message");
    if (messages.length < this.compactConfig.minMessages) return { compacted: false, reason: "minimum_messages" };
    const content = filterEntriesForCompression(entries);
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
      const destination = join(this.sessionsPath(), `${formatTimestamp(new Date())}-${randomUUID()}.jsonl`);
      const temporary = `${destination}.tmp`;
      const compact = createEntry("compact", {
        summary,
        lastEntryId: messages.at(-1)!.id,
        sourceSession: basename(this.storagePathValue!, ".jsonl"),
      });
      await mkdir(this.sessionsPath(), { recursive: true });
      await writeFile(temporary, `${JSON.stringify(compact)}\n`, { flag: "wx" });
      await rename(temporary, destination);
      this.memory = summary;
      this.failures = 0;
      this.setStorage(destination);
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
    this.storageValue = createJsonlStorage(path);
  }
  private async createOrResolve(): Promise<string> {
    await mkdir(this.sessionsPath(), { recursive: true });
    const files = await this.files();
    return files.at(-1) ? join(this.sessionsPath(), files.at(-1)!) : this.createSession();
  }
  private async createSession(): Promise<string> {
    await mkdir(this.sessionsPath(), { recursive: true });
    const path = join(this.sessionsPath(), `${formatTimestamp(new Date())}-${randomUUID()}.jsonl`);
    await writeFile(path, "", { flag: "wx" });
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
