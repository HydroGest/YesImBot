export interface SerialQueue {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

export function serialQueue(): SerialQueue {
  let tail: Promise<void> = Promise.resolve();
  return {
    run(operation) {
      const next = tail.then(operation, operation);
      tail = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
}
