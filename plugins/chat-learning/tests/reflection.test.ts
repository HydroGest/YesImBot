import { createAssistantMessage, createMessageEntry, type AgentEntry } from "@yesimbot/agent-runtime";

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn<() => Promise<{ text: string }>>(),
}));

vi.mock("ai", () => ({
  generateText: mocks.generateText,
}));

import { generateReflection, reflectOnSentMessage } from "../src/reflection.js";

function assistantEntry(id: string, text: string): AgentEntry {
  const message = createAssistantMessage(text, { id: `${id}-message`, timestamp: 1000 });
  return createMessageEntry(message, { id, timestamp: 1000 });
}

afterEach(() => {
  mocks.generateText.mockReset();
});

describe("generateReflection", () => {
  it("uses the same style block to evaluate recent bot messages", async () => {
    mocks.generateText.mockResolvedValue({ text: "  更短一些，多一些反问。  " });

    const result = await generateReflection(
      {} as never,
      "<group_examples>example</group_examples>",
      [assistantEntry("a1", "这条回复太正式了")],
      { maxMessages: 5 },
    );

    expect(result).toBe("更短一些，多一些反问。");
    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("<group_examples>example</group_examples>"),
      }),
    );
    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("这条回复太正式了"),
      }),
    );
  });

  it("returns undefined when there are no recent assistant messages", async () => {
    const result = await generateReflection({} as never, "<group_examples>example</group_examples>", [], {
      maxMessages: 5,
    });

    expect(result).toBeUndefined();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
});

describe("reflectOnSentMessage", () => {
  it("reflects on the final sent text", async () => {
    mocks.generateText.mockResolvedValue({ text: "太长太正式，改短一点。" });

    const result = await reflectOnSentMessage({} as never, "<group_examples>example</group_examples>", "最终发送内容");

    expect(result).toBe("太长太正式，改短一点。");
    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("最终发送内容"),
      }),
    );
  });
});
