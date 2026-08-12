import { createAssistantMessage, createMessageEntry, createUserMessage } from "@yesimbot/agent-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ generateText: vi.fn<() => Promise<{ text: string }>>() }));

vi.mock("ai", () => ({ generateText: mocks.generateText }));

import { buildFinalStylePrompt, rewriteAssistantEntries } from "../src/final-style.js";

afterEach(() => {
  mocks.generateText.mockReset();
});

describe("buildFinalStylePrompt", () => {
  it("includes the learned style reference and the pending final reply", () => {
    const { system, prompt } = buildFinalStylePrompt("<style>短句，直接</style>", "好的，我来为你详细解释一下这个问题。");

    expect(system).toContain("最终发言");
    expect(system).toContain("群友");
    expect(prompt).toContain("<style>短句，直接</style>");
    expect(prompt).toContain("好的，我来为你详细解释一下这个问题。");
  });
});

describe("rewriteAssistantEntries", () => {
  it("rewrites only text-only assistant entries and preserves message identity", async () => {
    mocks.generateText.mockResolvedValue({ text: "草，太真实了" });
    const assistant = createMessageEntry(createAssistantMessage("好的，我来为你详细解释一下这个问题。", { id: "assistant-message", timestamp: 100 }), {
      id: "assistant-entry",
      timestamp: 100,
    });
    const toolAssistant = createMessageEntry(
      createAssistantMessage(
        [
          { type: "text", text: "先读取一下" },
          { type: "tool-call", toolCallId: "call_1", toolName: "read", args: { uri: "asset://00000000000000000000000000000000" } },
        ] as never,
        { id: "tool-message", timestamp: 200 },
      ),
      { id: "tool-entry", timestamp: 200 },
    );
    const user = createMessageEntry(createUserMessage("hello"), { id: "user-entry", timestamp: 300 });

    const result = await rewriteAssistantEntries([assistant, toolAssistant, user], {} as never, "<style>短句，直接</style>");

    expect(result[0]).toMatchObject({ id: "assistant-entry", timestamp: 100 });
    expect(result[0]!.data).toMatchObject({ id: "assistant-message", timestamp: 100, role: "assistant", content: "草，太真实了" });
    expect(result[1]!.data).toBe(toolAssistant.data);
    expect(result[2]!.data).toBe(user.data);
    expect(mocks.generateText).toHaveBeenCalledOnce();
    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("好的，我来为你详细解释一下这个问题。"),
      }),
    );
  });

  it("keeps the original reply when the rewrite model fails or returns nothing", async () => {
    mocks.generateText.mockResolvedValue({ text: "   " });
    const assistant = createMessageEntry(createAssistantMessage("这条回复保持原样"), { id: "assistant-entry", timestamp: 100 });

    const result = await rewriteAssistantEntries([assistant], {} as never, "<style>短句，直接</style>");

    expect(result[0]!.data).toBe(assistant.data);

    mocks.generateText.mockRejectedValueOnce(new Error("offline"));
    const failed = await rewriteAssistantEntries([assistant], {} as never, "<style>短句，直接</style>");

    expect(failed[0]!.data).toBe(assistant.data);
  });
});
