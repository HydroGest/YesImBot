import { h, type Session } from "koishi";
import { vi } from "vitest";

export function session(overrides: Record<string, unknown> = {}): Session {
  return {
    platform: "test",
    selfId: "bot-1",
    channelId: "room-1",
    isDirect: false,
    type: "message-created",
    userId: "user-1",
    messageId: "message-1",
    timestamp: 1,
    event: { type: "message", user: { name: "User" } },
    elements: [h.text("hello")],
    ...overrides,
  } as Session;
}

export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function outputs(...content: string[]) {
  return (async function* () {
    yield {
      turnId: "turn-1",
      messageId: "assistant-1",
      segments: content.map((text) => [h.text(text)]),
    };
  })();
}

export function delivery(signal?: AbortSignal) {
  return {
    fail: vi.fn(async () => ({ kind: "wait" as const, eventId: "failure-1" })),
    onDelivered: vi.fn(async () => undefined),
    signal: signal ?? new AbortController().signal,
  };
}
