import { Context } from "@koishijs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value?: T): void;
  reject(error: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve: (value) => resolve(value as T), reject };
}

const runtimeState = vi.hoisted(() => ({
  activeTurnId: undefined as string | undefined,
  runGate: undefined as { promise: Promise<void>; resolve(): void } | undefined,
  runs: [] as string[],
  sends: [] as string[],
  appends: [] as string[],
  getActiveTurnId: vi.fn(),
  run: vi.fn(),
  send: vi.fn(),
  append: vi.fn(),
  reset() {
    this.activeTurnId = undefined;
    this.runGate = undefined;
    this.runs = [];
    this.sends = [];
    this.appends = [];
    this.getActiveTurnId.mockReset();
    this.getActiveTurnId.mockImplementation(() => this.activeTurnId);
    this.run.mockReset();
    this.run.mockImplementation((message: { data: { messageId: string } }) => {
      this.runs.push(message.data.messageId);
      this.activeTurnId = `turn-${message.data.messageId}`;
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: "turn.start", turnId: runtimeState.activeTurnId! };
          await runtimeState.runGate?.promise;
          runtimeState.activeTurnId = undefined;
          yield { type: "turn.done", turnId: `turn-${message.data.messageId}` };
        },
      };
    });
    this.send.mockReset();
    this.send.mockImplementation((message: { data: { messageId: string } }) => {
      this.sends.push(message.data.messageId);
      return this.activeTurnId!;
    });
    this.append.mockReset();
    this.append.mockImplementation(async (message: { data: { messageId: string } }) => {
      this.appends.push(message.data.messageId);
    });
  },
}));

vi.mock("@yesimbot/agent-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@yesimbot/agent-runtime")>();
  return {
    ...actual,
    createAgent: vi.fn(() => ({
      id: "runtime",
      channel: { emit: vi.fn(), subscribe: vi.fn(() => () => undefined) },
      storage: {} as never,
      state: {} as never,
      init: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      append: runtimeState.append,
      send: runtimeState.send,
      run: runtimeState.run,
      wait: vi.fn(async () => undefined),
      interrupt: vi.fn(async () => {
        runtimeState.activeTurnId = undefined;
        runtimeState.runGate?.resolve();
      }),
      setTools: vi.fn(),
      getModel: vi.fn(),
      setModel: vi.fn(),
      clear: vi.fn(async () => undefined),
      getActiveTurnId: runtimeState.getActiveTurnId,
      isIdle: vi.fn(() => runtimeState.activeTurnId === undefined),
    })),
  };
});

vi.mock("../src/runtime/storage.js", () => ({
  createJsonlStorage: vi.fn(() => ({
    append: vi.fn(async () => undefined),
    read: vi.fn(async () => []),
    clear: vi.fn(async () => undefined),
  })),
}));

vi.mock("../src/channel.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/channel.js")>();
  return { ...actual, ensureChannelScopeRecord: vi.fn(async () => undefined) };
});

import type { Config } from "../src/config.js";
import { YesImBotService } from "../src/runtime/service.js";
import { createTestPlatformService } from "./platform-service-helper.js";

const config: Config = { basePath: "data/yesimbot-core", chatModel: "mock:model" };

function createContext() {
  const ctx = new Context();
  ctx.baseDir = "/tmp/athena";
  (ctx as Context & { "yesimbot.model": { resolveChatModel(): { model: { modelId: string } } } })[
    "yesimbot.model"
  ] = { resolveChatModel: () => ({ model: { modelId: "mock:model" } }) };
  return ctx;
}

function session(kind: "private" | "group", overrides: Record<string, unknown> = {}) {
  return {
    platform: "test",
    selfId: "bot",
    channelId: "room",
    userId: "user",
    messageId: "m1",
    content: kind === "private" ? "hello" : "observation",
    subtype: kind === "private" ? "private" : undefined,
    isDirect: kind === "private",
    send: vi.fn(async () => undefined),
    ...overrides,
  } as never;
}

function prepareGate() {
  const entered = createDeferred<void>();
  const release = createDeferred<void>();
  return {
    entered: entered.promise,
    release: () => release.resolve(),
    async wait() {
      entered.resolve();
      await release.promise;
    },
  };
}

