import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createEntry } from "@yesimbot/agent-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

const generateText = vi.hoisted(() => vi.fn());
vi.mock("koishi", async () => import("@koishijs/core"));
vi.mock("ai", async (original) => ({ ...(await original<typeof import("ai")>()), generateText }));
import { Conversation } from "../src/conversations/index.js";
import { createMessage, type MessageRecord } from "../src/messages/index.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

// ---------------------------------------------------------------------------
// Conversation.archive
// ---------------------------------------------------------------------------

describe("Conversation.archive", () => {
  it("switches active storage to a fresh session", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "yesimbot-archive-"));
    roots.push(root);
    const conversation = new Conversation(root);
    await conversation.init();
    await conversation.storage.append(createEntry("message", { id: "m1", timestamp: 1, role: "user", content: "hello" }));

    await conversation.archive();

    expect(await conversation.storage.read()).toEqual([]);
    expect(await conversation.list()).toHaveLength(2);
  });
  it("rejects archiving an empty session without creating a destination", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "yesimbot-archive-"));
    roots.push(root);
    const conversation = new Conversation(root);
    await conversation.init();
    const before = await conversation.list();
    await expect(conversation.archive(true)).rejects.toThrow("Cannot archive an empty session");
    expect(await conversation.list()).toEqual(before);
  });

  it("creates a blank destination when noSummary is explicit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "yesimbot-archive-"));
    roots.push(root);
    const conversation = new Conversation(root);
    await conversation.init();
    await conversation.storage.append(createEntry("message", { id: "m1", timestamp: 1, role: "user", content: "hello" }));
    await conversation.archive(true);
    expect(await conversation.storage.read()).toEqual([]);
    expect((await conversation.list()).filter((item) => item.isActive)).toHaveLength(1);
  });

  it("performs compact on archive and seeds new session with summary", async () => {
    generateText.mockResolvedValue({ text: "archived memory" });
    const root = await mkdtemp(path.join(tmpdir(), "yesimbot-archive-"));
    roots.push(root);
    const conversation = new Conversation(root, { threshold: 0.9, charTokenRatio: 1.8, minMessages: 2, maxFailures: 3 });
    await conversation.init();
    await conversation.storage.append(
      createEntry("message", {
        id: "m1",
        timestamp: 1,
        role: "custom",
        content: "",
        type: "yesimbot.message",
        data: { user: { id: "u1", name: "Alice" }, elements: [{ type: "text", attrs: { content: "hello" }, children: [] }] },
      }),
      createEntry("message", { id: "m2", timestamp: 2, role: "assistant", content: "hi" }),
    );
    await conversation.archive(false, { model: {} as never, personaName: "Athena", persona: "persona" });
    expect(generateText).toHaveBeenCalled();
    const entries = await conversation.storage.read();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: "compact", data: expect.objectContaining({ summary: "archived memory" }) });
  });

  it("falls back to blank session when compact fails during archive", async () => {
    generateText.mockRejectedValue(new Error("model unavailable"));
    const root = await mkdtemp(path.join(tmpdir(), "yesimbot-archive-"));
    roots.push(root);
    const conversation = new Conversation(root, { threshold: 0.9, charTokenRatio: 1.8, minMessages: 2, maxFailures: 3 });
    await conversation.init();
    await conversation.storage.append(
      createEntry("message", { id: "m1", timestamp: 1, role: "user", content: "first" }),
      createEntry("message", { id: "m2", timestamp: 2, role: "assistant", content: "second" }),
    );
    await conversation.archive(false, { model: {} as never, personaName: "Athena", persona: "persona" });
    expect(await conversation.storage.read()).toEqual([]);
    expect(await conversation.list()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Conversation.compact
// ---------------------------------------------------------------------------

describe("Conversation.compact", () => {
  it("uses the supplied immutable LLM/persona snapshot and appends a compact boundary", async () => {
    generateText.mockResolvedValue({ text: "LLM memory" });
    const root = await mkdtemp(path.join(tmpdir(), "yesimbot-conversation-"));
    roots.push(root);
    const conversation = new Conversation(root, { threshold: 0.9, charTokenRatio: 1.8, minMessages: 2, maxFailures: 3 });
    await conversation.init();
    await conversation.storage.append(
      createEntry("message", { id: "m1", timestamp: 1, role: "user", content: "first" }),
      createEntry("message", { id: "m2", timestamp: 2, role: "assistant", content: "second" }),
    );

    await expect(conversation.compact("manual", { model: {} as never, personaName: "Athena", persona: "persona" })).resolves.toEqual({ compacted: true });
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ model: expect.anything(), system: expect.stringContaining("Athena"), prompt: expect.stringContaining("persona") }),
    );
    expect((await conversation.list()).filter((item) => item.isActive)).toHaveLength(1);
    expect(await conversation.storage.read()).toHaveLength(3);
  });

  it("does not activate a new session for an empty model summary", async () => {
    generateText.mockResolvedValue({ text: " " });
    const root = await mkdtemp(path.join(tmpdir(), "yesimbot-conversation-"));
    roots.push(root);
    const conversation = new Conversation(root, { threshold: 0.9, charTokenRatio: 1.8, minMessages: 2, maxFailures: 3 });
    await conversation.init();
    await conversation.storage.append(
      createEntry("message", { id: "m1", timestamp: 1, role: "user", content: "first" }),
      createEntry("message", { id: "m2", timestamp: 2, role: "assistant", content: "second" }),
    );
    const before = await conversation.list();
    await expect(conversation.compact("manual", { model: {} as never, personaName: "Athena", persona: "persona" })).resolves.toMatchObject({
      compacted: false,
      reason: "empty_summary",
    });
    expect(await conversation.list()).toEqual(before);
  });
  it("skips model compaction below the minimum message count", async () => {
    generateText.mockReset();
    const root = await mkdtemp(path.join(tmpdir(), "yesimbot-conversation-"));
    roots.push(root);
    const conversation = new Conversation(root, { threshold: 0.9, charTokenRatio: 1.8, minMessages: 3, maxFailures: 3 });
    await conversation.init();
    await conversation.storage.append(
      createEntry("message", { id: "m1", timestamp: 1, role: "user", content: "first" }),
      createEntry("message", { id: "m2", timestamp: 2, role: "assistant", content: "second" }),
    );
    await expect(conversation.compact("auto", { model: {} as never, personaName: "Athena", persona: "persona" })).resolves.toEqual({
      compacted: false,
      reason: "minimum_messages",
    });
    expect(generateText).not.toHaveBeenCalled();
  });

  it("keeps the active session when the model fails", async () => {
    generateText.mockReset().mockRejectedValue(new Error("model unavailable"));
    const root = await mkdtemp(path.join(tmpdir(), "yesimbot-conversation-"));
    roots.push(root);
    const conversation = new Conversation(root, { threshold: 0.9, charTokenRatio: 1.8, minMessages: 2, maxFailures: 3 });
    await conversation.init();
    await conversation.storage.append(
      createEntry("message", { id: "m1", timestamp: 1, role: "user", content: "first" }),
      createEntry("message", { id: "m2", timestamp: 2, role: "assistant", content: "second" }),
    );
    const before = await conversation.status();
    await expect(conversation.compact("manual", { model: {} as never, personaName: "Athena", persona: "persona" })).resolves.toEqual({
      compacted: false,
      reason: "model_failure",
    });
    expect(await conversation.status()).toEqual(before);
  });

  it("persists the compact source boundary and resets failures after success", async () => {
    generateText.mockReset().mockRejectedValueOnce(new Error("temporary")).mockResolvedValueOnce({ text: "stable memory" });
    const root = await mkdtemp(path.join(tmpdir(), "yesimbot-conversation-"));
    roots.push(root);
    const conversation = new Conversation(root, { threshold: 0.9, charTokenRatio: 1.8, minMessages: 2, maxFailures: 2 });
    await conversation.init();
    const sourceSession = (await conversation.status()).active!.filename.replace(/\.jsonl$/, "");
    await conversation.storage.append(
      createEntry("message", { id: "m1", timestamp: 1, role: "user", content: "first" }),
      createEntry("message", { id: "m2", timestamp: 2, role: "assistant", content: "second" }),
    );
    await conversation.compact("manual", { model: {} as never, personaName: "Athena", persona: "persona" });
    await expect(conversation.compact("manual", { model: {} as never, personaName: "Athena", persona: "persona" })).resolves.toEqual({ compacted: true });
    const entries = await conversation.storage.read();
    expect(entries).toHaveLength(3);
    expect(entries.at(-1)).toMatchObject({ type: "compact", data: expect.objectContaining({ sourceSession, summary: "stable memory" }) });
  });

  it("stops trying after the configured consecutive failure limit", async () => {
    generateText.mockReset().mockRejectedValue(new Error("model unavailable"));
    const root = await mkdtemp(path.join(tmpdir(), "yesimbot-conversation-"));
    roots.push(root);
    const conversation = new Conversation(root, { threshold: 0.9, charTokenRatio: 1.8, minMessages: 2, maxFailures: 1 });
    await conversation.init();
    await conversation.storage.append(
      createEntry("message", { id: "m1", timestamp: 1, role: "user", content: "first" }),
      createEntry("message", { id: "m2", timestamp: 2, role: "assistant", content: "second" }),
    );
    await conversation.compact("manual", { model: {} as never, personaName: "Athena", persona: "persona" });
    await expect(conversation.compact("manual", { model: {} as never, personaName: "Athena", persona: "persona" })).resolves.toEqual({
      compacted: false,
      reason: "failure_limit",
    });
    expect(generateText).toHaveBeenCalledOnce();
  });
});
describe("Conversation archiving policies", () => {
  it("keeps the storage facade on the new active file after archiving", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "yesimbot-storage-facade-"));
    roots.push(root);
    const conversation = new Conversation(root);
    await conversation.init();
    const storage = conversation.storage;
    await storage.append(createEntry("message", { id: "m1", timestamp: 1, role: "user", content: "hello" }));

    await conversation.archive(true);

    expect(await storage.read()).toEqual([]);
  });

  it("archives the active file only after it exceeds the byte limit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "yesimbot-size-archive-"));
    roots.push(root);
    const conversation = new Conversation(root);
    await conversation.init();
    await conversation.storage.append(createEntry("message", { id: "m1", timestamp: 1, role: "user", content: "x".repeat(1000) }));

    await expect(conversation.archiveIfOversize(10_000)).resolves.toBe(false);
    await expect(conversation.archiveIfOversize(1)).resolves.toBe(true);
    expect((await conversation.list()).filter((item) => item.isActive)).toHaveLength(1);
    expect(await conversation.storage.read()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Conversation.read
// ---------------------------------------------------------------------------

function record(messageId: string, timestamp: number, userId = "user-1"): MessageRecord {
  return {
    platform: "test",
    selfId: "bot-1",
    timestamp,
    channel: { id: "room-1", type: 0 },
    user: { id: userId, name: userId },
    messageId,
    elements: [],
  };
}

describe("Conversation.read", () => {
  it("reads platform messages across active and archived sessions in chronological source windows", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "yesimbot-read-"));
    roots.push(root);
    const conversation = new Conversation(root);
    await conversation.init();
    await conversation.storage.append(
      createEntry("message", createMessage(record("first", 1))),
      createEntry("message", { id: "assistant", timestamp: 2, role: "assistant", content: "ignored" }),
      createEntry("event", { type: "started", turnId: "turn" }),
      createEntry("message", createMessage(record("source", 3, "user-2"))),
    );
    await conversation.archive(true);
    await conversation.storage.append(createEntry("message", createMessage(record("last", 4))));

    await expect(conversation.read({ messageIds: ["source", "last"], before: 1, after: 1, userIds: ["user-1", "user-2"] })).resolves.toMatchObject([
      { messageId: "first" },
      { messageId: "source" },
      { messageId: "last" },
    ]);
  });

  it("limits source windows without dropping sources and uses newest entries without sources", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "yesimbot-read-limit-"));
    roots.push(root);
    const conversation = new Conversation(root);
    await conversation.init();
    await conversation.storage.append(
      createEntry("message", createMessage(record("one", 1))),
      createEntry("message", createMessage(record("two", 2))),
      createEntry("message", createMessage(record("three", 3))),
    );

    await expect(conversation.read({ messageIds: ["one", "three"], before: 1, after: 1, limit: 1 })).resolves.toMatchObject([
      { messageId: "one" },
      { messageId: "three" },
    ]);
    await expect(conversation.read({ limit: 2 })).resolves.toMatchObject([{ messageId: "two" }, { messageId: "three" }]);
  });
  it("rejects missing and duplicate source ids", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "yesimbot-read-errors-"));
    roots.push(root);
    const conversation = new Conversation(root);
    await conversation.init();
    await conversation.storage.append(createEntry("message", createMessage(record("duplicate", 1))));
    await conversation.archive(true);
    await conversation.storage.append(createEntry("message", createMessage(record("duplicate", 2))));

    await expect(conversation.read({ messageIds: ["missing"] })).rejects.toThrow("missing");
    await expect(conversation.read({ messageIds: ["duplicate"] })).rejects.toThrow("duplicate");
  });
});
