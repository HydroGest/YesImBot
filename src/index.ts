import { Context, Next, Schema, h } from "koishi";
import { genSysPrompt } from "./promptUtils";
import { run } from "./apiAdapter";

export const name = "yesimbot";

export const usage = "\"Yes! I'm Bot!\" 是一个让你的机器人激活灵魂的插件。";

export interface Config {
  Group: {
    AllowedGroups: any;
    SendQueueSize: number;
    MaxPopNum: number;
    MinPopNum: number;
  };
  API: {
    APIType: any;
    BaseAPI: string;
    UID: string;
    APIKey: string;
    AIModel: string;
  };
  Bot: {
    PromptFileUrl: string;
    BotName: string;
    BotHometown: string;
    SendDirectly: boolean;
    BotYearold: string;
    BotPersonality: string;
    BotGender: string;
    BotHabbits: string;
    BotBackground: string;
    CuteMode: boolean;
  };
}

export const Config: Schema<Config> = Schema.object({
  Group: Schema.object({
    AllowedGroups: Schema.array(Schema.number())
      .required()
      .description("允许的聊群。"),
    SendQueueSize: Schema.number()
      .default(20)
      .description("Bot 接收的上下文数量（消息队列长度）"),
    MaxPopNum: Schema.number()
      .default(10)
      .description("消息队列每次出队的最大数量"),
    MinPopNum: Schema.number()
      .default(1)
      .description("消息队列每次出队的最小数量"),
  }).description("群聊设置"),
  API: Schema.object({
    APIType: Schema.union(["OpenAI", "Cloudflare", "脑力计算"]).description(
      "API 类型。"
    ),
    BaseAPI: Schema.string()
      .default("https://api.openai.com/v1/chat/completions/")
      .description("API 基础URL。"),
    UID: Schema.string()
      .default("若非 Cloudflare 可不填。")
      .description("Cloudflare UID"),
    APIKey: Schema.string().required().description("你的 API 令牌"),
    AIModel: Schema.string()
      .default("@cf/meta/llama-3-8b-instruct")
      .description("模型 ID。"),
  }).description("LLM API 设置"),
  Bot: Schema.object({
    PromptFileUrl: Schema.string()
      .default(
        "https://raw.githubusercontent.com/HydroGest/promptHosting/main/prompt.mdt"
      )
      .description("Prompt 文件下载链接"),
    BotName: Schema.string().required().description("Bot 的名字"),
    BotHometown: Schema.string().default("广州").description("Bot 的家乡。"),
    SendDirectly: Schema.boolean()
      .default(false)
      .description("运行时屏蔽其他指令"),
    BotYearold: Schema.string().default("16").description("Bot 的年龄。"),
    BotPersonality: Schema.string()
      .default("外向/有爱")
      .description("Bot 性格。"),
    BotGender: Schema.string().default("女").description("Bot 的性别。"),
    BotHabbits: Schema.string().default("").description("Bot 的爱好"),
    BotBackground: Schema.string()
      .default("高中女生")
      .description("Bot 的背景。"),
    CuteMode: Schema.boolean().default(false).description("原神模式（迫真"),
  }).description("机器人设定"),
});

function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

class SendQueue {
  private sendQueueMap: Map<
    number,
    { id: number; sender: string; content: string }[]
  >;

  constructor() {
    this.sendQueueMap = new Map<
      number,
      { id: number; sender: string; content: string }[]
    >();
  }

  updateSendQueue(group: number, sender: string, content: string, id: any) {
    if (this.sendQueueMap.has(group)) {
      const queue = this.sendQueueMap.get(group);
      queue.push({ id: Number(id), sender, content }); 
      this.sendQueueMap.set(group, queue);
    } else {
      this.sendQueueMap.set(group, [{ id: Number(id), sender, content }]); 
    }
  }

  // 检查队列长度
  checkQueueSize(group: number, size: number): boolean {
    if (this.sendQueueMap.has(group)) {
      const queue = this.sendQueueMap.get(group);
      console.log(`${queue.length} / ${size}`);
      return queue.length >= size;
    }
    return false;
  }

  // 重置消息队列
  resetSendQueue(group: number, popNumber: number) {
    const queue = this.sendQueueMap.get(group);
    if (queue && queue.length > 0) {
      const newQueue = queue.slice(popNumber);
      this.sendQueueMap.set(group, newQueue);
    }
  }

  getPrompt(group: number): string {
    if (this.sendQueueMap.has(group)) {
      const queue = this.sendQueueMap.get(group);
      const promptArr = queue.map((item) => ({
        id: item.id,
        author: item.sender,
        msg: item.content,
      }));
      //ctx.logger.info(JSON.stringify(promptArr));
      return JSON.stringify(promptArr);
    }
    return "[]";
  }
}

const sendQueue = new SendQueue();

function handleResponse(APIType: string, input: any): string {
  let res: string;
  switch (APIType) {
    case "OpenAI": {
      res = input.choices[0].message.content;
      break;
    }
    case "Cloudflare": {
      res = input.result.response;
      break;
    }
    default: {
      throw new Error(`不支持的 API 类型: ${APIType}`);
    }
  }
  console.log(typeof res);
  if (typeof res != "string") {
    console.log("API responded an object!");
    console.log(JSON.stringify(res));
    res = JSON.stringify(res);
  }
  res = res.replaceAll("```", " ");
  res = res.replaceAll("json", " ");
  //ctx.logger.info(res);
  const LLMResponse = JSON.parse(res);
  if (LLMResponse.status != "success") {
    throw new Error(`LLM provides unexpected response: ${res}`);
  }
  let finalResponse: string = '';
  if (LLMResponse.select)
    finalResponse += h('quote', { id: LLMResponse.select });
  finalResponse += LLMResponse.reply;
  return finalResponse;
}

export function apply(ctx: Context, config: Config) {
  ctx.middleware(async (session: any, next: Next) => {
    //ctx.logger.info("Message Recieved.");
    // 加入消息队列
    let groupId: number =
      session.channelId == "#" ? 0 : Number(session.channelId);
    if (!config.Group.AllowedGroups.includes(groupId)) return next();
    sendQueue.updateSendQueue(
      groupId,
      session.event.user.name,
      session.content,
      session.messageId
    );
    console.log("Message recieved.");

    // 检测是否达到发送次数
    if (!sendQueue.checkQueueSize(groupId, config.Group.SendQueueSize)) {
      ctx.logger.info(sendQueue.getPrompt(groupId));
      return next();
    }
    ctx.logger.info(`Request sent, awaiting for response...`);

    // 获取回答
    var SysPrompt: string = await genSysPrompt(
      config,
      session.channel.name,
      session.channel.name
    );
	
	// 消息队列出队
	const chatData:　string = sendQueue.getPrompt(groupId);
	sendQueue.resetSendQueue(
      groupId,
      getRandomInt(config.Group.MinPopNum, config.Group.MaxPopNum)
    );
    
	const response = await run(
      config.API.APIType,
      config.API.BaseAPI,
      config.API.UID,
      config.API.APIKey,
      config.API.AIModel,
      SysPrompt,
      chatData
    );

    const finalRes: string = handleResponse(config.API.APIType, response);
	const sentences = finalRes.split(/(?<=[。?!？!])\s*/);
	
    sendQueue.updateSendQueue(
      groupId,
      config.Bot.BotName,
      finalRes,
      0
    );
	
    ctx.logger.info(finalRes);
	
    for (let sentence of sentences) {
		session.sendQueued(sentence);
	}
	
    /*
    return config.Bot.SendDirectly
      ? finalRes
      : next(finalRes);
    */
  });
}
