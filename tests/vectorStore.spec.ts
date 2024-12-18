import path from "path";
import assert from "assert";
import { readFileSync } from "fs";
import { beforeAll, afterAll, jest, it, describe } from "@jest/globals";

import { Memory } from "../src/memory/memory";
import { isEmpty } from "../src/utils/string";

describe("vectorStore", () => {
  const memory = new Memory({
    APIType: "Ollama",
    BaseURL: "http://localhost:11434",
    EmbeddingModel: "nomic-embed-text",
  });


  it("addMessage", async () => {

    const tasks: (() => Promise<void>)[] = [];
    readFileSync(path.join(__dirname, "./article.txt"), "utf-8")
      .split(/[\n\.\。\；]/)
      .filter((line) => !isEmpty(line))
      .forEach(async (line) => {
        tasks.push(() => memory.addMessage(line.trim(), "user"));
      });

    readFileSync(path.join(__dirname, "./test.txt"), "utf-8")
      .split(/[\w\s]*[\n]/)
      .filter((line) => !isEmpty(line))
      .forEach(async (line) => {
        const [s1, s2, score] = line.split("\t");
        tasks.push(() => memory.addMessage(s1, "system"));
        tasks.push(() => memory.addMessage(s2, "system"));
      })

    console.log(`tasks length: ${tasks.length}`);

    await parallelLimit(tasks, 32);

    console.log("memory length: ", (await memory.getHistory()).length);

    console.time("getSimilarMessages");
    const data = await memory.getSimilarMessages("what fruit is my favorite", 3);
    console.timeEnd("getSimilarMessages");
    console.log(data);

    assert.deepEqual(data, [
      "My favorite fruit is apple",
      "I like apple",
      "I like orange",
    ]);
  });
});


async function parallelLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = [];
  const queue: (() => Promise<T>)[] = [...tasks]; // 任务队列

  async function runTask(task: () => Promise<T>) {
    const result = await task();
    results.push(result);
  }

  const workers = Array.from({ length: limit }, () =>
    (async () => {
      while (queue.length > 0) {
        const task = queue.shift(); // 从队列中取出任务
        if (task) await runTask(task);
      }
    })()
  );

  await Promise.all(workers); // 等待所有任务完成
  return results;
}
