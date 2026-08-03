import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { basename, join } from "node:path";

import { createEntry, type AgentEntry, type AgentStorage } from "@yesimbot/agent-runtime";

import { createNewSession, formatSessionTimestamp, resolveActiveSession } from "../session-files.js";

export interface ArchiveOptions {
  sessionsDir: string;
  currentStorage: AgentStorage<AgentEntry>;
  noSummary?: boolean;
  executeCompactFn?: (entries: readonly AgentEntry[]) => Promise<string>;
  logger: { warn(event: string, fields?: Record<string, unknown>): void };
}

export async function archiveSession(options: ArchiveOptions): Promise<string> {
  const entries = await options.currentStorage.read();
  const lastMessage = [...entries].reverse().find((entry) => entry.type === "message");
  if (!lastMessage) throw new Error("Cannot archive an empty session");

  if (options.noSummary) return createNewSession(options.sessionsDir);
  if (!options.executeCompactFn) throw new Error("executeCompactFn is required when noSummary is false");

  const [summary, sourcePath] = await Promise.all([
    options.executeCompactFn(entries),
    resolveActiveSession(options.sessionsDir),
  ]);
  if (!sourcePath) throw new Error("Cannot determine the active source session");

  const filename = `${formatSessionTimestamp(new Date())}-${randomUUID()}.jsonl`;
  const newPath = join(options.sessionsDir, filename);
  const temporaryPath = join(options.sessionsDir, `.${filename}.${randomUUID()}.tmp`);
  const compactEntry = createEntry("compact", {
    summary,
    lastEntryId: lastMessage.id,
    sourceSession: basename(sourcePath, ".jsonl"),
  });
  await fs.mkdir(options.sessionsDir, { recursive: true });
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(compactEntry)}\n`, { flag: "wx" });
    await fs.rename(temporaryPath, newPath);
  } catch (cause) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw cause;
  }
  return newPath;
}
