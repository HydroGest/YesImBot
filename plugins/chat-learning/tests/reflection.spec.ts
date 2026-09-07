import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createAssistantMessage, createMessageEntry, type AgentEntry } from "@yesimbot/agent-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ generateText: vi.fn<() => Promise<{ text: string }>>() }));

vi.mock("ai", () => ({ generateText: mocks.generateText }));

import { createReflectionStore, type ReflectionStore } from "../src/reflection-store.js";
import { buildReflectionHistory, generateReflection, reflectOnSentMessage } from "../src/reflection.js";

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

async function reflectionStore(records: ReadonlyArray<Omit<Parameters<ReflectionStore["append"]>[0], "id" | "createdAt">>): Promise<ReflectionStore> {
  const root = await mkdtemp(path.join(tmpdir(), "chat-learning-reflection-history-"));
  roots.push(root);
  const store = createReflectionStore(path.join(root, "reflections.jsonl"));
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
        text: '<quote id="1"/> 又咋了，说',
        reflection: "auto-reflection",
        score: undefined,
        annotation: undefined,
        messageId: "auto-1",
        turnId: "t1",
      },
      { source: "human", text: "又咋了，说", reflection: "human-reflection", score: 1, annotation: "这句可以其实", messageId: "human-1", turnId: undefined },
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

  it("does not feed provider reasoning parts into reflection prompts", async () => {
    mocks.generateText.mockResolvedValue({ text: "更好" });
    const entry = createMessageEntry(
      createAssistantMessage(
        [
          { type: "reasoning", text: "private chain" },
          { type: "text", text: "visible reply" },
        ],
        { id: "message-1", timestamp: 1000 },
      ),
      { id: "entry-1", timestamp: 1000 },
    );

    const result = await generateReflection({} as never, "<group_examples>example</group_examples>", [entry], { maxMessages: 5 });

    expect(result).toBe("更好");
    expect(mocks.generateText).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining("visible reply") }));
    expect(mocks.generateText).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.not.stringContaining("private chain") }));
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
