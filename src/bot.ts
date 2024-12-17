import { Context, Random, Session } from "koishi";
import JSON5 from "json5";

import { Memory } from "./memory/memory";
import { Config } from "./config";
import { escapeUnicodeCharacters } from "./utils/string";
import { EmbeddingsConfig } from "./embeddings";
import { EmojiManager } from "./managers/emojiManager";
import { BaseAdapter, Usage } from "./adapters/base";
import { EmbeddingsBase } from "./embeddings/base";
import { AdapterSwitcher } from "./adapters";
import { getEmbedding } from "./utils/factory";
import { Message } from "./adapters/creators/component";
import { SendQueue, MarkType } from "./services/sendQueue";
import { ResponseVerifier } from "./utils/verifier";

interface Function {
  name: string;
  params: { [key: string]: any };
}

export interface SuccessResponse {
  status: "success";
  finalReply: string;
  replyTo: string;
  quote: string;
  nextTriggerCount: number;
  logic: string;
  functions: Array<Function>;
  usage: Usage;
  adapterIndex: number;
}

export interface SkipResponse {
  status: "skip";
  content: string;
  nextTriggerCount: number;
  logic: string;
  functions: Array<Function>;
  usage: Usage;
  adapterIndex: number;
}

export interface FailedResponse {
  status: "fail";
  content: string;
  reason: string;
  usage: Usage;
  adapterIndex: number;
}

export interface FunctionResponse {
  status: "function";
  functions: Array<Function>;
  logic: string;
  usage: Usage,
  adapterIndex: number;
}

export class Bot {
  private memory: Memory;
  private memorySize: number;

  private summarySize: number; // 上下文达到多少时进行总结
  private contextSize: number; // 以对话形式给出的上下文长度
  private retainedContextSize: number; // 进行总结时保留的上下文长度，用于保持记忆连贯性

  private minTriggerCount: number;
  private maxTriggerCount: number;
  private allowErrorFormat: boolean;

  private history: Message[] = [];

  private emojiManager: EmojiManager;
  private adapter: BaseAdapter;
  private embedder: EmbeddingsBase;
  readonly verifier: ResponseVerifier;

  private adapterSwitcher: AdapterSwitcher;

  constructor(private ctx: Context, private config: Config) {
    this.minTriggerCount = config.MemorySlot.MinTriggerCount;
    this.maxTriggerCount = config.MemorySlot.MaxTriggerCount;
    this.allowErrorFormat = config.Settings.AllowErrorFormat;
    this.adapterSwitcher = new AdapterSwitcher(
      config.API.APIList,
      config.Parameters
    );
    if (config.Embedding.Enabled) {
      this.emojiManager = new EmojiManager(config.Embedding);
      this.embedder = getEmbedding(config.Embedding)
    };
    if (config.Verifier.Enabled) this.verifier = new ResponseVerifier(config);
  }

  updateConfig(config: Config) {
    this.config = config;
    this.adapterSwitcher.updateConfig(config.API.APIList, config.Parameters);
  }

