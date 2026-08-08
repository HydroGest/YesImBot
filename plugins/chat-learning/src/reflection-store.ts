import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";

export type ReflectionSource = "auto" | "human";
export type ReflectionScore = -1 | 0 | 1;

export interface ReflectionRecord {
  readonly id: string;
  readonly source: ReflectionSource;
  readonly text: string;
  readonly reflection: string;
  readonly score: ReflectionScore | undefined;
  readonly annotation: string | undefined;
  readonly messageId: string | undefined;
  readonly turnId: string | undefined;
  readonly createdAt: number;
}

export interface ReflectionStore {
  init(): Promise<void>;
  read(): readonly ReflectionRecord[];
  append(input: Omit<ReflectionRecord, "id" | "createdAt">): Promise<ReflectionRecord>;
  latestHuman(): ReflectionRecord | undefined;
  latestAuto(): ReflectionRecord | undefined;
  clear(): Promise<void>;
}

export function createReflectionStore(filePath: string): ReflectionStore {
  let records: ReflectionRecord[] = [];
  let tail: Promise<void> = Promise.resolve();

  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const next = tail.then(task, task);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  return {
    async init() {
      await serialize(async () => {
        try {
          const content = await readFile(filePath, "utf8");
          records = [];
          for (const line of content.split("\n")) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line) as ReflectionRecord;
              if (isReflectionRecord(parsed)) records.push(parsed);
            } catch {}
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      });
    },
    read() {
      return [...records];
    },
    append(input) {
      return serialize(async () => {
        const record: ReflectionRecord = {
          ...input,
          id: randomUUID(),
          createdAt: Date.now(),
        };
        await mkdir(dirname(filePath), { recursive: true });
        await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
        records.push(record);
        return record;
      });
    },
    latestHuman() {
      return [...records].reverse().find((record) => record.source === "human");
    },
    latestAuto() {
      return [...records].reverse().find((record) => record.source === "auto");
    },
    clear() {
      return serialize(async () => {
        records = [];
        await rm(filePath, { force: true });
      });
    },
  };
}

function isReflectionRecord(value: unknown): value is ReflectionRecord {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ReflectionRecord>;
  return (
    typeof candidate.id === "string" &&
    (candidate.source === "auto" || candidate.source === "human") &&
    typeof candidate.text === "string" &&
    typeof candidate.reflection === "string" &&
    typeof candidate.createdAt === "number"
  );
}
