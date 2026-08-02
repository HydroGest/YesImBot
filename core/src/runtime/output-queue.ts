export class OutputQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private pendingNext: { resolve: (result: IteratorResult<T>) => void; reject: (cause: unknown) => void } | undefined;
  private error: unknown;
  private done = false;

  public push(item: T): void {
    if (this.done) return;
    const pendingNext = this.pendingNext;
    this.pendingNext = undefined;
    if (pendingNext) pendingNext.resolve({ done: false, value: item });
    else this.items.push(item);
  }

  public close(error?: unknown): void {
    if (this.done) return;
    this.done = true;
    this.error = error;
    const pendingNext = this.pendingNext;
    this.pendingNext = undefined;
    if (!pendingNext) return;
    if (error) pendingNext.reject(error);
    else pendingNext.resolve({ done: true, value: undefined });
  }

  public [Symbol.asyncIterator](): AsyncIterator<T> {
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
