import {
  createAssistantMessage,
  createToolMessage,
  createUserMessage,
} from "@yesimbot/agent-runtime";
import { describe, expect, it } from "vitest";

import { extractAssistantTexts } from "../src/runtime/render.js";

describe("assistant reply rendering", () => {
  it("extracts non-empty assistant string and text-part replies in order", () => {
    const result = extractAssistantTexts([
      createUserMessage("ignore"),
      createAssistantMessage(" hello "),
      createAssistantMessage("   "),
      createAssistantMessage([
        { type: "text", text: "part one" },
        { type: "tool-call", toolCallId: "call_1", toolName: "search", input: {} },
        { type: "text", text: "part two" },
      ] as never),
      createToolMessage([]),
    ]);

    expect(result).toEqual([" hello ", "part onepart two"]);
  });

  it("does not render terminal tool results as assistant text", () => {
    const result = extractAssistantTexts([
      createAssistantMessage("final answer"),
      createToolMessage([
        {
          type: "tool-result",
          toolCallId: "call_1",
          toolName: "finalize_response",
          output: { finalized: true },
        },
      ] as never),
    ]);

    expect(result).toEqual(["final answer"]);
  });
});
