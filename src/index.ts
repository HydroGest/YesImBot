import { Context, Next, h, Random, Session } from "koishi";

import JSON5 from "json5";

import { ResponseVerifier } from "./utils/verifier";

import { Config } from "./config";

import { isGroupAllowed, foldText } from "./utils/tools";

import { genSysPrompt, ensurePromptFileExists, getMemberName, getBotName } from "./utils/prompt";

import { SendQueue } from "./utils/queue";

import { processUserContent } from "./utils/content";

import { Adapter, register } from "./adapters";

export const name = "yesimbot";

export const usage = `\"Yes! I'm Bot!\" 是一个能让你的机器人激活灵魂的插件。
使用请阅读 [Github README](https://github.com/HydroGest/YesImBot/blob/main/readme.md)，推荐使用 [GPTGOD](https://gptgod.online/#/register?invite_code=envrd6lsla9nydtipzrbvid2r) 提供的 GPT-4o-mini 模型以获得最高性价比。
官方交流 & 测试群：[857518324](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=k3O5_1kNFJMERGxBOj1ci43jHvLvfru9&authKey=TkOxmhIa6kEQxULtJ0oMVU9FxoY2XNiA%2B7bQ4K%2FNx5%2F8C8ToakYZeDnQjL%2B31Rx%2B&noverify=0&group_code=857518324)
`;

export { Config } from "./config";

export const inject = {
  optional: ['qmanager', 'interactions']
}

const sendQueue = new SendQueue();

const responseVerifier = new ResponseVerifier();

class APIStatus {
  private currentStatus: number = 0;

