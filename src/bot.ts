import { Context, Random } from "koishi";
import JSON5 from "json5";

import { Memory } from "./memory/memory";
import { Config } from "./config";
import { escapeUnicodeCharacters, isEmpty } from "./utils/string";
import { EmojiManager } from "./managers/emojiManager";
import { BaseAdapter, Usage } from "./adapters/base";
import { EmbeddingsBase } from "./embeddings/base";
import { AdapterSwitcher } from "./adapters";
import { getEmbedding } from "./utils/factory";
import { Message, SystemMessage } from "./adapters/creators/component";
import { ResponseVerifier } from "./utils/verifier";
import { SendQueue } from "./services/sendQueue";
import { Extension, getExtensions } from "./extensions/base";
import { ImageViewer } from "./services/imageViewer";

export interface Function {
  name: string;
  params: {
    [key: string]: any;
  }
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
  private prompt: string; // 系统提示词
  private tools: { [key: string]: Extension & Function };
  private messageQueue: SendQueue;
  private lastModified: number = 0;

  private emojiManager: EmojiManager;
  private embedder: EmbeddingsBase;
  readonly verifier: ResponseVerifier;
  readonly imageViewer: ImageViewer;

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
      this.embedder = getEmbedding(config.Embedding);
      this.memory = new Memory(ctx, config.API.APIList[0], config.Embedding, config.Parameters);
    };
    if (config.Verifier.Enabled) this.verifier = new ResponseVerifier(config);

    this.imageViewer = new ImageViewer(config);
    
    this.messageQueue = new SendQueue(ctx, config);

    this.tools = {};
    for (const extension of getExtensions()) {
      // @ts-ignore
      this.tools[extension.name] = extension;
    }
  }

  updateConfig(config: Config) {
    this.config = config;
    this.adapterSwitcher.updateConfig(config.API.APIList, config.Parameters);
  }

  setSystemPrompt(content: string) {
    this.prompt = content;
  }

  setChatHistory(chatHistory: string) {
    this.history = [];
    for (const line of chatHistory.split("\n")) {
      this.history.push({ role: "user", content: line });
    }
  }

  async generateResponse(messages: Message[], debug = false): Promise< SuccessResponse | SkipResponse | FailedResponse> {
    let { current, adapter } = this.adapterSwitcher.getAdapter();

    if (!adapter) {
      throw new Error("没有可用的适配器");
    }

    this.history.push(...messages);

    const response = await adapter.chat([SystemMessage(this.prompt), ...this.history], debug);

    this.history.push({ role: "assistant", content: JSON.stringify(JSON.parse(response.message.content)) });

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
        nextTriggerCount,
        logic: finalLogic,
        usage: response.usage,
        functions: LLMResponse.functions,
        adapterIndex: current,
      };
    } else if (LLMResponse.status === "function") {
      status = "function";
      let funcReturns: Message[] = [];
      for (const func of LLMResponse.functions as Function[]) {
        const { name, params } = func;
        try {
          let returnValue = await this.callFunction(name, params);
          funcReturns.push({
            role: "tool",
            content: JSON.stringify({
              status: "success",
              name: name,
              result: returnValue || "null",
            }),
          });
        } catch (e) {
          funcReturns.push({
            role: "tool",
            content: JSON.stringify({
              status: "failed",
              name: name,
              reason: e.message,
            }),
          });
        }
      }
      // 递归调用
      // TODO: 指定最大调用深度
      // TODO: 上报函数调用信息
      return await this.generateResponse(funcReturns, debug);
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

  async callFunction(name: string, params: { [key: string]: any }): Promise<any> {

    let func = this.tools[name];
    const args = Object.values(params || {});
    if (!func) {
      throw new Error(`Function not found: ${name}`);
    }

    // @ts-ignore
    return await func(...args);

  }

  async getCoreMemory(): Promise<string> {
    const userIds = this.collectUserID();
    const recallSize = 0;
    const archivalSize = 0;

    const humanMemories = Array.from(userIds.entries()).map(
      ([userId, nickname]) =>
        `<user id="${userId}" nickname="${nickname}">
        ${this.memory.getUserMemory(userId).join("\n")}
        </user>`
    );

    return `### Memory [last modified: ${this.lastModified}]
${recallSize} previous messages between you and the user are stored in recall memory (use functions to access them)
${archivalSize} total memories you created are stored in archival memory (use functions to access them)

Core memory shown below (limited in size, additional information stored in archival / recall memory):

<persona>
${this.memory.getSelfMemory().join("\n")}
</persona>

${humanMemories.join("\n")}
`.trim();
  }

  getFunctionPrompt() {
    let lines = [];
    Object.values(this.tools).forEach((func: (Extension & Function)) => {
      lines.push(`${func.name}:`);
      lines.push(`  description: ${func.description}`);
      lines.push(`  params:`);
      Object.entries(func.params).forEach(([key, value]) => {
        lines.push(`    ${key}: ${value}`);
      })
    })

    let s = lines.join("\n");

    let functionPrompt = `Please select the most suitable function and parameters from the list of available functions below, based on the ongoing conversation. You can run multiple functions in a single response.
Provide your response in JSON format: [{ "name": "<function name>", "params": { "<param name>": "<param value>", ... } }].
Available functions:
${isEmpty(s) ? "No functions available." : s}`;

    return functionPrompt;
  }

  private collectUserID() {
    let users: Map<string, string> = new Map();
    let template = this.config.Settings.SingleMessageStrctureTemplate
      .replace("{{messageId}}", "(?<messageId>.+?)")
      .replace("{{date}}", "(?<date>.+?)")
      .replace("{{channelInfo}}", "(?<channelInfo>.+?)")
      .replace("{{senderName}}", "(?<senderName>.+?)")
      .replace("{{senderId}}", "(?<senderId>.+?)")
      .replace("{{userContent}}", "(?<userContent>.+?)")
      .replace(/\[/g, "\\[")
      .replace(/\]/g, "\\]")
      .replace(/\{\{[^{}]*\}\}/g, "")
      .replace(/\{\{[^{}]*\}\}/g, ".*");
    let re = new RegExp(template);

    for (let history of this.history) {
      let match = re.exec(history.content.toString());
      if (match && match.groups) {
        users.set(match.groups.senderId, match.groups.senderName);
      }
    }

    return users;
  }
}
