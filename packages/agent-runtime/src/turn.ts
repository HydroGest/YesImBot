import { LanguageModelUsage } from "ai";

import { AgentBusyError, TurnNotFoundError } from "./errors.js";
import { createRandomId } from "./id.js";
import { AgentMessage } from "./types/message.js";

export type BusyBehavior = "defer" | "join" | "reject";

export interface TurnRequest {
  readonly turnId: string;
  readonly submittedAt: number;
  readonly messages: AgentMessage[];
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

function createTurnRequest(messages: AgentMessage[]): TurnRequest {
  const joined: AgentMessage[] = [];
  const joinedPersistence: Promise<void>[] = [];

  return {
    turnId: createRandomId(),
    submittedAt: Date.now(),
    messages: [...messages],
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
}

export function createTurnQueue(options: TurnQueueOptions) {
  const queue: TurnRequest[] = [];
  const retained = new Map<string, TurnResult>();
  const waiters = new Map<string, Array<(result: TurnResult) => void>>();
  let active: TurnRequest | undefined;

  function settle(result: TurnResult) {
    retained.set(result.turnId, result);
    for (const resolve of waiters.get(result.turnId) ?? []) {
      resolve(result);
    }
    waiters.delete(result.turnId);
  }

  async function pump() {
    if (active) return;

    const next = queue.shift();
    if (!next) return;

    active = next;
    try {
      settle(await options.onRun(next));
    } finally {
      active = undefined;
      void pump();
    }
  }

  return {
    get activeTurnId() {
      return active?.turnId;
    },
    enqueue(
      messages: AgentMessage[],
      behavior: BusyBehavior = "defer",
      persistence?: Promise<void>,
    ) {
      if (active && behavior === "reject") {
        throw new AgentBusyError();
      }

      if (active && behavior === "join") {
        active.addJoined(messages, persistence);
        return active.turnId;
      }

      const request = createTurnRequest(messages);
      queue.push(request);
      void pump();
      return request.turnId;
    },
    wait(turnId: string) {
      const result = retained.get(turnId);
      if (result) {
        return Promise.resolve(result);
      }

      if (active?.turnId !== turnId && !queue.some((request) => request.turnId === turnId)) {
        return Promise.reject(new TurnNotFoundError(turnId));
      }

      return new Promise<TurnResult>((resolve) => {
        waiters.set(turnId, [...(waiters.get(turnId) ?? []), resolve]);
      });
    },
  };
}
