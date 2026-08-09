import { createAssistantMessage, createMessageEntry, type AgentEntry } from "@yesimbot/agent-runtime";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ generateText: vi.fn<() => Promise<{ text: string }>>() }));

vi.mock("ai", () => ({ generateText: mocks.generateText }));

import { buildReflectionHistory, generateReflection, reflectOnSentMessage } from "../src/reflection.js";
import { createReflectionStore, type ReflectionStore } from "../src/reflection-store.js";

const roots: string[] = [];

function assistantEntry(id: string, text: string): AgentEntry {
  const message = createAssistantMessage(text, { id: `${id}-message`, timestamp: 1000 });
  return createMessageEntry(message, { id, timestamp: 1000 });
}

afterEach(() => {
  mocks.generateText.mockReset();
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function reflectionStore(records: readonly Omit<Parameters<ReflectionStore["append"]>[0], "id" | "createdAt">[]): Promise<ReflectionStore> {
  const root = await mkdtemp(join(tmpdir(), "chat-learning-reflection-history-"));
  roots.push(root);
  const store = createReflectionStore(join(root, "reflections.jsonl"));
  await store.init();
  for (const record of records) await store.append(record);
  return store;
}

describe("buildReflectionHistory", () => {
  it("keeps the configured number of latest human reflections without leaking all auto records", async () => {
    const store = await reflectionStore([
      { source: "human", text: "m1", reflection: "h1", score: 1, annotation: undefined, messageId: "1", turnId: undefined },
      { source: "human", text: "m2", reflection: "h2", score: 1, annotation: undefined, messageId: "2", turnId: undefined },
      { source: "human", text: "m3", reflection: "h3", score: 1, annotation: undefined, messageId: "3", turnId: undefined },
      { source: "human", text: "m4", reflection: "h4", score: 1, annotation: undefined, messageId: "4", turnId: undefined },
      { source: "auto", text: "m5", reflection: "auto-a", score: undefined, annotation: undefined, messageId: "5", turnId: "t5" },
    ]);

    const block = buildReflectionHistory(store, 3);

    expect(block).toContain("h2");
    expect(block).toContain("h4");
    expect(block).not.toContain("auto-a");
  });

  it("suppresses auto reflections for messages already annotated by a human", async () => {
    const store = await reflectionStore([
      {
        source: "auto",
        text: "<quote id=\"1\"/> 又咋了，说",
        reflection: "auto-reflection",
        score: undefined,
        annotation: undefined,
        messageId: "auto-1",
        turnId: "t1",
      },
      {
        source: "human",
        text: "又咋了，说",
        reflection: "human-reflection",
        score: 1,
        annotation: "这句可以其实",
        messageId: "human-1",
        turnId: undefined,
      },
    ]);

    const block = buildReflectionHistory(store, 2);

    expect(block).toContain("human-reflection");
    expect(block).not.toContain("auto-reflection");
  });
});

describe("generateReflection", () => {
  it("uses the same style block to evaluate recent bot messages", async () => {
    mocks.generateText.mockResolvedValue({ text: "  更短一些，多一些反问。  " });

    const result = await generateReflection({} as never, "<group_examples>example</group_examples>", [assistantEntry("a1", "这条回复太正式了")], {
      maxMessages: 5,
    });

    expect(result).toBe("更短一些，多一些反问。");
    expect(mocks.generateText).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining("<group_examples>example</group_examples>") }));
    expect(mocks.generateText).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining("这条回复太正式了") }));
  });

  it("returns undefined when there are no recent assistant messages", async () => {
    const result = await generateReflection({} as never, "<group_examples>example</group_examples>", [], { maxMessages: 5 });

    expect(result).toBeUndefined();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
});

describe("reflectOnSentMessage", () => {
  it("reflects on the final sent text", async () => {
    mocks.generateText.mockResolvedValue({ text: "太长太正式，改短一点。" });

    const result = await reflectOnSentMessage({} as never, "<group_examples>example</group_examples>", "最终发送内容");

    expect(result).toBe("太长太正式，改短一点。");
    expect(mocks.generateText).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining("最终发送内容") }));
  });
});
