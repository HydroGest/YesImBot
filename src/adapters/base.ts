import { h } from "koishi";
import JSON5 from "json5";

import { emojiManager } from "../managers/emojiManager";
import { Config } from "../config";
import { convertNumberToString, convertStringToNumber, escapeUnicodeCharacters } from "../utils/string";

export interface TextComponent {
  type: "text",
  text: string
}
export function TextComponent(text: string): TextComponent {
  return {
    type: "text",
    text,
  }
}
export interface ImageComponent {
  type: "image_url",
  image_url: {
    url: string,
    detail?: "low" | "high" | "auto"
  }
}
export function ImageComponent(url: string, detail?: "low" | "high" | "auto"): ImageComponent {
  return {
    type: "image_url",
    image_url: {
      url,
      detail,
    }
  }
}
export type Component = TextComponent | ImageComponent
export interface Message {
  role: "system" | "assistant" | "user";
  content: string | Component[];
}
export interface SystemMessage extends Message {
  role: "system";
}
export function SystemMessage(content: string | Component[]): SystemMessage {
  return {
    role: "system",
    content,
  }
}
export interface UserMessage extends Message {
  role: "user";
}
export function UserMessage(content: string | Component[]): UserMessage {
  return {
    role: "user",
    content,
  }
}
export interface AssistantMessage extends Message {
  role: "assistant";
}
export function AssistantMessage(content: string | Component[]): AssistantMessage {
  return {
    role: "assistant",
    content,
  }
}

interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface Response {
  model: string;
  created: string;
  message: {
    role: "system" | "assistant" | "user";
    content: string;
  };
  usage: Usage;
}

export abstract class BaseAdapter {
  constructor(protected adapterName: string) {
    console.log(`Adapter: ${this.adapterName} registered`);
  }
  protected abstract generateResponse(
    sysPrompt: string,
    userPrompt: string | Message,
    parameters: any,
    detail: string,
    eyeType: string,
    debug: boolean
  ): Promise<Response>;

  async runChatCompeletion(
    sysInput: string,
    infoInput: string | Message,
    parameters: any,
    detail: string,
    eyeType: string,
    debug: boolean
  ): Promise<Response> {
    // 解析其他参数
    const otherParams: Record<string, any> = {};
    if (parameters.OtherParameters) {
      parameters.OtherParameters.forEach((param: { key: string; value: string }) => {
        const key = param.key.trim();
        let value = param.value.trim();

        // 尝试解析 JSON 字符串
        try {
          value = JSON5.parse(value);
        } catch (e) {
          // 如果解析失败，保持原值
        }

        // 转换 value 为适当的类型
        if (value === 'true') {
          otherParams[key] = true;
        } else if (value === 'false') {
          otherParams[key] = false;
          //@ts-ignore
        } else if (!isNaN(value)) {
          otherParams[key] = Number(value);
        } else {
          otherParams[key] = value;
        }
      }
      );
      parameters.OtherParameters = otherParams;
    }

    return this.generateResponse(
      sysInput,
      infoInput,
      parameters,
      detail,
      eyeType,
      debug
    );
  }

