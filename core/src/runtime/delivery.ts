export class OutputQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private pendingNext:
    | { resolve: (result: IteratorResult<T>) => void; reject: (cause: unknown) => void }
    | undefined;
  private error: unknown;
  private done = false;

  push(item: T): void {
    if (this.done) return;
    const pendingNext = this.pendingNext;
    this.pendingNext = undefined;
    if (pendingNext) pendingNext.resolve({ done: false, value: item });
    else this.items.push(item);
  }

  close(error?: unknown): void {
    if (this.done) return;
    this.done = true;
    this.error = error;
    const pendingNext = this.pendingNext;
    this.pendingNext = undefined;
    if (!pendingNext) return;
    if (error) pendingNext.reject(error);
    else pendingNext.resolve({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        const item = this.items.shift();
        if (item !== undefined) return { done: false, value: item };
        if (this.error) throw this.error;
        if (this.done) return { done: true, value: undefined };
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.pendingNext = { resolve, reject };
        });
      },
    };
  }
}

export interface DeliveryState {
  acquireDeliveryLease(): () => void;
  waitForDeliveries(): Promise<void>;
  complete(turnId: string): Promise<void>;
  deliverySignal(turnId: string): AbortSignal;
  releaseDelivery(turnId: string): void;
  abortDelivery(turnId: string): void;
  openDelivery(turnId: string): void;
  clear(): void;
}

export function createDeliveryState(options: {
  readonly onReply: (() => Promise<void>) | undefined;
  readonly warn: (event: string, fields: Record<string, unknown>) => void;
}): DeliveryState {
  let leases = Number();
  const waiters = new Set<() => void>();
  const aborts = new Map<string, AbortController>();
  const acknowledged = new Set<string>();

  return {
    acquireDeliveryLease() {
      leases += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        leases -= 1;
        if (leases !== 0) return;
        const pending = [...waiters];
        for (const resolve of pending) {
          waiters.delete(resolve);
          resolve();
        }
      };
    },
    waitForDeliveries() {
      if (leases === 0) return Promise.resolve();
      return new Promise((resolve) => waiters.add(resolve));
    },
    async complete(turnId) {
      if (acknowledged.has(turnId)) return;
      acknowledged.add(turnId);
      try {
        await options.onReply?.();
      } catch (cause) {
        options.warn("will_reply_failed", { cause });
      }
    },
    deliverySignal(turnId) {
      const controller = aborts.get(turnId);
      if (!controller) throw new Error(`Delivery signal is unavailable for turn ${turnId}`);
      return controller.signal;
    },
    releaseDelivery(turnId) {
      aborts.delete(turnId);
      acknowledged.delete(turnId);
    },
    abortDelivery(turnId) {
      aborts.get(turnId)?.abort();
    },
    openDelivery(turnId) {
      aborts.set(turnId, new AbortController());
    },
    clear() {
      for (const controller of aborts.values()) controller.abort();
      aborts.clear();
      acknowledged.clear();
    },
  };
}
