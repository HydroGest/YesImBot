import fs from "node:fs/promises";
import { join } from "node:path";

export interface SessionFileInfo {
  filename: string;
  path: string;
  isActive: boolean;
  size: number;
  createdAt: string;
}

export interface MigrationLogger {
  error(message: string, context?: Record<string, unknown>): void;
}

export function formatSessionTimestamp(date: Date): string {
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const s = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}${mo}${d}T${h}${mi}${s}Z`;
}

async function listJsonlFiles(sessionsDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(sessionsDir);
    return entries.filter((f) => f.endsWith(".jsonl") && f !== "messages.jsonl").sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function resolveActiveSession(sessionsDir: string): Promise<string | null> {
  const files = await listJsonlFiles(sessionsDir);
  if (files.length === 0) return null;
  return join(sessionsDir, files[files.length - 1]!);
}

export async function createNewSession(sessionsDir: string): Promise<string> {
  await fs.mkdir(sessionsDir, { recursive: true });
  const filename = `${formatSessionTimestamp(new Date())}.jsonl`;
  const path = join(sessionsDir, filename);
  await fs.writeFile(path, "", { flag: "wx" });
  return path;
}

export async function listSessions(sessionsDir: string): Promise<SessionFileInfo[]> {
  const files = await listJsonlFiles(sessionsDir);
  const results: SessionFileInfo[] = [];
  for (const filename of files) {
    const path = join(sessionsDir, filename);
    const stat = await fs.stat(path);
    results.push({
      filename,
      path,
      isActive: false,
      size: stat.size,
      createdAt: filename.replace(".jsonl", ""),
    });
  }
  if (results.length > 0) {
    results[results.length - 1]!.isActive = true;
  }
  results.reverse();
  return results;
}

export async function migrateOldSession(sessionsDir: string, logger: MigrationLogger): Promise<void> {
  const oldPath = join(sessionsDir, "messages.jsonl");
  try {
    await fs.access(oldPath);
  } catch {
    return;
  }

  let timestamp: string;
  try {
    const content = await fs.readFile(oldPath, "utf8");
    const firstLine = content.split("\n").find((line) => line.trim().length > 0);
    if (firstLine) {
      const entry = JSON.parse(firstLine) as { timestamp?: number };
      timestamp = formatSessionTimestamp(new Date(entry.timestamp ?? Date.now()));
    } else {
      const stat = await fs.stat(oldPath);
      timestamp = formatSessionTimestamp(stat.mtime);
    }
  } catch {
    const stat = await fs.stat(oldPath);
    timestamp = formatSessionTimestamp(stat.mtime);
  }

  const newPath = join(sessionsDir, `${timestamp}.jsonl`);
  try {
    await fs.rename(oldPath, newPath);
  } catch (cause) {
    logger.error("session.migration_failed", { oldPath, newPath, cause: String(cause) });
    throw cause;
  }
}
