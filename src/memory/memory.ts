import { Context } from "koishi";

import { BaseAdapter } from "../adapters/base";
import { Message, SystemMessage, UserMessage } from "../adapters/creators/component";
import { Config } from "../config";
import { EmbeddingsBase } from "../embeddings/base";
import { getAdapter, getEmbedding } from "../utils/factory";
import { MemoryBase, MemoryConfig } from "./base";
import { FACT_RETRIEVAL_PROMPT } from "./prompts";
import { MemoryVectorStore, getMagnitude } from "./vectorStore";
import { isEmpty } from "../utils/string";

export class Memory extends MemoryBase {
  private vectorStore: MemoryVectorStore;

  private llm: BaseAdapter;
  private embedder: EmbeddingsBase;

  constructor(
    ctx: Context,
    config: MemoryConfig,
    parameters?: Config["Parameters"]
  ) {
    super();

    this.vectorStore = new MemoryVectorStore(ctx);
    this.llm = getAdapter(config.llm, parameters);
    this.embedder = getEmbedding(config.embedder);
  }

  get(memoryId: string): Promise<any> {
    throw new Error("Method not implemented.");
  }
  getAll(): Promise<any[]> {
    throw new Error("Method not implemented.");
  }
  update(memoryId: string, data: any): Promise<void> {
    throw new Error("Method not implemented.");
  }
  delete(memoryId: string): Promise<void> {
    throw new Error("Method not implemented.");
  }
  history(memoryId: string): Promise<void> {
    throw new Error("Method not implemented.");
  }

  async add(messages: string | Message[], userId?: string) {
    // 统一 messages 为数组形式
    let messageArray: Message[];
    if (typeof messages === "string") {
      if (isEmpty(messages)) return;
      messageArray = [{ role: "user", content: messages }];
    } else {
      messageArray = messages;
    }

    const userPrompt = parseMessages(messageArray);

    // 生成响应
    const response = await this.llm.chat([
      SystemMessage(FACT_RETRIEVAL_PROMPT),
      UserMessage(userPrompt),
    ]);

    let new_retrieved_facts: (string | { userId: string; content: string })[] =
      [];
    try {
      const parsedResponse = JSON.parse(response.message.content);
      new_retrieved_facts = parsedResponse.facts || [];
    } catch (error) {
      console.error(`Error parsing JSON response:`, error);
    }

    // 并行嵌入操作
    const embeddingPromises = new_retrieved_facts.map(async (newMem) => {
      let content: string;
      if (typeof newMem === "string") {
        content = newMem;
      } else {
        content = newMem.content;
      }
      try {
        const embedding = await this.embedder.embed(content);
        const magnitude = getMagnitude(embedding);
        const metadata = {
          content,
          createdAt: new Date().getTime(),
          userId,
        };
        return { embedding, magnitude, metadata };
      } catch (error) {
        console.error(`Error embedding content:`, error);
        return null;
      }
    });

    const embeddingResults = await Promise.all(embeddingPromises);
    const vectors = embeddingResults.map((result) => result.embedding);
    const metadatas = embeddingResults.map((result) => result.metadata);

    // 添加向量
    try {
      await this.vectorStore.addVectors(vectors, metadatas);
    } catch (error) {
      console.error(`Error adding vectors to store:`, error);
    }
  }

  // search("")
  async search(
    query: string,
    limit: number = 5,
    userId?: string
  ): Promise<string[]> {
    const embedding = await this.embedder.embed(query);

    const result = await this.vectorStore.similaritySearchVectorWithScore(
      embedding,
      limit
    );
    const response = result.map((item) => item[0].content);
    return response;
  }
}

function parseMessages(messages: Message[]): string {
  let response = "";
  for (const message of messages) {
    if (message.role === "user") {
      response += `user: ${message.content}\n`;
    }
    if (message.role === "assistant") {
      response += `assistant: ${message.content}\n`;
    }
    if (message.role === "system") {
      response += `system: ${message.content}\n`;
    }
  }
  return response;
}
