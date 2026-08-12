export class OutputQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<{ resolve: (result: IteratorResult<T>) => void; reject: (cause: unknown) => void }> = [];
  private done = false;
  private failure: unknown;

  public push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else this.values.push(value);
  }

  public close(failure?: unknown): void {
    this.done = true;
    this.failure = failure;
    for (const waiter of this.waiters.splice(0)) {
      if (failure) waiter.reject(failure);
      else waiter.resolve({ value: undefined as never, done: true });
    }
  }

  public async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (;;) {
      if (this.values.length) yield this.values.shift()!;
      else if (this.done) {
        if (this.failure) throw this.failure;
        return;
      } else {
        const result = await new Promise<IteratorResult<T>>((resolve, reject) => this.waiters.push({ resolve, reject }));
        if (result.done) return;
        yield result.value;
      }
    }
  }
}