  async extractContent(input: string, detail: Config["ImageViewer"]["Detail"]): Promise<Component[]> {
    const regex =
      /<img\s+(base64|src)\s*=\s*\\?"([^\\"]+)\\?"(?:\s+(base64|src)\s*=\s*\\?"([^\\"]+)\\?")?\s*\/>/g;
    let match;
    const parts: Component[] = [];
    let lastIndex = 0;
    while ((match = regex.exec(input)) !== null) {
      if (match.index > lastIndex) {
        parts.push({
          type: "text",
          text: input.substring(lastIndex, match.index),
        });
      }
      const imageUrl = match[1] === "base64" ? match[2] : match[4];
      parts.push({
        type: "image_url",
        image_url: { url: imageUrl, detail: detail },
      });
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < input.length) {
      parts.push({ type: "text", text: input.substring(lastIndex) });
    }
    return parts;
  }

  async createMessages(sysInput: string, infoInput: string, eyeType: any, detail: Config["ImageViewer"]["Detail"]) {
    if (eyeType === "LLM API 自带的多模态能力") {
      return [
        SystemMessage(
          await this.extractContent(sysInput, detail),
        ),
        AssistantMessage([
          TextComponent("Resolve OK")
        ]),
        UserMessage(
          await this.extractContent(infoInput, detail),
        )
      ];
    } else {
      return [
        SystemMessage(sysInput),
        AssistantMessage("Resolve OK"),
        UserMessage(infoInput),
      ];
    }
  }

  /*
      @description: 处理 AI 的消息
  */
  async handleResponse(
    input: Response,
    AllowErrorFormat: boolean,
    config: Config,
    groupMemberList: any,
  ): Promise<{
    status: string; // status, if fail, "fail"
    originalRes: string; // res
    res: string; // finReply || reply
    resNoTag: string; // (finReply || reply).removeTag
    resNoTagExceptQuote: string; // (finReply || reply).removeTagExceptQuote
    replyTo: string; // session_id
    quote: string; // extract from (finReply || reply)
    nextTriggerCount: number; // nextReplyIn
    logic: string; // logic
    execute: Array<string>; // execute
    usage?: Usage;
  }> {
    let usage = input.usage;
    let res = input.message.content;

    if (typeof res != "string") {
      res = JSON5.stringify(res, null, 2);
    }

    // 正版回复：
    // {
    //   "status": "success", // "success" 或 "skip" (跳过回复)
    //   "session_id": "123456789", // 要把finReply发送到的会话id
    //   "nextReplyIn": "2", // 由LLM决定的下一次回复的冷却条数
    //   "logic": "", // LLM思考过程
    //   "reply": "", // 初版回复
    //   "check": "", // 检查初版回复是否符合 "消息生成条例" 过程中的检查逻辑。
    //   "finReply": "" // 最终版回复，引用回复<quote id=\\"\\"/>由 LLM 生成，转义和双引号一定要带
    //   "execute":[] // 要运行的指令列表
    // }

    let status: string = "success";
    let finalResponse: string = "";

    const jsonMatch = res.match(/{.*}/s);
    let LLMResponse;
    if (jsonMatch) {
      try {
        const resJSON = jsonMatch[0];
        LLMResponse = JSON5.parse(escapeUnicodeCharacters(resJSON));
      } catch (e) {
        status = "fail"; // JSON 解析失败
        // 此时 LLMResponse 还是 undefined
        //@ts-ignore
        LLMResponse = {};
      }
    } else {
      status = "fail"; // 没有找到 JSON
    }
    if (LLMResponse.status === "success" || LLMResponse.status === "skip") {
      status = LLMResponse.status;
    } else {
      status = "fail"; // status 不是 "success" 或 "skip"
    }
    if (!AllowErrorFormat) {
      if (LLMResponse.finReply || LLMResponse.reply || status === "skip") {
        finalResponse += LLMResponse.finReply || LLMResponse.reply || "";
      } else {
        status = "fail"; // 回复格式错误
      }
    } else {
      finalResponse += LLMResponse.finReply || LLMResponse.reply || "";
      // 盗版回复
      const possibleResponse = [
        //@ts-ignore
        LLMResponse.msg, LLMResponse.text, LLMResponse.message, LLMResponse.answer
      ];
      for (const resp of possibleResponse) {
        if (resp) {
          finalResponse += resp || "";
          break;
        }
      }
    }

    let finalLogic: string = LLMResponse.logic || "";

    const logicQuoteMatch = finalLogic.match(/<quote\s+id=\\*["']?(\d+)\\*["']?\s*\/?>/);
    if (logicQuoteMatch) {
      finalLogic = finalLogic.replace(/<quote\s+id=\\*["']?\d+\\*["']?\s*\/?>/g, '');
      finalLogic = `[引用回复: ${logicQuoteMatch[1]}]\n` + finalLogic;
    }

    // 从回复中提取 <quote> 标签，将其放在回复的最前面
    const quoteMatch = finalResponse.match(/<quote\s+id=\\*["']?(\d+)\\*["']?\s*\/?>/);
    let finalResponseNoTag = finalResponse;
    if (quoteMatch) {
      // 移除所有的 <quote> 标签
      finalResponse = finalResponse.replace(/<quote\s+id=\\*["']?\d+\\*["']?\s*\/?>/g, '');
      finalResponseNoTag = finalResponse;
      // 把第一个 <quote> 标签放在回复的最前面
      finalResponse = h("quote", { id: quoteMatch[1] }) + finalResponse;
      finalResponseNoTag = `[引用回复: ${quoteMatch[1]}]\n` + finalResponseNoTag;
    }

    // 复制一份finalResonse为finalResponseNoTagExceptQuote，作为添加到队列中的bot消息内容
    let finalResponseNoTagExceptQuote = finalResponse;

    // 使用 groupMemberList 反转义 <at> 消息
    // const groupMemberList: { nick: string; user: { name: string; id: string } }[] =  groupMemberList.data;

    const getKey = (member: { nick: string; user: { name: string } }) => config.Bot.NickorName === "群昵称" ? member.nick : member.user.name;

    groupMemberList.sort((a, b) => getKey(b).length - getKey(a).length);

    groupMemberList.forEach((member) => {
      const name = getKey(member);
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const atRegex = new RegExp(`(?<!<at id="[^"]*" name=")@${escapedName}(?![^"]*"\s*\/>)`, 'g');
      finalResponse = finalResponse.replace(atRegex, `<at id="${member.user.id}" name="${name}" />`);
    });
    finalResponse = finalResponse.replace(/(?<!<at type=")@全体成员|@所有人|@all(?![^"]*"\s*\/>)/g, '<at type="all"/>');

    // 反转义 <face> 消息
    const faceRegex = /\[表情[:：]\s*([^\]]+)\]/g;

    const matches = Array.from(finalResponse.matchAll(faceRegex))

    const replacements = await Promise.all(matches.map(async (match) => {
      const name = match[1];
      let id = await emojiManager.getIdByName(name) || await emojiManager.getIdByName(await emojiManager.getNameByTextSimilarity(name, config)) || '500';
      return {
        match: match[0],
        replacement: `<face id="${id}"></face>`,
      };
    }));

    replacements.forEach(({ match, replacement }) => {
      finalResponse = finalResponse.replace(match, replacement);
    });

    return {
      status: status,
      originalRes: res,
      res: finalResponse,
      resNoTagExceptQuote: finalResponseNoTagExceptQuote,
      resNoTag: finalResponseNoTag,
      replyTo: convertNumberToString(LLMResponse.session_id),
      quote: quoteMatch ? quoteMatch[1] : '',
      nextTriggerCount: convertStringToNumber(LLMResponse.nextReplyIn),
      logic: finalLogic || '',
      execute: (LLMResponse.execute instanceof Array) ? LLMResponse.execute : [],
      usage: usage,
    };
  }
}
