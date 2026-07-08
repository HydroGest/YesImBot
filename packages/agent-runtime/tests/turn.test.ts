import type {
  LanguageModelV3,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";

import { createAgent } from "../src/agent.js";
import { createUserMessage } from "../src/message.js";

function createTextModel(text = "ok") {
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
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "text_1" });
            controller.enqueue({ type: "text-delta", id: "text_1", delta: text });
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

function createFailingModel(onCall?: () => void) {
  return {
    specificationVersion: "v3",
    provider: "mock-provider",
    modelId: "mock-model",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("not implemented");
    },
    async doStream() {
      onCall?.();
      throw new Error("model boom");
    },
  } as unknown as LanguageModelV3;
}

describe("turn lifecycle", () => {
  it("waitTurn resolves retained completed results", async () => {
    const agent = createAgent({ model: createTextModel() });
    const turnId = agent.send(createUserMessage("hello"));

    const result = await agent.waitTurn(turnId);
    const retained = await agent.waitTurn(turnId);

    expect(result.status).toBe("done");
    expect(retained).toEqual(result);
  });

  it("run returns turn-scoped events", async () => {
    const agent = createAgent({ model: createTextModel() });
    const stream = agent.run(createUserMessage("hello"));
    const types: string[] = [];

    for await (const event of stream) {
      types.push(event.type);
      expect(event).toHaveProperty("turnId");
    }

    expect(types[0]).toBe("turn.queued");
    expect(types).toContain("turn.start");
    expect(types).toContain("turn.done");
    expect(types.every((type) => type.startsWith("turn."))).toBe(true);
  });

  it("does not block turn completion when turn.done listeners await waitTurn", async () => {
    const agent = createAgent({ model: createTextModel() });
    const seen: string[] = [];

    agent.channel.subscribe("internal", async (event) => {
      if (event.type !== "turn.done") {
        return;
      }

      seen.push("listener:start");
      await agent.waitTurn(event.turnId);
      seen.push("listener:done");
    });

    const turnId = agent.send(createUserMessage("hello"));
    const result = await Promise.race([
      agent.waitTurn(turnId),
      new Promise<symbol>((resolve) => {
        setTimeout(() => resolve(Symbol.for("timeout")), 100);
      }),
    ]);

    expect(result).not.toBe(Symbol.for("timeout"));
    expect(result).toMatchObject({ turnId, status: "done" });

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(seen).toEqual(["listener:start", "listener:done"]);
  });

  it("waitTurn rejects unknown turn ids", async () => {
    const agent = createAgent({ model: createTextModel() });

    await expect(agent.waitTurn("turn_missing")).rejects.toThrow("Turn not found");
  });

  it("waits for lazy plugin initialization before model execution", async () => {
    const calls: string[] = [];
    let releaseInit: (() => void) | undefined;
    const initReady = new Promise<void>((resolve) => {
      releaseInit = resolve;
    });
    const model = createTextModel();
    const originalDoStream = model.doStream;
    model.doStream = async (...args) => {
      calls.push("model");
      return originalDoStream.apply(model, args);
    };

    const agent = createAgent({
      model,
      plugins: [
        {
          name: "async-init",
          async init() {
            await initReady;
            calls.push("init");
          },
        },
      ],
    });

    const turnId = agent.send(createUserMessage("hello"));
    await Promise.resolve();

    expect(calls).toEqual([]);

    releaseInit?.();
    await agent.waitTurn(turnId);

    expect(calls).toEqual(["init", "model"]);
  });

  it("settles the turn as failed when required plugin init fails", async () => {
    const events: string[] = [];
    const model = createTextModel();
    const originalDoStream = model.doStream;
    model.doStream = async (...args) => {
      events.push("model");
      return originalDoStream.apply(model, args);
    };

    const agent = createAgent({
      model,
      plugins: [
        {
          name: "required-init",
          init() {
            events.push("init");
            throw new Error("init boom");
          },
        },
      ],
    });

    agent.channel.subscribe("internal", (event) => {
      if (event.type === "turn.failed") {
        events.push("turn.failed");
      }
    });

    const turnId = agent.send(createUserMessage("hello"));
    await expect(agent.waitTurn(turnId)).resolves.toMatchObject({
      turnId,
      status: "failed",
      error: expect.objectContaining({ message: "init boom" }),
    });

    expect(events).toEqual(["init", "turn.failed"]);
    const entries = await agent.storage.read();
    expect(entries.filter((entry) => entry.type === "event")).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ type: "turn.failed", turnId }),
      }),
    ]);
  });

  it("persists only abnormal terminal events and does not retry failed turns", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const model = createFailingModel(() => {
      calls += 1;
    });
    const agent = createAgent({ model });
    const turnId = agent.send(createUserMessage("hello"));

    try {
      await expect(agent.waitTurn(turnId)).resolves.toMatchObject({
        turnId,
        status: "failed",
        error: expect.objectContaining({ message: "model boom" }),
      });

      expect(calls).toBe(1);

      const entries = await agent.storage.read();
      expect(entries.filter((entry) => entry.type === "event")).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({ type: "turn.failed", turnId }),
        }),
      ]);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
