import { Context, Schema } from 'koishi'

export const name = 'yesimbot'

export const usage = "“Yes! I'm Bot！” 是一个让你的机器人激活灵魂的插件。"

export interface Config {
  AllowedGroups: any,
  BaseAPI: string,
  UID: string,
  APIType: enum
  APIKey: string,
  AIModel: string,
  BotName: string,
  BotHometown: string,
  MinMsgNum: number,
  MaxMsgNum: number,
  SendDirectly: boolean
}

export const Config: Schema<Config> = Schema.object({
  AllowedGroups: Schema.array(Schema.number()).required().description('允许的聊群。'),
  BaseAPI: Schema.string().default("https://api.cloudflare.com/client/v4/").description('Cloudflare Workers AI 格式的 API。'),
  UID: Schema.string().required().description('Cloudflare UID'),
  APIKey: Schema.string().required().description('API Key'),
  AIModel :Schema.string().default("@cf/meta/llama-3-8b-instruct").description('模型 ID。'),
  BotName: Schema.string().required().description('Bot 的名字'),
  BotHometown: Schema.string().default("广州").description('Bot 的家乡。'),
  MaxMsgNum: Schema.number().default(8).description('Bot 每次最大接收的消息数'),
  MinMsgNum: Schema.number().default(3).description('Bot 每次最小接收的消息数'),
  SendDirectly: Schema.boolean().default(false).description("运行时屏蔽其他指令")
})

async function run(BaseAPI, UID, APIKey, model: string, input: any): Promise<any> {
  const response = await fetch(
    `${BaseAPI}/accounts/${UID}/ai/run/${model}`,
    {
      headers: { Authorization: `Bearer ${APIKey}` },
      method: "POST",
      body: JSON.stringify(input),
    }
  );

  const result = response.json();
  //console.log(`Response: ${JSON.stringify(result)}`)
  return result;
}

function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

let curTimes: number = 0;

class SendQueue {
	  // 存储消息队列
	  // 一个 group 对应一个数组
    private sendQueueMap: Map<number, { sender: string, content: string }[]>;

    constructor() {
        this.sendQueueMap = new Map<number, { sender: string, content: string }[]>();
    }

	  // 往消息队列添加消息
    updateSendQueue(group: number, sender: string, content: string) {
        if (this.sendQueueMap.has(group)) {
            const queue = this.sendQueueMap.get(group);
            queue.push({ sender, content });
            this.sendQueueMap.set(group, queue);
        } else {
            this.sendQueueMap.set(group, [{ sender, content }]);
        }
    }

	  // 检查队列长度
    checkQueueSize(group: number, size: number): boolean {
        if (this.sendQueueMap.has(group)) {
            const queue = this.sendQueueMap.get(group);
            console.log(`${queue.length} / ${size}`)
            return queue.length > size;
        }
        return false;
    }

	  // 重置消息队列
    resetSendQueue(group: number) {
        if (this.sendQueueMap.has(group)) {
            this.sendQueueMap.set(group, []);
        }
    }
	
	  // 转换成字符串，格式：[{'A':'大家好'},{'B':'你好'},{'C':'____'}]
    getPrompt(group: number, name: string): string {
      if (this.sendQueueMap.has(group)) {
        const queue = this.sendQueueMap.get(group);
        const promptArr = queue.map(item => ({ [item.sender]: item.content }));
        promptArr.push({ [name]: "_____" })
        return JSON.stringify(promptArr);
      }
      return "[]";
	}
}

const sendQueue = new SendQueue();

export function apply(ctx: Context, config: Config) {
  ctx.middleware(async (session, next) => {
    // 初始化
    if (!curTimes) curTimes = getRandomInt(config.MinMsgNum, config.MaxMsgNum)
    // 加入消息队列
    let groupId: number = (session.channelId == '#' ? 0 : Number(session.channelId))
    if (!config.AllowedGroups.includes(groupId)) return next();
    sendQueue.updateSendQueue(groupId, session.event.user.name, session.content)
    // 检测是否达到发送次数
    if (!sendQueue.checkQueueSize(groupId, curTimes)) return next()
	  // 重置随机数 curTimes
    curTimes = getRandomInt(config.MinMsgNum, config.MaxMsgNum)
    console.log(`request sent... awaiting for response`)
    const response = await run(config.BaseAPI, config.UID, config.APIKey, config.AIModel, {
        messages: [
            {
                role: "system",
                content: `你现在是一位来自${config.BotHometown}的考生, 名字叫 ${config.BotName}，性格温和。这是你在一次语文考试中遇到的题目： 给定一个微信群对话的节选，在指定位置填空，要求语言简明连贯得体，符合对话主题，适当使用emoji。除此之外，切记使用网络用语。题目将使用json格式给出，例如“[{'A':'今天吃什么'},{'B':'薯条'},{'C':'_________'}]”，其中你将需要填写填空部分的文字，例如“牛排”。你直接给出你的答案，禁止携带引号以及任何多余信息。另外，你还需要使用口语化的表达，并紧密结合讨论主题，表述时应符合你的身份特征。如果你不能理解对话内容，你只需要想其他人一样，随声附和即可，不要试图转移话题。你的回答必须根据意群换行，去掉标点符号，用空格代替。你的回答只能为中文。如果你理解以上要求，现在即将给出第一道题：${sendQueue.getPrompt(groupId, config.BotName)}，请你直接填写答案：`,
            }
        ],
    });
    
    console.log(sendQueue.getPrompt(groupId, config.BotName))

    // 重置消息队列
    sendQueue.resetSendQueue(groupId)

    // 发送消息
    return (config.SendDirectly ? response.result.response.replace(/['"]+/g, '').split(/[(\r\n)\r\n]+/)[0] : next(response.result.response.replace(/['"]+/g, '').split(/[(\r\n)\r\n]+/)[0])) 
  });
}