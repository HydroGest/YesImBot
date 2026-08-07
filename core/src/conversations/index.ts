import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { createEntry, createJsonlStorage, type AgentEntry, type AgentStorage } from "@yesimbot/agent-runtime";

export type CompactReason = "auto" | "idle" | "manual";
export type CompactResult = { readonly compacted: boolean };
export type ConversationInfo = { readonly filename: string; readonly isActive: boolean; readonly size: number; readonly createdAt: string };
export type ConversationStatus = { readonly active: ConversationInfo | null };

export class Conversation {
  private storageValue: AgentStorage<AgentEntry> | undefined;
  private storagePathValue: string | undefined;

  public constructor(private readonly root: string) {}

  public get storage(): AgentStorage<AgentEntry> {
    if (!this.storageValue) throw new Error("Conversation has not been initialized");
    return this.storageValue;
  }

  public async init(): Promise<void> {
    if (this.storageValue) return;
    this.setStorage(await this.createOrResolve());
  }

  public async list(): Promise<ConversationInfo[]> {
    const active = this.storagePathValue;
    return Promise.all((await this.files()).reverse().map(async (filename) => ({
      filename,
      isActive: join(this.sessionsPath(), filename) === active,
      size: (await stat(join(this.sessionsPath(), filename))).size,
      createdAt: basename(filename, ".jsonl"),
    })));
  }

  public async status(): Promise<ConversationStatus> {
    return { active: (await this.list()).find((item) => item.isActive) ?? null };
  }

  public async switch(id: string): Promise<void> {
    await this.init();
    const filename = id.endsWith(".jsonl") ? id : `${id}.jsonl`;
    if (!/^[0-9TZ-]+\.jsonl$/.test(filename)) throw new Error("Invalid session id");
    const path = join(this.sessionsPath(), filename);
    await stat(path);
    this.setStorage(path);
  }

  public async archive(): Promise<void> {
    await this.init();
    if ((await this.storage.read()).length === 0) throw new Error("Cannot archive an empty session");
    this.setStorage(await this.createSession());
  }

  public async compact(_reason: CompactReason): Promise<CompactResult> {
    await this.init();
    const messages = (await this.storage.read()).filter((entry) => entry.type === "message");
    if (messages.length < 2) return { compacted: false };
    const summary = messages.slice(0, -1).map(summarizeEntry).filter((value): value is string => value !== undefined).join("\n");
    if (!summary) return { compacted: false };
    const destination = join(this.sessionsPath(), `${formatTimestamp(new Date())}-${randomUUID()}.jsonl`);
    const temporary = `${destination}.tmp`;
    const compact = createEntry("compact", { summary, lastEntryId: messages.at(-1)!.id, sourceSession: basename(this.storagePathValue!, ".jsonl") });
    await mkdir(this.sessionsPath(), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(compact)}\n`, { flag: "wx" });
    await rename(temporary, destination);
    this.setStorage(destination);
    return { compacted: true };
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
    try { return (await readdir(this.sessionsPath())).filter((name) => name.endsWith(".jsonl") && name !== "messages.jsonl").sort(); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return []; throw cause; }
  }

  private sessionsPath(): string { return join(this.root, "sessions"); }
}

function formatTimestamp(date: Date): string { return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
function summarizeEntry(entry: AgentEntry): string | undefined { const data = entry.data as { content?: unknown }; return entry.type === "message" && typeof data.content === "string" ? data.content : undefined; }
