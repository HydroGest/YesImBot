import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ChatLearningState } from "./types.js";

export interface ChatLearningStore {
  init(): Promise<void>;
  read(): ChatLearningState | undefined;
  update(next: ChatLearningState): Promise<void>;
}

export function createChatLearningStore(filePath: string): ChatLearningStore {
  let state: ChatLearningState | undefined;
  let tail: Promise<void> = Promise.resolve();

  const serialize = (task: () => Promise<void>): Promise<void> => {
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
          state = JSON.parse(content) as ChatLearningState;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      });
    },
    read() {
      return state;
    },
    update(next) {
      return serialize(async () => {
        state = next;
        await mkdir(dirname(filePath), { recursive: true });
        const temporary = `${filePath}.${Date.now()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
        try {
          await rename(temporary, filePath);
        } finally {
          await rm(temporary, { force: true });
        }
      });
    },
  };
}