  updateStatus(APILength: number): void {
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
  let adapters: Adapter[] = [];
  // 当应用启动时更新 Prompt
  ctx.on("ready", async () => {
    // Return 之前，更新一下 adapters 吧
    adapters = updateAdapters(config.API.APIList);
    if (!config.Debug.UpdatePromptOnLoad) return;
    ctx.logger.info("正在尝试更新 Prompt 文件...");
    await ensurePromptFileExists(
      config.Bot.PromptFileUrl[config.Bot.PromptFileSelected],
      config.Debug.DebugAsInfo ? ctx : null,
      true
    );
  });

  // 某些适配器无法在中间件中获取到手动发送的来自 BOT 的消息，但是如果适配器支持的话，可能重复处理 BOT 的消息，这点不知道怎么解决
  ctx.on('message-created', async (session) => {
    const groupId: string = session.guildId || session.channelId;
    await ensureGroupMemberList(session, groupId);
    // 把仙人顶号发送的消息也加入队列
    if (session.userId == session.selfId && config.Debug.AddAllMsgtoQueue) {
      sendQueue.updateSendQueue(
        groupId,
        await getBotName(config, session),
        session.selfId,
        addQuoteTag(session, session.content),
        session.messageId,
        config.Group.Filter,
        config.Group.TriggerCount,
        session.selfId
      )
    }
  });

  ctx.command('清除记忆', '清除 BOT 对会话的记忆')
    .option('target', '-t <target> 指定要清除记忆的会话。使用 private:指定私聊会话', { authority: 3 })
    .usage('注意：如果使用 清除记忆 <target> 来清除记忆而不带-t参数，将会清除当前会话的记忆！')
    .example('清除记忆')
    .example('清除记忆 -t private:1234567890')
    .example('清除记忆 -t 987654321')
    .action(async ({ session, options }) => {
      const msgDestination = session.guildId || session.channelId;
      const clearGroupId = options.target || msgDestination;
      const userContent = await processUserContent(config, session);

      if (config.Debug.AddAllMsgtoQueue) {
        await ensureGroupMemberList(session, msgDestination);
        sendQueue.updateSendQueue(
          msgDestination,
          await getMemberName(config, session, session.event.user.id),
          session.event.user.id,
          addQuoteTag(session, userContent.content),
          session.messageId,
          config.Group.Filter,
          config.Group.TriggerCount,
          session.event.selfId
        );
      }

      const msg = sendQueue.clearSendQueue(clearGroupId)
        ? `已清除关于 ${clearGroupId} 的记忆`
        : `未找到关于 ${clearGroupId} 的记忆`;

      const commandResponseId = (await session.bot.sendMessage(msgDestination, msg))[0];

      if (config.Debug.AddAllMsgtoQueue) {
        sendQueue.updateSendQueue(
          msgDestination,
          await getBotName(config, session),
          session.event.selfId,
          msg, // 此处无需添加引用Tag
          commandResponseId, // 发送消息并获取消息ID
          config.Group.Filter,
          config.Group.TriggerCount,
          session.event.selfId
        );
      }
      return;
    });

  ctx.middleware(async (session: any, next: Next) => {
    const groupId: string = session.guildId || session.channelId;
    await ensureGroupMemberList(session, groupId);
    session.guildName = `${session.bot.user.name}与${session.event.user.name}的私聊`;

    if (config.Debug.DebugAsInfo)
      ctx.logger.info(`New message received, guildId = ${groupId}, content = ${foldText(session.content, 1000)}`);

    if (!config.Group.AllowedGroups?.length) return next();

    const [isGuildAllowed, matchedConfig] = isGroupAllowed(groupId, config.Group.AllowedGroups, config.Debug.FirsttoAll);
    if (!isGuildAllowed) return next();
    const mergeQueueFrom = matchedConfig;

    const userContent = await processUserContent(config, session);

    // 更新消息队列，把这条消息加入队列
    sendQueue.updateSendQueue(
      groupId,
      await getMemberName(config, session, session.event.user.id),
      session.event.user.id,
      addQuoteTag(session, userContent.content),
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
    const isMixedQueueFull: boolean = sendQueue.checkMixedQueueSize(mergeQueueFrom, config.Group.SendQueueSize);
    const loginStatus = await session.bot.getLogin();
    const isBotOnline = loginStatus.status === 1;
    const atRegex = new RegExp(`<at (id="${session.bot.selfId}".*?|type="all".*?${isBotOnline ? '|type="here"' : ''}).*?/>`);
    const isAtMentioned = atRegex.test(session.content);
    const isTriggerCountReached = sendQueue.checkTriggerCount(groupId);
    const shouldReactToAt = Random.bool(config.Group.AtReactPossibility);

    // 如果消息队列满了，出队消息到config.Group.SendQueueSize
    if (isQueueFull) {
      sendQueue.resetSendQueue(groupId, config.Group.SendQueueSize);
    }
    if (isMixedQueueFull) {
      ctx.logger.info("记忆槽位已满，超出的旧消息将被遗忘");
    }

    if (!isTriggerCountReached && !(isAtMentioned && shouldReactToAt)) {
      if (config.Debug.DebugAsInfo)
        ctx.logger.info(foldText((await sendQueue.getPrompt(mergeQueueFrom, config, session)), 2048));
      return next();
    }

    if (!adapters || adapters.length === 0) { // 忘了设置 API 的情况，也是No API is available
      ctx.logger.info("无可用的 API，请检查配置");
      return next();
    }

    await ensurePromptFileExists(
      config.Bot.PromptFileUrl[config.Bot.PromptFileSelected],
      config.Debug.DebugAsInfo ? ctx : null
    );

    if (config.Debug.DebugAsInfo)
      ctx.logger.info(`Request sent, awaiting for response...`);

    // ctx.logger.info(session.guildName); 奇怪，为什么群聊时这里也是 undefined？

    // 获取 Prompt
    const SysPrompt: string = await genSysPrompt(
      config,
      // TODO: 私聊提示词
      // 使用完整写法 `session.event.guild.name` 会导致私聊时由于 `session.event.guild` 未定义而报错
      session.guildName ? session.guildName : session.event.user?.name,
      session
    );
    const chatData: string = await sendQueue.getPrompt(mergeQueueFrom, config, session);
    const curAPI = status.getStatus();
    status.updateStatus(adapters.length);

    if (config.Debug.DebugAsInfo)
      ctx.logger.info(
        `Using API ${curAPI}, BaseURL ${config.API.APIList[curAPI].BaseURL}.`
      );

    // 获取回答
    const response = await adapters[curAPI].runChatCompeletion(
      SysPrompt,
      chatData,
      config.Parameters,
      config.ImageViewer.Detail,
      config.ImageViewer.How,
      config.Debug.DebugAsInfo
    );

    if (config.Debug.DebugAsInfo)
      ctx.logger.info(foldText(JSON5.stringify(response, null, 2), 3500));

    const handledRes: {
      status: string;
      originalRes: string;
      res: string;
      resNoTag: string;
      resNoTagExceptQuote: string;
      replyTo: string;
      quote: string;
      nextTriggerCount: number;
      logic: string;
      execute: Array<string>;
      usage?: any;
    } = await adapters[curAPI].handleResponse(
      response,
      config.Debug.AllowErrorFormat,
      config,
      session.groupMemberList.data
    );

    const finalRes: string = handledRes.res;
    let finalReplyTo: string = handledRes.replyTo;
    const nextTriggerCountbyLLM: number = Math.max(
      config.Group.MinPopNum,
      Math.min(
        handledRes.nextTriggerCount ?? config.Group.MinPopNum,
        config.Group.MaxPopNum
      )
    );
    const nextTriggerCountbyConfig: number = Random.int(config.Group.MinPopNum, config.Group.MaxPopNum + 1); // 双闭区间

    // 更新触发次数
    sendQueue.resetTriggerCount(groupId, handledRes.nextTriggerCount ? nextTriggerCountbyLLM : nextTriggerCountbyConfig);

    const quoteGroup = sendQueue.findGroupByMessageId(handledRes.quote, mergeQueueFrom);
    if (quoteGroup == null) {
      if (config.Debug.DebugAsInfo) {
        ctx.logger.info(
          handledRes.quote === ''
            ? "There's no quote message, using session_id."
            : "Quote message not found, using session_id."
        );
      }
      if (!finalReplyTo) {
        finalReplyTo = groupId;
        if (config.Debug.DebugAsInfo) {
          ctx.logger.info(`There's no session_id, using ${groupId} Instead.`);
        }
      }
    } else {
      finalReplyTo = quoteGroup;
    }

    if (handledRes.status === "fail") {
      if (config.Debug.LogicRedirect.Enabled) {
        const failTemplate = `LLM 的响应无法正确解析。
原始响应:
${handledRes.originalRes}
---
消耗: 输入 ${handledRes?.usage?.prompt_tokens}, 输出 ${handledRes?.usage?.completion_tokens}`;
        const botMessageId = (await session.bot.sendMessage(config.Debug.LogicRedirect.Target, failTemplate))[0];
        if (config.Debug.AddAllMsgtoQueue) {
          sendQueue.updateSendQueue(
            config.Debug.LogicRedirect.Target,
            await getBotName(config, session),
            session.event.selfId,
            failTemplate,
            botMessageId,
            config.Group.Filter,
            config.Group.TriggerCount,
            session.event.selfId
          )
        }
      }
      throw new Error(`LLM provides unexpected response:
${handledRes.originalRes}`);
    }

    if (config.Debug.LogicRedirect.Enabled) {
      const template = `${handledRes.status === "skip" ? `${await getBotName(config, session)}想要跳过此次回复` : `回复于 ${finalReplyTo} 的消息已生成，来自 API ${curAPI}:
状态: ${handledRes.status}`}
---
内容: ${handledRes.res && handledRes.res.trim() ? handledRes.res : "无"}
---
逻辑: ${handledRes.logic}
---
指令：${handledRes.execute?.length ? handledRes.execute : "无"}
---
消耗: 输入 ${handledRes?.usage?.prompt_tokens}, 输出 ${handledRes?.usage?.completion_tokens}`;
      // 有时候 LLM 就算跳过回复，也会生成内容，这个时候应该无视跳过，发送内容
      // 有时候 LLM 会生成空内容，这个时候就算是success也不应该发送内容，但是如果有执行指令，应该执行
      const templateNoTag = template.replace(handledRes.res, handledRes.resNoTag);
      const botMessageId = (await session.bot.sendMessage(config.Debug.LogicRedirect.Target, templateNoTag))[0];
      if (config.Debug.AddAllMsgtoQueue) {
        sendQueue.updateSendQueue(
          config.Debug.LogicRedirect.Target,
          await getBotName(config, session),
          session.event.selfId,
          template,
          botMessageId,
          config.Group.Filter,
          config.Group.TriggerCount,
          session.event.selfId
        );
      }
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

    const splitByTags = (text: string): string[] => {
      // 用于追踪标签的栈
      const stack: { tag: string; start: number }[] = [];
      // 存储分割后的文本片段
      const splits: { text: string; start: number; end: number }[] = [];
      const splitRegex = /(?<=[。?!？！])\s*/;
      let currentText = '';
      let i = 0;

      while (i < text.length) {
        if (text[i] === '<') {
          // 找到标签的开始
          let tagEnd = text.indexOf('>', i);
          if (tagEnd === -1) break;

          let tag = text.substring(i + 1, tagEnd);
          if (tag.startsWith('/')) {
            // 处理结束标签
            const openTag = stack.pop();
            if (openTag) {
              splits.push({
                text: text.substring(openTag.start, tagEnd + 1),
                start: openTag.start,
                end: tagEnd + 1
              });
            }
          } else if (tag.endsWith('/')) {
            // 处理自闭合标签
            splits.push({
              text: text.substring(i, tagEnd + 1),
              start: i,
              end: tagEnd + 1
            });
          } else {
            // 处理开始标签
            stack.push({ tag, start: i });
          }
          i = tagEnd + 1;
        } else {
          currentText += text[i];
          i++;
        }
      }

      // 按标点符号分割剩余文本
      const result: string[] = [];
      let lastEnd = 0;

      // 按开始位置对分割进行排序
      splits.sort((a, b) => a.start - b.start);

      for (const split of splits) {
        // 添加标签前的文本
        const beforeTag = text.substring(lastEnd, split.start);
        if (beforeTag) {
          result.push(...beforeTag.split(splitRegex));
        }
        // 将完整标签添加到结果中
        result.push(split.text);
        lastEnd = split.end;
      }

      // 添加最后一个标签后的剩余文本
      const afterLastTag = text.substring(lastEnd);
      if (afterLastTag) {
        result.push(...afterLastTag.split(splitRegex));
      }

      // 过滤空字符串并去除首尾空格
      const sentences = result.filter(s => s.trim()).map(s => s.trim());
      return sentences;
    };

    const sentences = splitByTags(finalRes);
    const sentencesNoTag = splitByTags(handledRes.resNoTagExceptQuote);



    // 如果 AI 使用了指令
    if (handledRes.execute) {
      handledRes.execute.forEach(async (command) => {
        try {
          const botMessageId = (await session.bot.sendMessage(finalReplyTo, h("execute", {}, command)))[0]; // 执行每个指令，获取返回的消息ID字符串数组
          if (config.Debug.AddAllMsgtoQueue) {
            sendQueue.updateSendQueue(
              finalReplyTo,
              await getBotName(config, session),
              session.event.selfId,
              h("execute", {}, command).toString(),
              botMessageId,
              config.Group.Filter,
              config.Group.TriggerCount,
              session.event.selfId
            )
          }
          ctx.logger.info(`已执行指令：${command}`);
        } catch (error) {
          ctx.logger.error(`执行指令<${command.toString()}>时出错: ${error}`)
        }
      });
    }

    let finalBotMsgId: string = "";
    while (sentences.length > 0) {
      let sentence = sentences.shift();
      let sentenceNoTag = sentencesNoTag.shift();
      if (!sentence) { continue; }
      config.Bot.BotSentencePostProcess.forEach(rule => {
        const regex = new RegExp(rule.replacethis, "g");
        if (!rule.tothis) {
          sentence = sentence.replace(regex, "");
          sentenceNoTag = sentenceNoTag.replace(regex, "");
        } else {
          sentence = sentence.replace(regex, rule.tothis);
          sentenceNoTag = sentenceNoTag.replace(regex, rule.tothis);
        }
      });
      if (config.Debug.DebugAsInfo) { ctx.logger.info(foldText(sentence, 1000)); }

      // 按照字数等待
      const waitTime = Math.ceil(sentence.length / config.Bot.WordsPerSecond);
      await new Promise((resolve) => setTimeout(resolve, waitTime * 1000));
      finalBotMsgId = (await session.bot.sendMessage(finalReplyTo, sentence))[0];
      if (config.Debug.WholetoSplit) {
        sendQueue.updateSendQueue(
          finalReplyTo,
          await getBotName(config, session),
          session.event.selfId,
          sentenceNoTag,
          finalBotMsgId,
          config.Group.Filter,
          config.Group.TriggerCount,
          session.event.selfId
        )
      }
    }
    if (!config.Debug.WholetoSplit) {
      sendQueue.updateSendQueue(
        finalReplyTo,
        await getBotName(config, session),
        session.event.selfId,
        handledRes.resNoTagExceptQuote,
        finalBotMsgId, // session.messageId，这里是机器人自己发的消息，设为最后一条消息的消息ID
        config.Group.Filter,
        config.Group.TriggerCount,
        session.event.selfId
      );
    }
  });
}

async function ensureGroupMemberList(session: any, groupId?: string) {
  const isPrivateChat = groupId.startsWith("private:");
  if (!session.groupMemberList && !isPrivateChat) {
    session.groupMemberList = await session.bot.getGuildMemberList(session.guildId);
    session.groupMemberList.data.forEach(member => {
      // 沙盒获取到的 member 数据不一样
      if (member.userId === member.username && !member.user) {
        member.user = {
          id: member.userId,
          name: member.username,
          userId: member.userId,
        };
        member.nick = member.username;
        member.roles = ['member'];
      }
      if (!member.nick) {
        member.nick = member.user.name || member.user.username;
      }
    });
  } else if (isPrivateChat) {
    session.groupMemberList = {
      data: [
        {
          user:
          {
            id: `${session.event.user.id}`,
            name: `${session.event.user.name}`,
            userId: `${session.event.user.id}`,
            avatar: `http://q.qlogo.cn/headimg_dl?dst_uin=${session.event.user.id}&spec=640`,
            username: `${session.event.user.name}`
          },
          nick: `${session.event.user.name}`,
          roles: ['member']
        },
        {
          user:
          {
            id: `${session.event.selfId}`,
            name: `${session.bot.user.name}`,
            userId: `${session.event.selfId}`,
            avatar: `http://q.qlogo.cn/headimg_dl?dst_uin=${session.event.selfId}&spec=640`,
            username: `${session.bot.user.name}`
          },
          nick: `${session.bot.user.name}`,
          roles: ['member']
        }
      ]
    };
  }
}

function updateAdapters(APIList: Config["API"]["APIList"]): Adapter[] {
  let adapters: Adapter[] = [];
  for (const adapter of APIList) {
    adapters.push(register(
      adapter.APIType,
      adapter.BaseURL,
      adapter.APIKey,
      adapter.UID,
      adapter.AIModel
    ))
  }
  return adapters;
}

function addQuoteTag(session: Session, content: string): string {
  if (session.event.message.quote) {
    return `<quote id="${session.event.message.quote.id}"/>${content}`;
  } else {
    return content;
  }
}
