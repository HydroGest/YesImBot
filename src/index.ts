import { Context, Next, Schema, h, Random } from "koishi";

import { ResponseVerifier } from "./utils/verifier";

import { configSchema } from "./config";

import { genSysPrompt, ensurePromptFileExists, getMemberName, getBotName } from "./utils/prompt";

import { runChatCompeletion } from "./utils/api-adapter";

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
    TriggerCount: number;
    MaxPopNum: number;
    MinPopNum: number;
    AtReactPossibility: number;
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
    OtherParameters: any;
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

  ctx.command('清除记忆 [group]').action(
    async ({ session }, group) => {
      const clearGroupId: string = group || (session.guildId ? session.guildId : `private:${session.userId}`);
      if (sendQueue.clearSendQueue(clearGroupId)) {
        session.send(`已清除关于 ${clearGroupId} 的记忆。`);
      } else {
        session.send(`未找到关于 ${clearGroupId} 的记忆。`);
      }
    }
  );

  ctx.middleware(async (session: any, next: Next) => {
    const groupId: string = session.guildId ? session.guildId : `private:${session.userId}`;
    const isPrivateChat = groupId.startsWith("private:");

    if (!session.groupMemberList && !isPrivateChat) {
      session.groupMemberList = await session.bot.getGuildMemberList(session.guildId);
      session.groupMemberList.data.forEach(member => {
        if (!member.nick) {
          member.nick = member.user.name || member.user.username;
        }
      });
    } else if (isPrivateChat) {
      session.groupMemberList = { data: [
        { user:
          { id: `${session.event.user.id}`,
            name: `${session.event.user.name}`,
            userId: `${session.event.user.id}`,
            avatar: `http://q.qlogo.cn/headimg_dl?dst_uin=${session.event.user.id}&spec=640`,
            username: `${session.event.user.name}`
          },
          nick: `${session.event.user.name}`,
          roles: [ 'member' ]
        },
        { user:
          { id: `${session.event.selfId}`,
            name: `${session.bot.user.name}`,
            userId: `${session.event.selfId}`,
            avatar: `http://q.qlogo.cn/headimg_dl?dst_uin=${session.event.selfId}&spec=640`,
            username: `${session.bot.user.name}`
          },
          nick: `${session.bot.user.name}`,
          roles: [ 'member' ]
        }
       ]
      };
    }

    if (config.Debug.DebugAsInfo)
      ctx.logger.info(`New message received, guildId = ${groupId}`);

    if (
      !config.Group.AllowedGroups.includes(groupId) &&
      !config.Debug.DisableGroupFilter
    )
      return next();

    const userContent = await processUserContent(config, session);

    // 更新消息队列，把这条消息加入队列
    sendQueue.updateSendQueue(
      groupId,
      await getMemberName(config, session, session.event.user.id),
      session.event.user.id,
      userContent.content,
      session.messageId,
      config.Group.Filter,
      config.Group.TriggerCount,
      session.event.selfId
    );

    // 检测是否达到发送次数或被 at
    // 返回 false 的条件：
    // 达到触发条数 或者 用户消息提及机器人且随机条件命中。也就是说：
    // 如果触发条数没有达到 (!isTriggerCountReached)
    // 并且消息没有提及机器人或者提及了机器人但随机条件未命中 (!(isAtMentioned && shouldReactToAt))
    // 那么就会执行内部的代码，即跳过这个中间件，不向api发送请求
    const isQueueFull: boolean = sendQueue.checkQueueSize(groupId, config.Group.SendQueueSize);
    const loginStatus = await session.bot.getLogin();
    const isBotOnline = loginStatus.status === 1;
    const atRegex = new RegExp(`<at (id="${session.bot.selfId}".*?|type="all".*?${isBotOnline ? '|type="here"' : ''}).*?/>`);
    const isAtMentioned = atRegex.test(session.content);
    const isTriggerCountReached = sendQueue.checkTriggerCount(groupId, Random.int(config.Group.MinPopNum, config.Group.MaxPopNum), isAtMentioned);
    const shouldReactToAt = Random.bool(config.Group.AtReactPossibility);

    // 如果消息队列满了，出队消息到config.Group.SendQueueSize
    if (isQueueFull) {
      sendQueue.resetSendQueue(groupId, config.Group.SendQueueSize);
    }

    if (!isTriggerCountReached && !(isAtMentioned && shouldReactToAt)) {
      if (config.Debug.DebugAsInfo)
        ctx.logger.info(await sendQueue.getPrompt(groupId, config, session));
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
      session.guildName,
      session
    );
    const chatData: string = await sendQueue.getPrompt(groupId, config, session);
    const curAPI = status.getStatus();
    status.updateStatus(config.API.APIList.length);

    if (config.Debug.DebugAsInfo)
      ctx.logger.info(
        `Using API ${curAPI}, BaseURL ${config.API.APIList[curAPI].BaseURL}.`
      );

    // 获取回答
    const { response, requestBody } = await runChatCompeletion(
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
    } = await handleResponse(
      config.API.APIList[curAPI].APIType,
      response,
      config.Debug.AllowErrorFormat,
      config,
      session
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
      await getBotName(config, session),
      session.event.selfId,
      finalRes,
      0,  // session.messageId，但是这里是机器人自己发的消息，所以设为0
      config.Group.Filter,
      config.Group.TriggerCount,
      session.event.selfId
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
