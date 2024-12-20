import { Context, Random } from "koishi";
import JSON5 from "json5";

import { Memory } from "./memory/memory";
import { Config } from "./config";
import { Template } from "./utils/string";
import { escapeUnicodeCharacters, isEmpty } from "./utils/string";
import { EmojiManager } from "./managers/emojiManager";
import { BaseAdapter, Usage } from "./adapters/base";
import { EmbeddingsBase } from "./embeddings/base";
import { AdapterSwitcher } from "./adapters";
import { getEmbedding } from "./utils/factory";
import { Message, SystemMessage, AssistantMessage, TextComponent, ImageComponent, UserMessage, ToolMessage } from "./adapters/creators/component";
import { ResponseVerifier } from "./utils/verifier";
import { SendQueue } from "./services/sendQueue";
import { Extension, getExtensions, getFunctionPrompt, getToolSchema } from "./extensions/base";
import { ImageViewer } from "./services/imageViewer";
import { functionPrompt, ToolSchema } from "./adapters/creators/schema";

export interface Function {
  name: string;
  params: {
    [key: string]: any;
  }
}

export interface SuccessResponse {
  status: "success";
  raw: string;
  finalReply: string;
  replyTo?: string;
  quote?: string;
  nextTriggerCount: number;
  logic: string;
  functions: Array<Function>;
  usage: Usage;
  adapterIndex: number;
}

export interface SkipResponse {
  status: "skip";
  raw: string;
  nextTriggerCount: number;
  logic: string;
  functions: Array<Function>;
  usage: Usage;
  adapterIndex: number;
}

export interface FailedResponse {
  status: "fail";
  raw: string;
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
  private template: Template;
  private extensions: { [key: string]: Extension & Function } = {};
  private toolsSchema: ToolSchema[] = [];
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

