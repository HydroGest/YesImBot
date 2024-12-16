import { Context } from "koishi";
import { Memory } from "./memory/memory";
import { Config } from "./config";

export class Bot {
  private memory: Memory;
  private memorySize: number;

  private summarySize: number; // 上下文达到多少时进行总结
  private contextSize: number; // 以对话形式给出的上下文长度
  private retainedContextSize: number; // 进行总结时保留的上下文长度，用于保持记忆连贯性

  private history: string[] = [];

  constructor(private ctx: Context, private config: Config) {}

  async addHistory(content: string) {
    this.history.push(content);
  }

  async chat(channelId, userId, content) {}

  async summarize(channelId, userId, content) {}

  /**
   * Add to archival memory. Make sure to phrase the memory contents such that it can be easily queried later.
   * @param content Content to write to the memory. All unicode (including emojis) are supported.
   * @returns void
   */
  insertArchivalMemory(content: string): void {}

  /**
   * Search archival memory using semantic (embedding-based) search.
   * @param query String to search for.
   * @param page Allows you to page through results. Only use on a follow-up query. Defaults to 0 (first page).
   * @param start Starting index for the search results. Defaults to 0.
   * @returns String[]
   */
  searchArchivalMemory(
    query: string,
    page: number = 0,
    start: number = 0
  ): string[] {
    return [];
  }

  /**
   * Append to the contents of core memory.
   * @param label Section of the memory to be edited (persona or human).
   *
   * @param content Content to write to the memory. All unicode (including emojis) are supported.
   * @returns void
   */
  appendCoreMemory(label: string, content: string): void {}

  /**
   * Search prior conversation history using case-insensitive string matching.
   * @param query String to search for.
   * @param userId  User ID to search for.
   * @param page Allows you to page through results. Only use on a follow-up query. Defaults to 0 (first page).
   */
  searchConversation(
    query: string,
    userId?: string,
    page: number = 0,

  ): string[] {
    return [];
  }

  /**
   * Search prior conversation history using a date range.
   * @param start The start of the date range to search, in the format 'YYYY-MM-DD'.
   * @param end The end of the date range to search, in the format 'YYYY-MM-DD'.
   * @param page Allows you to page through results. Only use on a follow-up query. Defaults to 0 (first page).
   */
  searchConversationWithDate(query: string, start: string, end: string, page: number) {}
}
