import type {
  LanguageModelV3,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";

import { createAgent } from "../src/agent.js";
import { AgentBusyError } from "../src/errors.js";
import { createUserMessage } from "../src/message.js";
import { AgentEntry } from "../src/types/entry.js";
import { AgentStorage } from "../src/types/storage.js";

function createBlockingModel() {
  const finishReason = "stop" as unknown as LanguageModelV3FinishReason;
  return {
    specificationVersion: "v3",
    provider: "mock-provider",
    modelId: "mock-model",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("not implemented");
    },
    async doStream() {
      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          async start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "text_1" });
            await Promise.resolve();
            controller.enqueue({ type: "text-delta", id: "text_1", delta: "ok" });
            controller.enqueue({ type: "text-end", id: "text_1" });
            controller.enqueue({
              type: "finish",
              finishReason,
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            } as LanguageModelV3StreamPart);
            controller.close();
          },
        }),
      };
    },
  } as unknown as LanguageModelV3;
}

function createDeferredStorage() {
  let releaseAppend: (() => void) | undefined;
  const appended: AgentEntry[] = [];
  let pending: Promise<void> | undefined;

  const storage: AgentStorage = {
    append: async (...entries) => {
      appended.push(...entries);
      if (!pending) {
        pending = new Promise<void>((resolve) => {
          releaseAppend = resolve;
        });
      }
      await pending;
    },
    read: async () => [...appended],
    clear: async () => {
      appended.length = 0;
    },
  };

  return {
    storage,
    appended,
    release() {
      releaseAppend?.();
    },
  };
}

describe("busy behavior", () => {
  it("rejects when ifBusy is reject", () => {
    const agent = createAgent({ model: createBlockingModel() });
    agent.send(createUserMessage("first"));

    expect(() => agent.send(createUserMessage("second"), { ifBusy: "reject" })).toThrow(
      AgentBusyError,
    );
  });

  it("keeps joined messages clean while retaining them in the active turn result", async () => {
    const agent = createAgent({ model: createBlockingModel() });
    const turnId = agent.send(createUserMessage("first"));
    const joinedMessage = createUserMessage("joined");

    agent.send(joinedMessage, { ifBusy: "join" });
    const result = await agent.waitTurn(turnId);

    const entries = await agent.storage.read();
    const messages = entries.filter((entry) => entry.type === "message");
    const persistedJoined = messages.find(
      (entry) => entry.data.role === "user" && entry.data.content === "joined",
    );

    expect("turnId" in joinedMessage).toBe(false);
    expect("meta" in joinedMessage).toBe(false);
    expect(persistedJoined).toBeDefined();
    expect("turnId" in persistedJoined!.data).toBe(false);
    expect("meta" in persistedJoined!.data).toBe(false);
    expect(result.messages).toEqual(expect.arrayContaining([joinedMessage]));
  });

  it("defaults to defer with a new top-level turn", async () => {
    const agent = createAgent({ model: createBlockingModel() });
    const firstTurnId = agent.send(createUserMessage("first"));
    const secondTurnId = agent.send(createUserMessage("second"));

    expect(secondTurnId).not.toBe(firstTurnId);

    await expect(agent.waitTurn(secondTurnId)).resolves.toMatchObject({
      turnId: secondTurnId,
      status: "done",
    });
  });

  it("does not duplicate joined persistence when storage append is slow", async () => {
    const deferredStorage = createDeferredStorage();
    const agent = createAgent({
      model: createBlockingModel(),
      storage: deferredStorage.storage,
    });
    const firstTurnId = agent.send(createUserMessage("first"));

    agent.send(createUserMessage("joined"), { ifBusy: "join" });
    for (let attempt = 0; attempt < 10 && deferredStorage.appended.length === 0; attempt += 1) {
      await Promise.resolve();
    }
    expect(deferredStorage.appended.length).toBeGreaterThan(0);

    const joinedBeforeRelease = deferredStorage.appended.filter(
      (entry) =>
        entry.type === "message" && entry.data.role === "user" && entry.data.content === "joined",
    );
    expect(joinedBeforeRelease.length).toBeLessThanOrEqual(1);

    deferredStorage.release();
    await expect(agent.waitTurn(firstTurnId)).resolves.toMatchObject({ status: "done" });

    const joinedAfterDone = (await agent.storage.read()).filter(
      (entry) =>
        entry.type === "message" && entry.data.role === "user" && entry.data.content === "joined",
    );
    expect(joinedAfterDone).toHaveLength(1);
  });
});
