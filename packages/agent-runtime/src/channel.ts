import { Awaitable } from "./types/base.js";
import type { AgentCustomChannelEvent, AgentCustomChannelEvents } from "./types/event.js";

type AgentChannelEvent<K extends keyof AgentCustomChannelEvents> = AgentCustomChannelEvent<K>;

export interface AgentChannel {
  /* prettier-ignore */
  emit: <K extends keyof AgentCustomChannelEvents>(channel: K, event: AgentChannelEvent<K>, options?: { save?: boolean }) => Awaitable<void>;
  /* prettier-ignore */
  subscribe: <K extends keyof AgentCustomChannelEvents>(channel: K, listener: K extends keyof AgentCustomChannelEvents ? AgentEventListener<AgentCustomChannelEvent<K>> : AgentEventListener) => () => void;
}

export type AgentEventListener<T = unknown> = (event: T) => Awaitable<void>;

export interface CreateAgentChannelOptions {
  persist: (event: unknown, options?: { save?: boolean }) => Awaitable<void>;
}

export const createAgentChannel = (options?: CreateAgentChannelOptions): AgentChannel => {
  const channels = new Map<string, Set<AgentEventListener>>();

  const emit: AgentChannel["emit"] = async (channel, event, emitOptions) => {
    const listeners = channels.get(channel);
    const promises: Promise<void>[] = [];

    if (listeners) {
      promises.push(
        ...Array.from(listeners).map(async (listener) => {
          try {
            await listener(event);
          } catch {}
        }),
      );
    }

    if (emitOptions?.save && options?.persist)
      promises.push(Promise.resolve().then(async () => options.persist(event, emitOptions)));

    await Promise.all(promises);
  };

  const subscribe: AgentChannel["subscribe"] = (channel, listener) => {
    if (!channels.has(channel)) channels.set(channel, new Set());

    const listeners = channels.get(channel);
    listeners!.add(listener as AgentEventListener);

    return () => {
      listeners!.delete(listener as AgentEventListener);
      if (listeners!.size === 0) channels.delete(channel);
    };
  };

  return {
    emit,
    subscribe,
  };
};
