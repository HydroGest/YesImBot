import type { LanguageModelV3, LanguageModelV3FinishReason, LanguageModelV3StreamPart } from "@ai-sdk/provider";
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
  it("wait resolves when the agent becomes idle", async () => {
    const agent = createAgent({ model: createTextModel() });
    agent.send(createUserMessage("hello"));

    await agent.wait();
    await agent.wait();

    expect(agent.isIdle()).toBe(true);
  });

  it("run returns all turn-scoped internal events", async () => {
    const agent = createAgent({ model: createTextModel() });
    const stream = agent.run(createUserMessage("hello"));
    const types: string[] = [];

    for await (const event of stream) {
      types.push(event.type);
      expect(event).toHaveProperty("turnId");
    }

    expect(types[0]).toBe("turn.queued");
    expect(types).toContain("turn.start");
    expect(types).toContain("message.appended");
    expect(types).toContain("turn.done");
    expect(types.every((type) => type !== "agent.init")).toBe(true);
  });

  it("run yields turn.failed before the stream ends", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const agent = createAgent({ model: createFailingModel() });
    const types: string[] = [];

    try {
      for await (const event of agent.run(createUserMessage("hello"))) {
        types.push(event.type);
      }

      expect(types.at(-1)).toBe("turn.failed");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("does not block turn completion when turn.done listeners await idle wait", async () => {
    const agent = createAgent({ model: createTextModel() });
    const seen: string[] = [];

    agent.channel.subscribe("internal", async (event) => {
      if (event.type !== "turn.done") {
        return;
      }

      seen.push("listener:start");
      await agent.wait();
      seen.push("listener:done");
    });

    agent.send(createUserMessage("hello"));
    const result = await Promise.race([
      agent.wait(),
      new Promise<symbol>((resolve) => {
        setTimeout(() => resolve(Symbol.for("timeout")), 100);
      }),
    ]);

    expect(result).not.toBe(Symbol.for("timeout"));
    expect(agent.isIdle()).toBe(true);

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(seen).toEqual(["listener:start", "listener:done"]);
  });

  it("wait rejects when its signal aborts before idle", async () => {
    const agent = createAgent({ model: createTextModel() });
    agent.send(createUserMessage("hello"));
    const controller = new AbortController();
    const waiting = agent.wait({ signal: controller.signal });
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    await agent.wait();
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

    agent.send(createUserMessage("hello"));
    await Promise.resolve();

    expect(calls).toEqual([]);

    releaseInit?.();
    await agent.wait();

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

    let failedTurnId: string | undefined;
    agent.channel.subscribe("internal", (event) => {
      if (event.type === "turn.failed") {
        events.push("turn.failed");
        failedTurnId = event.turnId;
      }
    });

    const turnId = agent.send(createUserMessage("hello"));
    await agent.wait();

    expect(events).toEqual(["init", "turn.failed"]);
    expect(failedTurnId).toBe(turnId);
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
      await agent.wait();
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

  it("applies prepareStep plugins before the initial model request", async () => {
    const seen: unknown[] = [];
    const model = createTextModel();
    const originalDoStream = model.doStream;
    model.doStream = async (...args) => {
      seen.push(args[0]);
      return originalDoStream.apply(model, args);
    };
    const preparedRoles: string[][] = [];
    const agent = createAgent({
      model,
      plugins: [
        {
          name: "step-envelope",
          prepareStep(messages: readonly { role: string }[]) {
            preparedRoles.push(messages.map((message) => message.role));
            return [{ role: "system", content: "before" }, ...messages, { role: "system", content: "after" }];
          },
        },
      ],
    });

    agent.send(createUserMessage("hello"));
    await agent.wait();

    expect(preparedRoles).toEqual([["user"]]);
    expect(JSON.stringify(seen)).toContain("before");
    expect(JSON.stringify(seen)).toContain("after");
  });
});
