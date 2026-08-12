import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { MessageRecord } from "koishi-plugin-yesimbot";

import type { MemoryEvidence } from "../types.js";

export class EvidenceStore {
  private tail: Promise<void> = Promise.resolve();

  public constructor(private readonly root: string) {}

  public read(memoryId: string): Promise<MessageRecord[]> {
    return this.serialize(async () => (await this.readEvidence(memoryId)).messages);
  }

  public append(memoryId: string, messages: readonly MessageRecord[]): Promise<void> {
    return this.serialize(async () => {
      const existing = await this.readEvidence(memoryId);
      const byId = new Map(existing.messages.map((message) => [messageKey(message), message]));
      for (const message of messages) byId.set(messageKey(message), message);
      await this.writeEvidence({ memoryId, messages: [...byId.values()] });
    });
  }

  public merge(canonicalId: string, mergedIds: readonly string[]): Promise<void> {
    return this.serialize(async () => {
      const canonical = await this.readEvidence(canonicalId);
      const byId = new Map(canonical.messages.map((message) => [messageKey(message), message]));
      for (const id of mergedIds) {
        for (const message of (await this.readEvidence(id)).messages) byId.set(messageKey(message), message);
      }
      await this.writeEvidence({ memoryId: canonicalId, messages: [...byId.values()] });
      for (const id of mergedIds) await rm(this.pathFor(id), { force: true });
    });
  }

  public remove(memoryId: string): Promise<void> {
    return this.serialize(() => rm(this.pathFor(memoryId), { force: true }));
  }

  public async count(memoryId: string): Promise<number> {
    return (await this.read(memoryId)).length;
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation, operation);
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async readEvidence(memoryId: string): Promise<MemoryEvidence> {
    try {
      const raw = await readFile(this.pathFor(memoryId), "utf8");
      try {
        const evidence = JSON.parse(raw) as MemoryEvidence;
        if (evidence.memoryId !== memoryId || !Array.isArray(evidence.messages)) throw new Error("schema mismatch");
        return evidence;
      } catch (cause) {
        throw new Error(`Invalid evidence JSON for ${memoryId}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { memoryId, messages: [] };
      throw cause;
    }
  }

  private async writeEvidence(evidence: MemoryEvidence): Promise<void> {
    const path = this.pathFor(evidence.memoryId);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(evidence)}\n`, { encoding: "utf8", flag: "wx" });
    try {
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private pathFor(memoryId: string): string {
    return join(this.root, "evidence", `${memoryId}.json`);
  }
}

function messageKey(message: MessageRecord): string {
  return `${message.platform}\u0000${message.selfId}\u0000${message.channel.id}\u0000${message.messageId}`;
}
