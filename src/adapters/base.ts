import { h } from "koishi";
import { emojiManager } from "../utils/content";

interface Response {
  status: "skip" | "success";
  logic: string;
  reply: string;
  select: number;
  check: string;
  finReply: string;
  execute: Array<string>;
}

interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

function correctInvalidFormat(str: string) {
   throw new Error("Not implemented");
}

export abstract class BaseAdapter {
  protected adapterName: string;
  constructor(adapterName) {
    this.adapterName = adapterName;
    console.log(`Adapter: ${this.adapterName} registered`);
  }
  protected abstract generateResponse(
    sysPrompt: string,
    userPrompt: string,
    parameters: any,
    detail: string,
    eyeType: string,
    debug: boolean
  ): Promise<any>;

  async runChatCompeletion(
    SysInput: string,
    InfoInput: string,
    parameters: any,
    detail: string,
    eyeType: string,
    debug: boolean
  ): Promise<any> {
    // 解析其他参数
    const otherParams = {};
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
          //@ts-ignore
          otherParams[key] = value === 'true' ? true :
            value === 'false' ? false :
              !isNaN(value as any) ? Number(value) :
                value;
        }
      );
      parameters.OtherParameters = otherParams;
    }

    return this.generateResponse(
      SysInput,
      InfoInput,
      parameters,
      detail,
      eyeType,
      debug
    );
  }

  async extractContent(input: string, detail: string) {
    const regex =
      /<img\s+(base64|src)\s*=\s*\\?"([^\\"]+)\\?"(?:\s+(base64|src)\s*=\s*\\?"([^\\"]+)\\?")?\s*\/>/g;
    let match;
    const parts = [];
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

  async createMessages(sysInput: string, infoInput: string, eyeType: any, detail: string) {
    if (eyeType === "LLM API 自带的多模态能力") {
      return [
        {
          role: "system",
          content: await this.extractContent(sysInput, detail),
        },
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Resolve OK",
            },
          ],
        },
        {
          role: "user",
          content: await this.extractContent(infoInput, detail),
        },
      ];
    } else {
      return [
        {
          role: "system",
          content: sysInput,
        },
        {
          role: "assistant",
          content: "Resolve OK",
        },
        {
          role: "user",
          content: infoInput,
        },
      ];
    }
  }

  async handleResponse(
    input: any,
    AllowErrorFormat: boolean,
    config: any,
    session: any,
  ): Promise<{
    res: string;
    resNoTag: string;
    LLMResponse: any;
    usage: any;
  }> {
    let usage: any;
    let res: string;
    switch (this.adapterName) {
      case "OpenAI": {
        res = input.choices[0].message.content;
        usage = input.usage;
        break;
      }
      case "Custom URL": {
        res = input.choices[0].message.content;
        usage = input.usage;
        break;
      }
      case "Cloudflare": {
        res = input.result.response;
        break;
      }
      case "Ollama": {
        res = input.messages[0].content;
        usage = {
          prompt_tokens: input.prompt_tokens,
          completion_tokens: input.completion_tokens,
          total_tokens: input.total_tokens
        }
      }
      default: {
        throw new Error(`不支持的 API 类型: ${this.adapterName}`);
      }
    }
    if (typeof res != "string") {
      res = JSON.stringify(res, null, 2);
    }
  
    // 正版回复：
    // {
    //   "status": "success", // "success" 或 "skip" (跳过回复)
    //   "logic": "", // LLM思考过程
    //   "select": -1, // 回复引用的消息id
    //   "reply": "", // 初版回复
    //   "check": "", // 检查初版回复是否符合 "消息生成条例" 过程中的检查逻辑。
    //   "finReply": "" // 最终版回复
    //   "execute":[] // 要运行的指令列表
    // }
    const jsonMatch = res.match(/{.*}/s);
    if (jsonMatch) {
      res = jsonMatch[0];
    } else {
      throw new Error(`LLM provides unexpected response: ${res}`);
    }
    const LLMResponse = JSON.parse(res);
    if (LLMResponse.status != "success") {
      if (!AllowErrorFormat && LLMResponse.status != "skip") {
        throw new Error(`LLM provides unexpected response: ${res}`);
      } else {
        console.log(`LLM choose not to reply.`);
      }
    }
    let finalResponse: string = "";
    if (!AllowErrorFormat) {
      finalResponse += LLMResponse.finReply
        ? LLMResponse.finReply
        : LLMResponse.reply;
    } else {
      if (LLMResponse.finReply) finalResponse += LLMResponse.finReply;
      else if (LLMResponse.reply) finalResponse += LLMResponse.reply;
      // 盗版回复
      else if (LLMResponse.msg) finalResponse += LLMResponse.msg;
      else if (LLMResponse.text) finalResponse += LLMResponse.text;
      else if (LLMResponse.message) finalResponse += LLMResponse.message;
      else if (LLMResponse.answer) finalResponse += LLMResponse.answer;
      else throw new Error(`LLM provides unexpected response: ${res}`);
    }
  
    // 复制一份finalResonse为finalResponseNoTag，作为添加到队列中的bot消息内容
    let finalResponseNoTag = finalResponse;
  
    // 添加引用消息在finalResponse的开头
    if (~LLMResponse.select)
      finalResponse = h("quote", {
        id: LLMResponse.select,
      }) + finalResponse;
  
    // 使用 groupMemberList 反转义 <at> 消息
    const groupMemberList: { nick: string; user: { name: string; id: string } }[] = session.groupMemberList.data;
  
    if (!["群昵称", "用户昵称"].includes(config.Bot.NickorName)) {
      throw new Error(`Unsupported NickorName value: ${config.Bot.NickorName}`);
    }
  
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
    const fullMatchRegex = /\[\s*([^\]]+)\s*\]/g;
  
    const matches = Array.from(finalResponse.matchAll(faceRegex)).concat(Array.from(finalResponse.matchAll(fullMatchRegex)));
  
    const replacements = await Promise.all(matches.map(async (match) => {
      const name = match[1];
      let id = await emojiManager.getIdByNameAndType(name, 1) || await emojiManager.getIdByNameAndType(name, 2) || '500';
      return {
        match: match[0],
        replacement: `<face id="${id}"></face>`,
      };
    }));
  
    replacements.forEach(({ match, replacement }) => {
      finalResponse = finalResponse.replace(match, replacement);
    });
  
  
  
    return {
      res: finalResponse,
      resNoTag: finalResponseNoTag,
      LLMResponse: LLMResponse,
      usage: usage,
    };
  }
}