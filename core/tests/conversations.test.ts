import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEntry } from "@yesimbot/agent-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

const generateText = vi.hoisted(() => vi.fn());
vi.mock("ai", async (original) => ({ ...(await original<typeof import("ai")>()), generateText }));

import { Conversation } from "../src/conversations/index.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

// ---------------------------------------------------------------------------
// Conversation.archive
// ---------------------------------------------------------------------------

describe("Conversation.archive", () => {
  it("switches active storage to a fresh session", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-archive-"));
    roots.push(root);
    const conversation = new Conversation(root);
    await conversation.init();
    await conversation.storage.append(createEntry("message", { id: "m1", timestamp: 1, role: "user", content: "hello" }));

    await conversation.archive();

    expect(await conversation.storage.read()).toEqual([]);
    expect(await conversation.list()).toHaveLength(2);
  });
  it("rejects archiving an empty session without creating a destination", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-archive-"));
    roots.push(root);
    const conversation = new Conversation(root);
    await conversation.init();
    const before = await conversation.list();
    await expect(conversation.archive(true)).rejects.toThrow("Cannot archive an empty session");
    expect(await conversation.list()).toEqual(before);
  });

  it("creates a blank destination when noSummary is explicit", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-archive-"));
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
    const root = await mkdtemp(join(tmpdir(), "yesimbot-archive-"));
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
    const root = await mkdtemp(join(tmpdir(), "yesimbot-archive-"));
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
  it("uses the supplied immutable LLM/persona snapshot and only switches after a valid summary", async () => {
    generateText.mockResolvedValue({ text: "LLM memory" });
    const root = await mkdtemp(join(tmpdir(), "yesimbot-conversation-"));
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
    expect(await conversation.storage.read()).toHaveLength(1);
  });

  it("does not activate a new session for an empty model summary", async () => {
    generateText.mockResolvedValue({ text: " " });
    const root = await mkdtemp(join(tmpdir(), "yesimbot-conversation-"));
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
    const root = await mkdtemp(join(tmpdir(), "yesimbot-conversation-"));
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
    const root = await mkdtemp(join(tmpdir(), "yesimbot-conversation-"));
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
    const root = await mkdtemp(join(tmpdir(), "yesimbot-conversation-"));
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
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: "compact", data: expect.objectContaining({ sourceSession, summary: "stable memory" }) });
  });

  it("stops trying after the configured consecutive failure limit", async () => {
    generateText.mockReset().mockRejectedValue(new Error("model unavailable"));
    const root = await mkdtemp(join(tmpdir(), "yesimbot-conversation-"));
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
