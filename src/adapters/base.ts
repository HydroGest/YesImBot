import { h } from "koishi";
import JSON5 from "json5";
import { emojiManager } from "../utils/content";
import { Config } from "../config";

interface Response {
  status: "skip" | "success";
  session_id: string | number;
  nextReplyIn: string | number;
  logic: string;
  reply: string;
  check: string;
  finReply: string;
  execute: Array<string>;
}

interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

function escapeUnicodeCharacters(str: string) {
  return str.replace(/[\u0080-\uffff]/g, function (ch) {
    return "\\u" + ("0000" + ch.charCodeAt(0).toString(16)).slice(-4);
  });
}

function convertStringToNumber(value?: string | number): number {
  if (value == null || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  const num = typeof value === 'number' ? value : Number(value);
  if (isNaN(num)) {
    throw new Error(`Invalid number value: ${value}`);
  }
  return num;
}

function convertNumberToString(value?: number | string): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return value.toString();
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

  /*
      @description: 处理 AI 的消息
  */
  async handleResponse(
    input: any,
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
        res = input.message.content;
        usage = {
          prompt_tokens: input.prompt_eval_count,
          completion_tokens: input.eval_count,
          total_tokens: input.eval_count + input.prompt_eval_count
        }
        break;
      }
      default: {
        res = `不支持的 API 类型: ${this.adapterName}`
        throw new Error(`不支持的 API 类型: ${this.adapterName}`);
      }
    }
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
    let LLMResponse: Response;
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
      execute: LLMResponse.execute || [],
      usage: usage,
    };
  }
}