function createHarness() {
  const ctx = createContext();
  const platform = createTestPlatformService({ ctx: ctx as never });
  const gates: Array<ReturnType<typeof prepareGate>> = [];
  platform.register({
    id: "test",
    platform: "test",
    async prepare({ message }) {
      const gate = gates.shift();
      if (gate) await gate.wait();
      return message.elements;
    },
  });
  return {
    service: new YesImBotService(ctx, config),
    nextGate() {
      const gate = prepareGate();
      gates.push(gate);
      return gate;
    },
  };
}

describe("channel lifecycle", () => {
  beforeEach(() => runtimeState.reset());

  it("reads busy after preparation so an ended turn starts a new run", async () => {
    const { service, nextGate } = createHarness();
    runtimeState.runGate = createDeferred<void>();
    const first = service.handleSession(session("private", { messageId: "a" }));
    await vi.waitFor(() => expect(runtimeState.runs).toEqual(["a"]));

    const gate = nextGate();
    const second = service.handleSession(session("private", { messageId: "b" }));
    await gate.entered;
    runtimeState.runGate.resolve();
    await first;
    gate.release();
    await second;

    expect(runtimeState.runs).toEqual(["a", "b"]);
    expect(runtimeState.sends).toEqual([]);
  });

  it("submits join synchronously after the final busy read", async () => {
    const { service } = createHarness();
    runtimeState.activeTurnId = "turn-a";
    runtimeState.getActiveTurnId.mockImplementation(() => {
      queueMicrotask(() => {
        runtimeState.activeTurnId = undefined;
      });
      return "turn-a";
    });

    await service.handleSession(session("private", { messageId: "b" }));

    expect(runtimeState.sends).toEqual(["b"]);
    expect(runtimeState.runs).toEqual([]);
  });

  it("joins a simultaneous second reply into the first active turn", async () => {
    const { service } = createHarness();
    runtimeState.runGate = createDeferred<void>();

    const first = service.handleSession(session("private", { messageId: "a" }));
    const second = service.handleSession(session("private", { messageId: "b" }));
    await vi.waitFor(() => expect(runtimeState.runs).toEqual(["a"]));
    await vi.waitFor(() => expect(runtimeState.sends).toEqual(["b"]));

    runtimeState.runGate.resolve();
    await Promise.all([first, second]);

    expect(runtimeState.runs).toEqual(["a"]);
    expect(runtimeState.sends).toEqual(["b"]);
  });

  it("prepares different channels concurrently", async () => {
    const { service, nextGate } = createHarness();
    runtimeState.runGate = createDeferred<void>();
    const gateA = nextGate();
    const gateB = nextGate();

    const first = service.handleSession(session("private", { channelId: "a", messageId: "a" }));
    const second = service.handleSession(session("private", { channelId: "b", messageId: "b" }));
    await Promise.all([gateA.entered, gateB.entered]);

    gateA.release();
    gateB.release();
    await vi.waitFor(() => expect(runtimeState.runs.length + runtimeState.sends.length).toBe(2));
    runtimeState.runGate.resolve();
    await Promise.all([first, second]);
  });

  it("does not hold the FIFO while consuming a model stream", async () => {
    const { service } = createHarness();
    runtimeState.runGate = createDeferred<void>();
    const first = service.handleSession(session("private", { messageId: "a" }));
    await vi.waitFor(() => expect(runtimeState.runs).toEqual(["a"]));

    await service.handleSession(session("group", { messageId: "observation" }));
    expect(runtimeState.appends).toEqual(["observation"]);

    runtimeState.runGate.resolve();
    await first;
  });

  it("continues the channel queue after a failed lifecycle item", async () => {
    const { service } = createHarness();
    runtimeState.append.mockImplementationOnce(async () => {
      throw new Error("append failed");
    });

    await service.handleSession(session("group", { messageId: "bad" }));
    await service.handleSession(session("group", { messageId: "good" }));

    expect(runtimeState.appends).toEqual(["good"]);
  });
});
