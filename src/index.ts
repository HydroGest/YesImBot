import { Context, Next, Schema, h} from "koishi";
import { genSysPrompt } from "./utils/prompt";
import { run } from "./utils/api-adapter";
import { SendQueue } from "./utils/queue";

export const name = "yesimbot";

export const usage = `\"Yes! I'm Bot!\" 是一个让你的机器人激活灵魂的插件。
使用请阅读 ![Github Readme](https://github.com/HydroGest/YesImBot/blob/main/readme.md)，推荐使用 [GPTGOD](https://gptgod.online/#/register?invite_code=envrd6lsla9nydtipzrbvid2r) 提供的 GPT-4o-mini 模型以获得最高性价比。
`

;

export interface Config {
  Group: {
    AllowedGroups: any;
    SendQueueSize: number;
    MaxPopNum: number;
    MinPopNum: number;
	Filter: any;
  };
  API: {
    APIType: any;
    BaseAPI: string;
    UID: string;
    APIKey: string;
    AIModel: string;
  };
  Bot: {
    PromptFileUrl: any;
	PromptFileSelected: number;
    BotName: string;
	WhoAmI: string;
    BotHometown: string;
    SendDirectly: boolean;
    BotYearold: string;
    BotPersonality: string;
    BotGender: string;
    BotHabbits: string;
    BotBackground: string;
    CuteMode: boolean;
  };
  Debug: {
	DebugAsInfo: boolean;
  }
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
	Filter: Schema.array(Schema.string())
      .default(["你是", "You are", "吧", "呢"])
      .description("过滤的词汇（防止被调皮群友/机器人自己搞傻）"),
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
	PromptFileUrl: Schema.array(Schema.string())
		  .default([
			"https://raw.githubusercontent.com/HydroGest/promptHosting/main/prompt.mdt",
			"https://raw.githubusercontent.com/HydroGest/promptHosting/main/prompt-next.mdt",
			"https://raw.githubusercontent.com/HydroGest/promptHosting/main/prompt-next-short.mdt",
			])
		  .description("Prompt 文件下载链接。一般情况下不需要修改！"),
	PromptFileSelected: Schema.number().default(3).description("Prompt 文件编号，从 1 开始。请阅读 readme!"), 
    BotName: Schema.string().required().description("Bot 的名字"),
	WhoAmI: Schema.string().default("一个普通的群友").description("Bot 的简要设定"),
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
  Debug: Schema.object({
    DebugAsInfo: Schema.boolean()
      .default(false)
      .description("在控制台显示 Debug 消息"),
  }).description("调试工具"),
});

function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
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
    res = JSON.stringify(res);
  }
  res = res.replaceAll("```", " ");
  res = res.replaceAll("json", " ");
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
    const groupId: number =  
      session.channelId == "#" ? 0 : Number(session.channelId);  
    if (!config.Group.AllowedGroups.includes(groupId)) return next();  

    const regex = /<at id="([^"]+)"\s*\/>/g; 

    // 转码 <at> 消息
    const matches = Array.from(session.content.matchAll(regex));  

    const userContentPromises = matches.map(async (match) => {  
      const id = match[1].trim();  
      const user = await session.bot.getUser(id); 
      return { match: match[0], replacement: `@${user.name}` }; 
    });  

    const userContents = await Promise.all(userContentPromises);  

    // 根据获取的用户内容更新 message  
    let userContent: string = session.content;  
    userContents.forEach(({ match, replacement }) => {  
      userContent = userContent.replace(match, replacement);  
    });  

    sendQueue.updateSendQueue(  
      groupId,  
      session.event.user.name,  
      userContent,  
      session.messageId,  
      config.Group.Filter  
    );   

    // 检测是否达到发送次数  
    if (!sendQueue.checkQueueSize(groupId, config.Group.SendQueueSize)) {  
      if (config.Debug.DebugAsInfo) ctx.logger.info(sendQueue.getPrompt(groupId));  
      return next();  
    }  
    
    if (config.Debug.DebugAsInfo) ctx.logger.info(`Request sent, awaiting for response...`);

    // 获取回答  
    const SysPrompt: string = await genSysPrompt(  
      config,  
      session.channel.name,  
      session.channel.name  
    );  

    // 消息队列出队  
    const chatData: string = sendQueue.getPrompt(groupId);  
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
	ctx.logger.info(JSON.stringify(response));
    const finalRes: string = handleResponse(config.API.APIType, response);
    const sentences = finalRes.split(/(?<=[。?!？！])\s*/);  
    
    sendQueue.updateSendQueue(  
      groupId,  
      config.Bot.BotName,  
      finalRes,  
      0,  
      config.Group.Filter  
    );  
    
    for (const sentence of sentences) {  
	  if (config.Debug.DebugAsInfo) ctx.logger.info(sentence);  
      session.sendQueued(sentence);  
    }  
  });  
}
