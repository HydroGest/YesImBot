import JSON5 from "json5";

import { Config } from "../config";
import { Message } from "./creators/component";
import { escapeUnicodeCharacters } from "../utils/string";
import { emojiManager } from "../managers/emojiManager";

interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface Response {
  model: string;
  created: string;
  message: {
    role: "system" | "assistant" | "user";
    content: string;
  };
  usage: Usage;
}

export interface ExpectedResponse {
  status: string;             // status
  content: string;            // 原始输出
  finalReply: string;         // finReply || reply
  replyTo: string;            // session_id
  quote: string;              //
  nextTriggerCount: number;   // 下次触发次数
  logic: string;              // LLM思考过程
  execute: Array<string>;     // 要运行的指令列表
  usage?: Usage;
}

export abstract class BaseAdapter {
  protected otherParams: Record<string, any>;

  constructor(
    protected adapterName: string,
    protected parameters: Config["Parameters"]

  ) {
    console.log(`Adapter: ${this.adapterName} registered`);

    // 解析其他参数
    this.otherParams = {};
    if (parameters.OtherParameters) {
      parameters.OtherParameters.forEach(
        (param: { key: string; value: string }) => {
          const key = param.key.trim();
          let value = param.value.trim();
          // 尝试解析 JSON 字符串
          try {
            value = JSON.parse(value);
          } catch (e) {
            // 如果解析失败，保持原值
          }
          // 转换 value 为适当的类型
          if (value === "true") {
            this.otherParams[key] = true;
          } else if (value === "false") {
            this.otherParams[key] = false;
            //@ts-ignore
          } else if (!isNaN(value)) {
            this.otherParams[key] = Number(value);
          } else {
            this.otherParams[key] = value;
          }
        }
      );
    }
  }

  abstract chat(messages: Message[]): Promise<Response>;

  //abstract chatWithHistory(messages: Message[]): Promise<Response>;

  async generateResponse(messages: Message[], config: Config): Promise<ExpectedResponse> {
    const response = await this.chat(messages);
    let content = response.message.content;
  
    if (typeof content !== "string") {
      content = JSON5.stringify(content, null, 2);
    }

    // 预期回复：
    // {
    //   "status": "success",       // "success" 或 "skip" (跳过回复)
    //   "session_id": "123456789", // 要把finReply发送到的会话id
    //   "quote": "",               //
    //   "nextReplyIn": "2",        // 由LLM决定的下一次回复的冷却条数
    //   "logic": "",               // LLM思考过程
    //   "reply": "",               // 初版回复
    //   "check": "",               // 检查初版回复是否符合 "消息生成条例" 过程中的检查逻辑。
    //   "finReply": ""             // 最终版回复
    //   "execute":[]               // 要运行的指令列表
    // }
  
    let status: string = "success";
    let finalResponse: string = "";
    let finalLogic: string = "";
    let replyTo: string = "";
    let nextTriggerCount: number = 2;
    let execute: any[] = [];
  
    // 提取JSON部分
    const jsonMatch = content.match(/{.*}/s);
    let LLMResponse: any = {};
  
    if (jsonMatch) {
      try {
        LLMResponse = JSON5.parse(escapeUnicodeCharacters(jsonMatch[0]));
      } catch (e) {
        status = "fail"; // JSON 解析失败
      }
    } else {
      status = "fail"; // 没有找到 JSON
    }
  
    // 检查 status 字段
    if (LLMResponse.status === "success" || LLMResponse.status === "skip") {
      status = LLMResponse.status;
    } else {
      status = "fail"; // status 不是 "success" 或 "skip"
    }
  
    // 构建 finalResponse
    if (!config.Settings.AllowErrorFormat) {
      if (LLMResponse.finReply || LLMResponse.reply) {
        finalResponse += LLMResponse.finReply || LLMResponse.reply || "";
      } else {
        status = "fail"; // 回复格式错误
      }
    } else {
      finalResponse += LLMResponse.finReply || LLMResponse.reply || "";
      // 兼容弱智模型的错误回复
      const possibleResponse = [
        LLMResponse.msg,
        LLMResponse.text,
        LLMResponse.message,
        LLMResponse.answer
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
    nextTriggerCount = LLMResponse.nextTriggerCount || 2;
    finalLogic = LLMResponse.logic || "";
    if (LLMResponse.execute && Array.isArray(LLMResponse.execute)) {
      execute = LLMResponse.execute
    } else {
      execute = [];
    }
  
    // 反转义 <face> 消息
    const faceRegex = /\[表情[:：]\s*([^\]]+)\]/g;
    const matches = Array.from(finalResponse.matchAll(faceRegex));
  
    const replacements = await Promise.all(
      matches.map(async (match) => {
        const name = match[1];
        let id = await emojiManager.getIdByName(name);
        if (!id) {
          id = await emojiManager.getIdByName(
            await emojiManager.getNameByTextSimilarity(name, config.Embedding)
          );
        }
        if (!id) {
          id = '500';
        }
        return {
          match: match[0],
          replacement: `<face id="${id}"></face>`,
        };
      })
    );
  
    replacements.forEach(({ match, replacement }) => {
      finalResponse = finalResponse.replace(match, replacement);
    });
    return {
      status,
      content,
      finalReply: finalResponse,
      replyTo,
      quote: LLMResponse.quote || "",
      nextTriggerCount,
      logic: finalLogic,
      execute,
      usage: response.usage
    };
  }
}
