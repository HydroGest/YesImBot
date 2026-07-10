import { LanguageModelUsage } from "ai";

import { AgentBusyError } from "./errors.js";
import { createRandomId } from "./id.js";
import { AgentMessage } from "./types/message.js";

export type BusyBehavior = "defer" | "join" | "reject";

export interface TurnRequest {
  readonly turnId: string;
  readonly submittedAt: number;
  readonly messages: AgentMessage[];
  readonly signal: AbortSignal;
  addJoined(messages: AgentMessage[], persistence?: Promise<void>): void;
  drainJoined(): Promise<AgentMessage[]>;
}

export interface TurnQueueOptions {
  onRun(request: TurnRequest): Promise<TurnResult>;
}

export type TurnStatus = "queued" | "running" | "done" | "failed" | "aborted";

export interface TurnError {
  name: string;
  message: string;
  cause?: string;
}

export interface TurnResult {
  turnId: string;
  status: Exclude<TurnStatus, "queued" | "running">;
  messages: AgentMessage[];
  error?: TurnError;
  usage?: Partial<LanguageModelUsage>;
}

export interface AgentWaitOptions {
  signal?: AbortSignal;
}

interface QueuedTurn {
  request: TurnRequest;
  controller: AbortController;
}

function createQueuedTurn(messages: AgentMessage[]): QueuedTurn {
  const controller = new AbortController();
  const joined: AgentMessage[] = [];
  const joinedPersistence: Promise<void>[] = [];

  const request: TurnRequest = {
    turnId: createRandomId(),
    submittedAt: Date.now(),
    messages: [...messages],
    signal: controller.signal,
    addJoined(nextMessages, persistence) {
      joined.push(...nextMessages);
      if (persistence) {
        joinedPersistence.push(persistence);
      }
    },
    async drainJoined() {
      if (joinedPersistence.length > 0) {
        const pending = joinedPersistence.splice(0, joinedPersistence.length);
        await Promise.all(pending);
      }
      return joined.splice(0, joined.length);
    },
  };

  return { request, controller };
}

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

export function createTurnQueue(options: TurnQueueOptions) {
  const queue: QueuedTurn[] = [];
  const idleWaiters = new Set<{
    resolve: () => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  }>();

  let active: QueuedTurn | undefined;
  let activeDone: Promise<void> | undefined;
  let pumping = false;

  const isIdle = () => active === undefined && queue.length === 0 && !pumping;

  const notifyIdleWaiters = () => {
    if (!isIdle()) {
      return;
    }

    for (const waiter of [...idleWaiters]) {
      idleWaiters.delete(waiter);
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener("abort", waiter.onAbort);
      }
      waiter.resolve();
    }
  };

  async function pump() {
    if (active || pumping) {
      return;
    }

    const next = queue.shift();
    if (!next) {
      notifyIdleWaiters();
      return;
    }

    pumping = true;
    active = next;

    let settleActive!: () => void;
    activeDone = new Promise<void>((resolve) => {
      settleActive = resolve;
    });

    try {
      await options.onRun(next.request);
    } finally {
      active = undefined;
      const done = settleActive;
      activeDone = undefined;
      pumping = false;
      done();
      void pump();
      notifyIdleWaiters();
    }
  }

  return {
    get activeTurnId() {
      return active?.request.turnId;
    },
    isIdle,
    enqueue(
      messages: AgentMessage[],
      behavior: BusyBehavior = "defer",
      persistence?: Promise<void>,
    ) {
      if (active && behavior === "reject") {
        throw new AgentBusyError();
      }

      if (active && behavior === "join") {
        active.request.addJoined(messages, persistence);
        return active.request.turnId;
      }

      const queued = createQueuedTurn(messages);
      queue.push(queued);
      void pump();
      return queued.request.turnId;
    },
    wait(options: AgentWaitOptions = {}) {
      const { signal } = options;

      if (signal?.aborted) {
        return Promise.reject(createAbortError());
      }

      if (isIdle()) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve, reject) => {
        const waiter: {
          resolve: () => void;
          reject: (error: unknown) => void;
          signal?: AbortSignal;
          onAbort?: () => void;
        } = {
          resolve,
          reject,
          signal,
        };

        waiter.onAbort = () => {
          idleWaiters.delete(waiter);
          reject(createAbortError());
        };

        idleWaiters.add(waiter);
        signal?.addEventListener("abort", waiter.onAbort, { once: true });
      });
    },
    async interrupt(reason?: unknown) {
      if (!active) {
        return;
      }

      if (!active.controller.signal.aborted) {
        active.controller.abort(reason);
      }

      await activeDone?.then(
        () => undefined,
        () => undefined,
      );
    },
  };
}
