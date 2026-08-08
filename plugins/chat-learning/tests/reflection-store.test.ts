import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createReflectionStore } from "../src/reflection-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("createReflectionStore", () => {
  it("persists human annotations and prefers the latest human reflection", async () => {
    const root = await mkdtemp(join(tmpdir(), "chat-learning-reflection-"));
    roots.push(root);
    const path = join(root, "reflections.jsonl");
    const store = createReflectionStore(path);
    await store.init();

    await store.append({
      source: "auto",
      text: "bot message",
      reflection: "更短一些",
      score: undefined,
      annotation: undefined,
      messageId: "m1",
      turnId: "t1",
    });
    const human = await store.append({
      source: "human",
      text: "bot message",
      reflection: "这条更像群友，保持",
      score: 1,
      annotation: "保持",
      messageId: "m1",
      turnId: undefined,
    });

    expect(store.latestHuman()?.reflection).toBe(human.reflection);
    const reopened = createReflectionStore(path);
    await reopened.init();
    expect(reopened.latestHuman()?.reflection).toBe("这条更像群友，保持");
    expect(reopened.latestAuto()?.reflection).toBe("更短一些");
  });
});
