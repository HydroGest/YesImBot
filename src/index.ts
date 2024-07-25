import {
    Context,
    Next,
    Schema,
    h,
    Random
} from "koishi";

import {
    genSysPrompt,
    ensurePromptFileExists,
    getFileNameFromUrl,
} from "./utils/prompt";

import {
    run
} from "./utils/api-adapter";

import {
    SendQueue
} from "./utils/queue";

import {
    handleResponse,
	processUserContent
} from "./utils/content";

export const name = "yesimbot";

export const usage = `\"Yes! I'm Bot!\" 是一个能让你的机器人激活灵魂的插件。
使用请阅读 [Github README](https://github.com/HydroGest/YesImBot/blob/main/readme.md)，推荐使用 [GPTGOD](https://gptgod.online/#/register?invite_code=envrd6lsla9nydtipzrbvid2r) 提供的 GPT-4o-mini 模型以获得最高性价比。
`;

export interface Config {
    Group: {
        AllowedGroups: any;
        SendQueueSize: number;
        MaxPopNum: number;
        MinPopNum: number;
        AtReactPossiblilty: number;
        Filter: any;
    };
    API: {
        APIList: {
            APIType: any;
            BaseURL: string;
            UID: string;
            APIKey: string;
            AIModel: string;
        } []
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
    };
}

export const Config: Schema < Config > = Schema.object({
    Group: Schema.object({
        AllowedGroups: Schema.array(Schema.string())
            .required()
            .description("允许的群聊"),
        SendQueueSize: Schema.number()
            .default(20)
            .description("Bot 接收的上下文数量（消息队列长度）"),
        MaxPopNum: Schema.number()
            .default(10)
            .description("消息队列每次出队的最大数量"),
        MinPopNum: Schema.number()
            .default(1)
            .description("消息队列每次出队的最小数量"),
        AtReactPossiblilty: Schema.number()
            .default(0.5)
            .min(0).max(1).step(0.05)
            .role('slider')
            .description("立即回复 @ 消息的概率"),
        Filter: Schema.array(Schema.string())
            .default(["你是", "You are", "吧", "呢"])
            .description("过滤的词汇（防止被调皮群友/机器人自己搞傻）"),
    }).description("群聊设置"),
    API: Schema.object({
        APIList: Schema.array(Schema.object({
            APIType: Schema.union(["OpenAI", "Cloudflare", "Custom URL"]).default("OpenAI").description(
                "API 类型"
            ),
            BaseURL: Schema.string()
                .default("https://api.openai.com/")
                .description("API 基础URL, 设置为“Custom URL”需要填写完整的 URL"),
            UID: Schema.string()
                .default("若非 Cloudflare 可不填")
                .description("Cloudflare UID"),
            APIKey: Schema.string().required().description("你的 API 令牌"),
            AIModel: Schema.string()
                .default("@cf/meta/llama-3-8b-instruct")
                .description("模型 ID"),
        })).description("单个 LLM API 配置，可配置多个 API 进行负载均衡。"),
    }).description("LLM API 相关配置"),
    Bot: Schema.object({
        PromptFileUrl: Schema.array(Schema.string())
            .default([
                "https://raw.githubusercontent.com/HydroGest/promptHosting/main/prompt.mdt",
                "https://raw.githubusercontent.com/HydroGest/promptHosting/main/prompt-next.mdt",
                "https://raw.githubusercontent.com/HydroGest/promptHosting/main/prompt-next-short.mdt",
            ])
            .description("Prompt 文件下载链接。一般情况下不需要修改！"),
        PromptFileSelected: Schema.number()
            .default(2)
            .description("Prompt 文件编号，从 0 开始。请阅读 readme 再修改!"),
        BotName: Schema.string().required().description("Bot 的名字"),
        WhoAmI: Schema.string()
            .default("一个普通的群友")
            .description("Bot 的简要设定"),
        BotHometown: Schema.string().default("广州").description("Bot 的家乡"),
        SendDirectly: Schema.boolean()
            .default(false)
            .description("运行时屏蔽其他指令"),
        BotYearold: Schema.string().default("16").description("Bot 的年龄"),
        BotPersonality: Schema.string()
            .default("外向/有爱")
            .description("Bot 性格"),
        BotGender: Schema.string().default("女").description("Bot 的性别"),
        BotHabbits: Schema.string().default("").description("Bot 的爱好"),
        BotBackground: Schema.string()
            .default("高中女生")
            .description("Bot 的背景"),
        CuteMode: Schema.boolean().default(false).description("原神模式（迫真"),
    }).description("机器人设定"),
    Debug: Schema.object({
        DebugAsInfo: Schema.boolean()
            .default(false)
            .description("在控制台显示 Debug 消息"),
    }).description("调试工具"),
});

const sendQueue = new SendQueue();

class APIStatus {
    private currentStatus: number = 0;

    updateStatus(APILength): void {
        this.currentStatus++;
        if (this.currentStatus >= APILength) {
            this.currentStatus = 0;
        }
    }
    getStatus(): number {
        return this.currentStatus;
    }
}

const status = new APIStatus();

export function apply(ctx: Context, config: Config) {
    ctx.middleware(async (session: any, next: Next) => {
        const groupId: string = session.channelId;

        if (config.Debug.DebugAsInfo)
            ctx.logger.info(`New message recieved, channeId = ${groupId}`);

        if (!config.Group.AllowedGroups.includes(groupId)) return next();

        const userContent = await processUserContent(session);

        sendQueue.updateSendQueue(
            groupId,
            session.event.user.name,
            userContent,
            session.messageId,
            config.Group.Filter
        );

        // 检测是否达到发送次数或被 at
        // 返回 false 的条件：
        // 发送队列已满 或者 用户消息提及机器人且随机条件命中：
        if (!sendQueue.checkQueueSize(groupId, config.Group.SendQueueSize) && !(
                userContent.includes(`@${config.Bot.BotName}`) && Random.bool(config.Group.AtReactPossiblilty)
            )) {
            if (config.Debug.DebugAsInfo)
                ctx.logger.info(sendQueue.getPrompt(groupId));
            return next();
        }

        await ensurePromptFileExists(
            config.Bot.PromptFileUrl[config.Bot.PromptFileSelected],
            config.Debug.DebugAsInfo ? ctx : null
        );

        if (config.Debug.DebugAsInfo)
            ctx.logger.info(`Request sent, awaiting for response...`);

        // 获取回答
        const SysPrompt: string = await genSysPrompt(
            config,
            session.event.channel.name,
            session.event.channel.name
        );

        // 消息队列出队
        const chatData: string = sendQueue.getPrompt(groupId);
        sendQueue.resetSendQueue(
            groupId,
            Random.int(config.Group.MinPopNum, config.Group.MaxPopNum)
        );

        const curAPI = status.getStatus();
        status.updateStatus(config.API.APIList.length);

        if (config.Debug.DebugAsInfo)
            ctx.logger.info(`Using API ${curAPI}, BaseURL ${config.API.APIList[curAPI].BaseURL}.`);

        const response = await run(
            config.API.APIList[curAPI].APIType,
            config.API.APIList[curAPI].BaseURL,
            config.API.APIList[curAPI].UID,
            config.API.APIList[curAPI].APIKey,
            config.API.APIList[curAPI].AIModel,
            SysPrompt,
            chatData
        );

        if (config.Debug.DebugAsInfo) ctx.logger.info(JSON.stringify(response));
        const finalRes: string = handleResponse(config.API.APIList[curAPI].APIType, response);
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
