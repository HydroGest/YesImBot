import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { parseConversationJsonl } from "../src/conversations.js";

vi.mock("@koishijs/loader", () => ({}));

describe("parseConversationJsonl", () => {
  it("distinguishes reasoning from replies and resolves asset references", async () => {
    const fixtures = resolve(process.cwd(), "plugins/console/tests/fixtures");
    const content = await readFile(resolve(fixtures, "real-session.jsonl"), "utf8");
    const { entries } = await parseConversationJsonl(content, "real-session.jsonl", fixtures);

    expect(entries.find((entry) => entry.kind === "thought")?.text).toContain("搜一下");
    expect(entries.find((entry) => entry.kind === "assistant")?.text).toContain("今天晴");
    expect(entries.find((entry) => entry.kind === "tool-call")?.toolName).toBe("search_service");
    expect(entries.find((entry) => entry.kind === "will")?.decision).toBe("trigger");
    expect(entries.find((entry) => entry.kind === "user")?.assets?.[0]).toMatchObject({
      kind: "file",
      title: "notes.txt",
    });
  });
});
