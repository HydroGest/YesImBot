import path from "path";
import assert from "assert";
import { beforeAll, afterAll, jest, it, describe } from "@jest/globals";

import { Memory } from "../src/memory/memory";

describe("vectorStore", () => {
  const memory = new Memory({
    APIType: "Custom",
    BaseURL: "http://localhost:11434/api/embeddings",
    APIKey: "sk-xxxxxxx",
    EmbeddingModel: "nomic-embed-text",
    RequestBody: '{"prompt": "<text>", "model": "<model>"}',
    GetVecRegex: '(?<="embedding":).*?(?=})',
  });

  it("addMessage", async () => {
    await memory.addMessage("i like apple", "user");
    await memory.addMessage("apple is red", "user");
    await memory.addMessage("i like orange", "user");
    await memory.addMessage("orange is orange", "user");
    await memory.addMessage("my favorite fruit is apple", "user");
    await memory.addMessage("i think cat is cute", "user");
    await memory.addMessage("the sky is blue", "user");
    await memory.addMessage("the earth is round", "user");
    await memory.addMessage("life is colorful", "user");
    await memory.addMessage("my birthday is...", "user");
    await memory.addMessage("PHP is my favorite programming language", "user");

    console.time("getSimilarMessages");
    const data = await memory.getSimilarMessages("what fruit is my favorite", 3);
    console.timeEnd("getSimilarMessages");
    console.log(data);

    assert.deepEqual(data, [
      "my favorite fruit is apple",
      "i like apple",
      "i like orange",
    ]);
  });
});
