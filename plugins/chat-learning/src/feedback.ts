import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import type { LinkCorrection, LinkCorrectionAction, LinkKind } from "./types.js";

export interface FeedbackStore {
  init(): Promise<void>;
  read(): readonly LinkCorrection[];
  clear(): Promise<void>;
  append(input: {
    action: LinkCorrectionAction;
    from: string;
    to: string | null;
    kind: LinkKind | "*";
    confidence?: number;
    note?: string;
  }): Promise<LinkCorrection>;
}

export function createFeedbackStore(filePath: string): FeedbackStore {
  let corrections: LinkCorrection[] = [];
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
          corrections = [];
          for (const line of content.split("\n")) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line) as LinkCorrection;
              if (isLinkCorrection(parsed)) corrections.push(parsed);
            } catch {}
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      });
    },
    read() {
      return corrections;
    },
    append(input) {
      return serialize(async () => {
        const correction: LinkCorrection = {
          id: randomUUID(),
          action: input.action,
          from: input.from,
          to: input.to,
          kind: input.kind,
          confidence: input.confidence ?? 1,
          createdAt: Date.now(),
          note: input.note,
        };
        await mkdir(path.dirname(filePath), { recursive: true });
        await appendFile(filePath, `${JSON.stringify(correction)}\n`, "utf8");
        corrections.push(correction);
        return correction;
      });
    },
    clear() {
      return serialize(async () => {
        corrections = [];
        await rm(filePath, { force: true });
      });
    },
  };
}

function isLinkCorrection(value: unknown): value is LinkCorrection {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<LinkCorrection>;
  return (
    typeof candidate.id === "string" &&
    (candidate.action === "add" || candidate.action === "remove") &&
    typeof candidate.from === "string" &&
    (typeof candidate.to === "string" || candidate.to === null) &&
    typeof candidate.kind === "string" &&
    typeof candidate.confidence === "number" &&
    typeof candidate.createdAt === "number"
  );
}
