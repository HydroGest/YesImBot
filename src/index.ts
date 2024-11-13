import { Context, Next, Schema, h, Random } from "koishi";

import { ResponseVerifier } from "./utils/verifier";

import { configSchema } from "./config";

import { genSysPrompt, ensurePromptFileExists } from "./utils/prompt";

import { run } from "./utils/api-adapter";

import { SendQueue } from "./utils/queue";

import { handleResponse, processUserContent } from "./utils/content";

export const name = "yesimbot";

export const usage = `\"Yes! I'm Bot!\" 是一个能让你的机器人激活灵魂的插件。
使用请阅读 [Github README](https://github.com/HydroGest/YesImBot/blob/main/readme.md)，推荐使用 [GPTGOD](https://gptgod.online/#/register?invite_code=envrd6lsla9nydtipzrbvid2r) 提供的 GPT-4o-mini 模型以获得最高性价比。
官方交流 & 测试群：[857518324](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=k3O5_1kNFJMERGxBOj1ci43jHvLvfru9&authKey=TkOxmhIa6kEQxULtJ0oMVU9FxoY2XNiA%2B7bQ4K%2FNx5%2F8C8ToakYZeDnQjL%2B31Rx%2B&noverify=0&group_code=857518324)
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
        }[];
    };
    Parameters: {
      Temperature: number;
      MaxTokens: number;
      TopK: number;
      TopP: number;
      TypicalP: number;
      MinP: number;
      TopA: number;
      FrequencyPenalty: number;
      PresencePenalty: number;
      Stop: string[];
      OtherParameters: string[];
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
        BotSentencePostProcess: any;
    };
    Debug: {
        LogicRedirect: {
            Enabled: boolean;
            Target: string;
        }
        DebugAsInfo: boolean;
        DisableGroupFilter: boolean;
        UpdatePromptOnLoad: boolean;
        AllowErrorFormat: boolean;
    };
}

export const Config: Schema<Config> = configSchema;

const sendQueue = new SendQueue();

const responseVerifier = new ResponseVerifier();

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

export const inject = {
  optional: ['qmanager', 'interactions']
}

export function apply(ctx: Context, config: Config) {
    // 当应用启动时更新 Prompt
    ctx.on("ready", async () => {
        if (!config.Debug.UpdatePromptOnLoad) return;
        ctx.logger.info("正在尝试更新 Prompt 文件...");
        await ensurePromptFileExists(
            config.Bot.PromptFileUrl[config.Bot.PromptFileSelected],
            config.Debug.DebugAsInfo ? ctx : null,
            true
        );
    });

    ctx.middleware(async (session: any, next: Next) => {
        const groupId: string = session.channelId;

        if (config.Debug.DebugAsInfo)
            ctx.logger.info(`New message recieved, channelId = ${groupId}`);

        if (
            !config.Group.AllowedGroups.includes(groupId) &&
            !config.Debug.DisableGroupFilter
        )
            return next();

        const userContent = await processUserContent(session);

        sendQueue.updateSendQueue(
            groupId,
            session.event.user.name,
			session.event.user.id,
            userContent,
            session.messageId,
            config.Group.Filter
        );

        // 检测是否达到发送次数或被 at
        // 返回 false 的条件：
        // 发送队列已满 或者 用户消息提及机器人且随机条件命中：
        if (
            !sendQueue.checkQueueSize(groupId, config.Group.SendQueueSize) &&
            !(
                userContent.includes(`@${config.Bot.BotName}`) &&
                Random.bool(config.Group.AtReactPossiblilty)
            )
        ) {
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

        // 获取 Prompt
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
            ctx.logger.info(
                `Using API ${curAPI}, BaseURL ${config.API.APIList[curAPI].BaseURL}.`
            );

        // 获取回答
        const { response, requestBody } = await run(
            config.API.APIList[curAPI].APIType,
            config.API.APIList[curAPI].BaseURL,
            config.API.APIList[curAPI].UID,
            config.API.APIList[curAPI].APIKey,
            config.API.APIList[curAPI].AIModel,
            SysPrompt,
            chatData,
            config.Parameters
        );

        if (config.Debug.DebugAsInfo)
            ctx.logger.info(`Request body: ${JSON.stringify(requestBody, null, 2)}`);

        if (config.Debug.DebugAsInfo)
            ctx.logger.info(JSON.stringify(response, null, 2));

        const handledRes: {
            res: string;
            LLMResponse: any;
            usage: any;
        } = handleResponse(
            config.API.APIList[curAPI].APIType,
            response,
            config.Debug.AllowErrorFormat
        );

        const finalRes: string = handledRes.res;

        if (config.Debug.LogicRedirect.Enabled) {
            const template = `回复于 ${groupId} 的消息已生成，来自 API ${curAPI}:
内容: ${(handledRes.LLMResponse.finReply ? handledRes.LLMResponse.finReply : handledRes.LLMResponse.reply)}
---
逻辑: ${handledRes.LLMResponse.logic}
---
指令：${(handledRes.LLMResponse.execute ? handledRes.LLMResponse.execute : "无")}
---
消耗: 输入 ${handledRes.usage["prompt_tokens"]}, 输出 ${handledRes.usage["completion_tokens"]}`;
            await session.bot.sendMessage(config.Debug.LogicRedirect.Target, template);
        }

        responseVerifier.loadConfig(config);

        const isAllowed = await responseVerifier.verifyResponse(finalRes);

        if (!isAllowed) {
            if (config.Debug.DebugAsInfo) {
                ctx.logger.info(
                    "Response filtered due to high similarity with previous response"
                );
            }
            return next();
        }

        responseVerifier.setPreviousResponse(finalRes);

        const sentences = finalRes.split(/(?<=[。?!？！])\s*/);

        sendQueue.updateSendQueue(
            groupId,
            config.Bot.BotName,
			0,
            finalRes,
            0,
            config.Group.Filter
        );

        // 如果 AI 使用了指令
        if (handledRes.LLMResponse.execute) {
            handledRes.LLMResponse.execute.forEach(async (command) => {
                await session.sendQueued(h('execute', {}, command)); // 执行每个指令
				ctx.logger.info(`已执行指令：${command}`)
            });
        }

        let sentencesCopy = [...sentences];
        while (sentencesCopy.length > 0) {
            let sentence = sentencesCopy.shift();
            if (!sentence) { continue; }
            config.Bot.BotSentencePostProcess.forEach(rule => {
              const regex = new RegExp(rule.replacethis, "g");
              if (!rule.tothis) {
                sentence = sentence.replace(regex, "");
              } else {
                sentence = sentence.replace(regex, rule.tothis);
              }
            });
            if (config.Debug.DebugAsInfo) { ctx.logger.info(sentence); }
            await session.sendQueued(sentence);
        }
    });
}
