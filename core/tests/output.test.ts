import { describe, expect, it } from "vitest";

import { OutputQueue } from "../src/runtimes/output.js";

describe("OutputQueue", () => {
  it("returns normally when closed before any value is consumed", async () => {
    const queue = new OutputQueue<{ segments: string[] }>();
    queue.close();

    await expect(Array.fromAsync(queue)).resolves.toEqual([]);
  });

  it("does not yield undefined to a waiting consumer when closed without output", async () => {
    const queue = new OutputQueue<{ segments: string[] }>();
    const values: unknown[] = [];
    const reading = (async () => {
      for await (const value of queue) values.push(value);
    })();
    await Promise.resolve();

    queue.close();
    await reading;

    expect(values).toEqual([]);
  });

  it("delivers buffered values and then closes", async () => {
    const queue = new OutputQueue<number>();
    queue.push(1);
    queue.push(2);
    queue.close();

    await expect(Array.fromAsync(queue)).resolves.toEqual([1, 2]);
  });

  it("rejects waiting consumers when closed with a failure", async () => {
    const queue = new OutputQueue<number>();
    const reading = Array.fromAsync(queue);
    await Promise.resolve();

    queue.close(new Error("boom"));

    await expect(reading).rejects.toThrow("boom");
  });
});