  async generateResponse(messages: Message[], debug = false): Promise< SuccessResponse | SkipResponse | FailedResponse | FunctionResponse > {
    let { current, adapter } = this.adapterSwitcher.getAdapter();

    if (!adapter) {
      throw new Error("没有可用的适配器");
    }

    const response = await adapter.chat(messages, debug);
    let content = response.message.content;

    if (typeof content !== "string") {
      content = JSON5.stringify(content, null, 2);
    }

    // TODO: 在这里指定 LLM 的回复格式，动态构建提示词

    let status: string = "success";
    let finalResponse: string = "";
    let finalLogic: string = "";
    let replyTo: string = "";
    let nextTriggerCount: number = Random.int(this.minTriggerCount, this.maxTriggerCount + 1); // 双闭区间
    let functions: Function[] = [];
    let reason: string;

    // 提取JSON部分
    const jsonMatch = content.match(/{.*}/s);
    let LLMResponse: any = {};

    if (jsonMatch) {
      try {
        LLMResponse = JSON5.parse(escapeUnicodeCharacters(jsonMatch[0]));
      } catch (e) {
        status = "fail";
        reason = `JSON 解析失败: ${e.message}`;
        if (debug) logger.warn(reason);
        return {
          status: "fail",
          content,
          usage: response.usage,
          reason,
          adapterIndex: current,
        };
      }
    } else {
      status = "fail"; // 没有找到 JSON
      reason = `没有找到 JSON: ${content}`;
      if (debug) logger.warn(reason);
      return {
        status: "fail",
        content,
        usage: response.usage,
        reason,
        adapterIndex: current,
      };
    }

    // 规范化 nextTriggerCount，确保在设置的范围内
    const nextTriggerCountbyLLM = Math.max(
      this.minTriggerCount,
      Math.min(LLMResponse.nextReplyIn ?? this.minTriggerCount, this.maxTriggerCount)
    );
    nextTriggerCount = Number(nextTriggerCountbyLLM) || nextTriggerCount;
    finalLogic = LLMResponse.logic || "";

    if (LLMResponse.functions && Array.isArray(LLMResponse.functions)) {
      functions = LLMResponse.functions;
    } else {
      functions = [];
    }

    // 检查 status 字段
    if (LLMResponse.status === "success") {
      status = LLMResponse.status;
    } else if (LLMResponse.status === "skip") {
      status = "skip";
      return {
        status: "skip",
        content,
        nextTriggerCount,
        logic: finalLogic,
        usage: response.usage,
        functions: LLMResponse.functions,
        adapterIndex: current,
      };
    } else if (LLMResponse.status === "function") {
      status = "function";
      for (let func of LLMResponse.functions) {
        let funcName = func.name;
        let funcArgs = func.arguments;
      }
      return {
        status: "function",
        logic: finalLogic,
        functions: LLMResponse.functions,
        usage: response.usage,
        adapterIndex: current,
      }

    } else {
      status = "fail";
      reason = `status 不是一个有效值: ${content}`;
      if (debug) logger.warn(reason);
      return {
        status: "fail",
        content,
        usage: response.usage,
        reason,
        adapterIndex: current,
      };
    }

    // 构建 finalResponse
    if (!this.allowErrorFormat) {
      if (LLMResponse.finalReply || LLMResponse.reply) {
        finalResponse += LLMResponse.finalReply || LLMResponse.reply || "";
      } else {
        status = "fail";
        reason = `回复格式错误: ${content}`;
        if (debug) logger.warn(reason);
        return {
          status: "fail",
          content,
          usage: response.usage,
          reason,
          adapterIndex: current,
        };
      }
    } else {
      finalResponse += LLMResponse.finalReply || LLMResponse.reply || "";
      // 兼容弱智模型的错误回复
      const possibleResponse = [
        LLMResponse.msg,
        LLMResponse.text,
        LLMResponse.message,
        LLMResponse.answer,
      ];
      for (const resp of possibleResponse) {
        if (resp) {
          finalResponse += resp || "";
          break;
        }
      }
    }

    // 提取其他字段
    replyTo = LLMResponse.replyTo || "";
    // 如果 replyTo 不是私聊会话，只保留数字部分
    if (replyTo && !replyTo.startsWith("private:")) {
      const numericMatch = replyTo.match(/\d+/);
      if (numericMatch) {
        replyTo = numericMatch[0].replace(/\s/g, "");
      }
    }

    // 反转义 <face> 消息
    const faceRegex = /\[表情[:：]\s*([^\]]+)\]/g;
    const matches = Array.from(finalResponse.matchAll(faceRegex));

    const replacements = await Promise.all(
      matches.map(async (match) => {
        const name = match[1];
        let id = await this.emojiManager.getIdByName(name);
        if (!id) {
          id = (await this.emojiManager.getIdByName(await this.emojiManager.getNameByTextSimilarity(name))) || "500";
        }
        return {
          match: match[0],
          replacement: `<face id="${id}" name="${(await this.emojiManager.getNameById(id)) || undefined}"></face>`,
        };
      })
    );

    replacements.forEach(({ match, replacement }) => {
      finalResponse = finalResponse.replace(match, replacement);
    });
    return {
      status: "success",
      finalReply: finalResponse,
      replyTo,
      quote: LLMResponse.quote || "",
      nextTriggerCount,
      logic: finalLogic,
      functions,
      usage: response.usage,
      adapterIndex: current,
    };
  }

  async summarize(channelId, userId, content) {}

  async runFunction() {}

  // ### Memory [last modified: ${DataModified}]
  // ${RecallMemorySize} previous messages between you and the user are stored in recall memory (use functions to access them)
  // ${ArchivalMemorySize} total memories you created are stored in archival memory (use functions to access them)

  // Core memory shown below (limited in size, additional information stored in archival / recall memory):
  // <persona characters="${Used}/${Total}">
  // </persona>
  // <human characters="${Used}/${Total}">
  //   <${UserName}>
  //   </${UserName}>
  //   <${UserName}>
  //   </${UserName}>
  // </human>

  async getCoreMemory(channelId, userId) {}

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
    page: number = 0
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