    this.template = new Template(config.Settings.SingleMessageStrctureTemplate, /\{\{(\w+(?:\.\w+)*)\}\}/g, /\{\{(\w+(?:\.\w+)*),([^,]*),([^}]*)\}\}/g);

    this.imageViewer = new ImageViewer(config);

    this.messageQueue = new SendQueue(ctx, config);

    for (const extension of getExtensions()) {
      this.extensions[extension.name] = extension;
      this.toolsSchema.push(getToolSchema(extension));
    }
  }

  updateConfig(config: Config) {
    this.config = config;
    this.adapterSwitcher.updateConfig(config.API.APIList, config.Parameters);
  }

  setSystemPrompt(content: string) {
    this.prompt = content;
  }

  setChatHistory(chatHistory: Message[], isMultiTurn: boolean) {
    this.history = [];
    if (isMultiTurn) {
      this.history = [...chatHistory];
    } else {
      let components: (TextComponent | ImageComponent)[] = [];
      chatHistory.forEach(message => {
        if (typeof message.content === 'string') {
          components.push(TextComponent(message.content));
        } else if (Array.isArray(message.content)) {
          const validComponents = message.content.filter((comp): comp is TextComponent | ImageComponent =>
            comp.type === 'text' || (comp.type === 'image_url' && 'image_url' in comp));
          components.push(...validComponents);
        }
      });
      // 合并components中相邻的 TextComponent
      components = components.reduce((acc, curr, i) => {
        if (i === 0) return [curr];
        const prev = acc[acc.length - 1];
        if (prev.type === 'text' && curr.type === 'text') {
          prev.text += '\n' + (curr as TextComponent).text;
          return acc;
        }
        return [...acc, curr];
      }, []);
      this.history.push(AssistantMessage("Resolve OK"));
      this.history.push(UserMessage(...components));
    }
  }

  getChatHistory() {
    return this.history;
  }

  getAdapter() {
    return this.adapterSwitcher.getAdapter();
  }

  async generateResponse(messages: Message[], debug = false): Promise<SuccessResponse | SkipResponse | FailedResponse> {
    let { current, adapter } = this.getAdapter();

    if (!adapter) {
      throw new Error("没有可用的适配器");
    }

    this.history.push(...messages);

    if (!adapter.ability.includes("原生工具调用")) {
      let str = Object.values(this.extensions)
        .map((extension) => getFunctionPrompt(extension))
        .join("\n");
      this.prompt = this.prompt.replace(
        "${functionPrompt}",
        functionPrompt + `${isEmpty(str) ? "No functions available." : str}`
      );
    }

    const response = await adapter.chat([SystemMessage(this.prompt), ...this.history], adapter.ability.includes("原生工具调用") ? this.toolsSchema : undefined, debug);
    let content = response.message.content;
    if (debug) logger.info(`Adapter: ${current}, Response: \n${content}`);

    let finalResponse: string = "";
    let finalLogic: string = "";
    let replyTo: string = "";
    let nextTriggerCount: number = Random.int(this.minTriggerCount, this.maxTriggerCount + 1); // 双闭区间
    let functions: Function[] = [];
    let reason: string;

    if (adapter.ability.includes("原生工具调用")) {

      let toolCalls = response.message.tool_calls;
      let returns: ToolMessage[] = [];
      toolCalls.forEach(async toolCall => {
        let result = await this.callFunction(toolCall.function.name, toolCall.function.arguments);
        if (!isEmpty(result)) returns.push(ToolMessage(result, toolCall.id));
      })
      if (returns.length > 0) {
        this.history.push(...returns);
        return this.generateResponse(this.history, debug);
      }
    }

    if (this.config.Settings.MultiTurn) {
      this.history.push(AssistantMessage(TextComponent(content)));
      const result = this.template.unrender(content);
      const channelIdfromChannelInfo = result.channelInfo?.includes(':') ? result.channelInfo.split(':')[1] : '';
      const channelId = result.channelId || channelIdfromChannelInfo;

      if (result.userContent === undefined || !channelId) {
        return {
          status: "fail",
          raw: content,
          usage: response.usage,
          reason: "解析失败",
          adapterIndex: current,
        };
      } else {
        finalResponse = result.userContent;
        replyTo = channelId;
        if (finalResponse.trim() === "") {
          return {
            status: "skip",
            raw: content,
            nextTriggerCount,
            logic: finalLogic,
            usage: response.usage,
            functions: functions,
            adapterIndex: current,
          }
        } else {
          return {
            status: "success",
            raw: content,
            finalReply: await this.unparseFaceMessage(finalResponse),
            replyTo,
            quote: result.quoteMessageId || "",
            nextTriggerCount,
            logic: finalLogic,
            functions,
            usage: response.usage,
            adapterIndex: current,
          };
        }
      }
    } else {
      if (typeof content !== "string") {
        content = JSON5.stringify(content, null, 2);
      }
      // 提取JSON部分
      const jsonMatch = content.match(/{.*}/s);
      let LLMResponse: any = {};

      if (jsonMatch) {
        try {
          LLMResponse = JSON5.parse(escapeUnicodeCharacters(jsonMatch[0]));
          this.history.push(AssistantMessage(JSON.stringify(LLMResponse)));
        } catch (e) {
          reason = `JSON 解析失败: ${e.message}`;
          if (debug) logger.warn(reason);
          return {
            status: "fail",
            raw: content,
            usage: response.usage,
            reason,
            adapterIndex: current,
          };
        }
      } else {
        reason = `没有找到 JSON: ${content}`;
        if (debug) logger.warn(reason);
        return {
          status: "fail",
          raw: content,
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
      if (LLMResponse.status === "success") {}
      else if (LLMResponse.status === "skip") {
        return {
          status: "skip",
          raw: content,
          nextTriggerCount,
          logic: finalLogic,
          usage: response.usage,
          functions: LLMResponse.functions,
          adapterIndex: current,
        };
      } else if (LLMResponse.status === "function") {
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
        reason = `status 不是一个有效值: ${content}`;
        if (debug) logger.warn(reason);
        return {
          status: "fail",
          raw: content,
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
          reason = `回复格式错误: ${content}`;
          if (debug) logger.warn(reason);
          return {
            status: "fail",
            raw: content,
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
        // 不合法的 channelId
        if (replyTo.match(/\{.+\}/)) {
          replyTo = "";
        }
      }

      finalResponse = await this.unparseFaceMessage(finalResponse);

      return {
        status: "success",
        raw: content,
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
  }

  async summarize(channelId, userId, content) { }

  async callFunction(name: string, params: { [key: string]: any }): Promise<any> {

    let func = this.extensions[name];
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

  async unparseFaceMessage(message: string) {
    // 反转义 <face> 消息
    const faceRegex = /\[表情[:：]\s*([^\]]+)\]/g;
    const matches = Array.from(message.matchAll(faceRegex));

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
      message = message.replace(match, replacement);
    });
    return message;
  }

  private collectUserID() {
    const users: Map<string, string> = new Map();
    const stringTemplate = this.template;

    for (const history of this.history) {
      const contentType = typeof history.content;
      let content: string;
      switch (contentType) {
        case "string":
          content = history.content as string;
          break;
        case "object":
          content = (history.content as (TextComponent | ImageComponent)[])
            .filter((comp): comp is TextComponent => comp.type === 'text')
            .map(comp => comp.text)
            .join('');
          break;
        default:
          content = "";
          break;
      }
      const result = stringTemplate.unrender(content);

      if (result.senderId && result.senderName) {
        users.set(result.senderId, result.senderName);
      }
    }

    return users;
  }
}
