import { Context, Next, Random, Session } from "koishi";

import { sleep, clone, h } from "koishi";

import { ResponseVerifier } from "./utils/verifier";

import { Config } from "./config";

import { addQuoteTag, APIStatus, ensureGroupMemberList, isGroupAllowed, ProcessingLock, updateAdapters } from "./utils/toolkit";

import { genSysPrompt, ensurePromptFileExists, getMemberName, getBotName } from "./utils/prompt";

import { SendQueue } from "./services/sendQueue";

import { processUserContent } from "./utils/content";

import { Adapter } from "./adapters";

import { foldText } from "./utils/string";

export const name = "yesimbot";

export const usage = `\"Yes! I'm Bot!\" 是一个能让你的机器人激活灵魂的插件。
使用请阅读 [Github README](https://github.com/HydroGest/YesImBot/blob/main/readme.md)，推荐使用 [GPTGOD](https://gptgod.online/#/register?invite_code=envrd6lsla9nydtipzrbvid2r) 提供的 GPT-4o-mini 模型以获得最高性价比。
官方交流 & 测试群：[857518324](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=k3O5_1kNFJMERGxBOj1ci43jHvLvfru9&authKey=TkOxmhIa6kEQxULtJ0oMVU9FxoY2XNiA%2B7bQ4K%2FNx5%2F8C8ToakYZeDnQjL%2B31Rx%2B&noverify=0&group_code=857518324)
`;

export { Config } from "./config";

export const inject = {
  optional: ['qmanager', 'interactions']
}


const status = new APIStatus();
const responseVerifier = new ResponseVerifier();
const processingLock = new ProcessingLock();

export function apply(ctx: Context, config: Config) {
  let adapters: Adapter[] = [];
  let sendQueue = new SendQueue(config);
  // 当应用启动时更新 Prompt
  ctx.on("ready", async () => {
    // Return 之前，更新一下 adapters 吧
    adapters = updateAdapters(config.API.APIList);
    if (!config.Settings.UpdatePromptOnLoad) return;
    ctx.logger.info("正在尝试更新 Prompt 文件...");
    await ensurePromptFileExists(
      config.Bot.PromptFileUrl[config.Bot.PromptFileSelected],
      config.Debug.DebugAsInfo ? ctx : null,
      true
    );
  });

  ctx.on('message-created', async (session) => {
    const groupId: string = session.guildId || session.channelId;
    await ensureGroupMemberList(session, groupId);
    const [, matchedConfig] = isGroupAllowed(groupId, config.MemorySlot.SlotContains, config.Settings.FirsttoAll);
    const mergeQueueFrom = sendQueue.getShouldIncludeQueue(matchedConfig, groupId).included;

    if ((session.userId === session.selfId || mergeQueueFrom.has(groupId)) && config.Settings.AddWhattoQueue === "所有消息") {
      const senderName = session.userId === session.selfId ? await getBotName(config, session) : await getMemberName(config, session, session.userId);
      processingLock.startProcessing(groupId);
      try {
        const content = await processUserContent(config, session);
        sendQueue.updateSendQueue(
          groupId,
          senderName,
          session.userId,
          addQuoteTag(session, content.content),
          session.messageId,
          config.MemorySlot.Filter,
          config.MemorySlot.FirstTriggerCount,
          session.selfId
        );
      } finally {
        processingLock.endProcessing(groupId);
      }
      sendQueue.clearQuietTimeout(groupId); // 收发
    }
  });

  ctx.command('清除记忆', '清除 BOT 对会话的记忆')
    .option('target', '-t <target> 指定要清除记忆的会话。使用 private:指定私聊会话，使用 all 或 private:all 分别清除所有群聊或私聊记忆', { authority: 3 })
    .option('person', '-p <person> 从所有会话中清除指定用户的记忆', { authority: 3 })
    .usage('注意：如果使用 清除记忆 <target> 来清除记忆而不带-t参数，将会清除当前会话的记忆！')
    .example([
      '清除记忆',
      '清除记忆 -t private:1234567890',
      '清除记忆 -t 987654321',
      '清除记忆 -t all',
      '清除记忆 -t private:all',
      '清除记忆 -p 1234567890'
    ].join('\n'))
    .action(async ({ session, options }) => {
      const msgDestination = session.guildId || session.channelId;

      // 保存其他人发送的消息
      if (config.Settings.AddWhattoQueue === "所有此插件发送和接收的消息") {
        await ensureGroupMemberList(session, msgDestination);
        const userContent = await processUserContent(config, session);
        sendQueue.updateSendQueue(
          msgDestination,
          await getMemberName(config, session, session.event.user.id),
          session.event.user.id,
          addQuoteTag(session, userContent.content),
          session.messageId,
          config.MemorySlot.Filter,
          config.MemorySlot.FirstTriggerCount,
          session.event.selfId
        );
        sendQueue.clearQuietTimeout(msgDestination);
      }

      let msg: string;

      if (options.person) {
        // 按用户QQ清除记忆
        const cleared = sendQueue.clearSendQueueByQQ(options.person);
        msg = cleared ? `已清除关于用户 ${options.person} 的记忆` : `未找到关于用户 ${options.person} 的记忆`;
      } else {
        const clearGroupId = options.target || msgDestination;
        // 要清除的会话集合
        const targetGroups = clearGroupId.split(",")
          .map(g => g.trim())
          .filter(Boolean);
        const { included } = sendQueue.getShouldIncludeQueue(new Set(targetGroups), msgDestination);

        // 清除记忆
        const clearResults = Array.from(included)
          .map(id => ({ id, cleared: sendQueue.clearSendQueue(id) }))
          .filter(r => r.cleared);

        const messages = [];
        if (clearResults.length > 0) {
          const clearedIds = clearResults.map(r => r.id);
          messages.push(`已清除关于 ${clearedIds.slice(0, 3).join(', ')}${clearedIds.length > 3 ? ' 等会话' : ''} 的记忆`);
          // 从 targetGroups 中移除已清除的会话
          clearResults.forEach(r => {
            const index = targetGroups.indexOf(r.id);
            if (index > -1) {
              targetGroups.splice(index, 1);
            }
          });
        }

        // 移除 "private:all" 和 "all"
        const specialGroups = ["private:all", "all"];
        specialGroups.forEach(group => {
          const index = targetGroups.indexOf(group);
          if (index > -1) {
            targetGroups.splice(index, 1);
          }
        });

        if (targetGroups.length > 0) {
          messages.push(`未找到关于 ${targetGroups.join(', ')} 的记忆`);
        }

        msg = messages.join('，');
      }

      const commandResponseId = config.Debug.TestMode
        ? (await session.send(msg))[0]
        : (await session.bot.sendMessage(msgDestination, msg))[0];
      sendQueue.clearQuietTimeout(msgDestination); // 发

      if (config.Settings.AddWhattoQueue === "所有此插件发送和接收的消息") {
        sendQueue.updateSendQueue(
          msgDestination,
          await getBotName(config, session),
          session.event.selfId,
          msg, // 此处无需添加引用Tag
          commandResponseId, // 发送消息并获取消息ID
          config.MemorySlot.Filter,
          config.MemorySlot.FirstTriggerCount,
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

    if (!config.MemorySlot.SlotContains?.length) return next();

    const [isGuildAllowed, matchedConfig] = isGroupAllowed(groupId, config.MemorySlot.SlotContains, config.Settings.FirsttoAll);
    if (!isGuildAllowed) return next();
    const mergeQueueFrom = sendQueue.getShouldIncludeQueue(matchedConfig, groupId).included;

    // 更新消息队列，把这条消息加入队列
    if (config.Settings.AddWhattoQueue === "所有此插件发送和接收的消息" || config.Settings.AddWhattoQueue === "所有和LLM交互的消息") {
      const userContent = await processUserContent(config, session);
      sendQueue.updateSendQueue(
        groupId,
        await getMemberName(config, session, session.event.user.id),
        session.event.user.id,
        addQuoteTag(session, userContent.content),
        session.messageId,
        config.MemorySlot.Filter,
        config.MemorySlot.FirstTriggerCount,
        session.event.selfId
      );
      sendQueue.clearQuietTimeout(groupId); // 收
    }

    // 启动静默检查
    if (config.MemorySlot.MaxTriggerTime > 0 && isGuildAllowed) {
      sendQueue.startQuietCheck(groupId, async () => {
        // 当静默期到达时获取回复
        ctx.logger.info("静默期到达，获取回复");
        handleMessage(
          session,
          config,
          ctx,
          adapters,
          status,
          processingLock,
          sendQueue,
          responseVerifier,
          groupId,
          mergeQueueFrom,
          nextTriggerCountbyConfig
        );
      });
    }

    // 检测是否达到发送次数或被 at
    // 返回 false 的条件：
    // 达到触发条数 或者 用户消息提及机器人且随机条件命中。也就是说：
    // 如果触发条数没有达到 (!isTriggerCountReached)
    // 并且消息没有提及机器人或者提及了机器人但随机条件未命中 (!(isAtMentioned && shouldReactToAt))
    // 那么就会执行内部的代码，即跳过这个中间件，不向api发送请求
    const isQueueFull: boolean = sendQueue.checkQueueSize(groupId, config.MemorySlot.SlotSize);
    const isMixedQueueFull: boolean = sendQueue.checkMixedQueueSize(mergeQueueFrom, config.MemorySlot.SlotSize);
    const loginStatus = await session.bot.getLogin();
    const isBotOnline = loginStatus.status === 1;
    const atRegex = new RegExp(`<at (id="${session.bot.selfId}".*?|type="all".*?${isBotOnline ? '|type="here"' : ''}).*?/>`);
    const isAtMentioned = atRegex.test(session.content);
    const isTriggerCountReached = sendQueue.checkTriggerCount(groupId);
    const shouldReactToAt = Random.bool(config.MemorySlot.AtReactPossibility);
    const nextTriggerCountbyConfig: number = Random.int(config.MemorySlot.MinTriggerCount, config.MemorySlot.MaxTriggerCount + 1); // 双闭区间

    // 如果消息队列满了，出队消息到config.MemorySlot.SlotSize
    if (isQueueFull) {
      sendQueue.resetSendQueue(groupId, config.MemorySlot.SlotSize);
    }
    if (isMixedQueueFull) {
      ctx.logger.info("记忆槽位已满，超出的旧消息将被遗忘");
    }

    if (!isTriggerCountReached && !(isAtMentioned && shouldReactToAt)) {
      if (config.Debug.DebugAsInfo)
        ctx.logger.info(foldText((await sendQueue.getPrompt(mergeQueueFrom, config, session)), 2048));
      return next();
    }

    // 记录当前触发时间
    const currentTime = Date.now();
    sendQueue.updateLastTriggerTime(groupId);

    // 等待一段时间，让可能的连续消息都进来
    await new Promise(resolve => setTimeout(resolve, config.MemorySlot.MinTriggerTime));

    // 等待后再次检查最后触发时间，如果在等待期间有新消息，则跳过当前消息
    if (sendQueue.getLastTriggerTime(groupId) > currentTime) {
      return next();
    }
    
    handleMessage(
      session,
      config,
      ctx,
      adapters,
      status,
      processingLock,
      sendQueue,
      responseVerifier,
      groupId,
      mergeQueueFrom,
      nextTriggerCountbyConfig
    );

    // 获取并发送回复
    async function handleMessage(
      session: any,
      config: Config,
      ctx: Context,
      adapters: Adapter[],
      status: APIStatus,
      processingLock: ProcessingLock,
      sendQueue: SendQueue,
      responseVerifier: ResponseVerifier,
      groupId: string,
      mergeQueueFrom: Set<string>,
      nextTriggerCountbyConfig: number
    ) {
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

      await processingLock.waitForProcessing(groupId);
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
        ctx.logger.info(`Using API ${curAPI}, BaseURL ${config.API.APIList[curAPI].BaseURL}.`);

      // 设置临时触发计数，在 LLM 回复之后会被再次更新
      sendQueue.resetTriggerCount(groupId, nextTriggerCountbyConfig);

      // 获取回答
      const response = await adapters[curAPI].runChatCompeletion(
        SysPrompt,
        chatData,
        clone(config.Parameters),
        config.ImageViewer.Detail,
        config.ImageViewer.How,
        config.Debug.DebugAsInfo
      );

      if (config.Debug.DebugAsInfo)
        ctx.logger.info(foldText(JSON.stringify(response, null, 2), 3500));

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
        config.Settings.AllowErrorFormat,
        config,
        session.groupMemberList.data
      );

      const finalRes: string = handledRes.res;
      let finalReplyTo: string = handledRes.replyTo;
      const nextTriggerCountbyLLM: number = Math.max(
        config.MemorySlot.MinTriggerCount,
        Math.min(
          handledRes.nextTriggerCount ?? config.MemorySlot.MinTriggerCount,
          config.MemorySlot.MaxTriggerCount
        )
      );

      // 正式更新触发次数
      const nextTriggerCount = handledRes.nextTriggerCount ? nextTriggerCountbyLLM : nextTriggerCountbyConfig;
      sendQueue.resetTriggerCount(groupId, nextTriggerCount);

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
        if (config.Settings.LogicRedirect.Enabled) {
          const failTemplate = `LLM 的响应无法正确解析。
原始响应:
${handledRes.originalRes}
---
消耗: 输入 ${handledRes?.usage?.prompt_tokens}, 输出 ${handledRes?.usage?.completion_tokens}`;
          const botMessageId = config.Debug.TestMode
            ? (await session.send(failTemplate))[0]
            : (await session.bot.sendMessage(config.Settings.LogicRedirect.Target, failTemplate))[0];
          sendQueue.clearQuietTimeout(config.Settings.LogicRedirect.Target); // 发
          if (config.Settings.AddWhattoQueue === "所有此插件发送和接收的消息") {
            sendQueue.updateSendQueue(
              config.Settings.LogicRedirect.Target,
              await getBotName(config, session),
              session.event.selfId,
              failTemplate,
              botMessageId,
              config.MemorySlot.Filter,
              config.MemorySlot.FirstTriggerCount,
              session.event.selfId
            )
          }
        }
        throw new Error(`LLM provides unexpected response:
${handledRes.originalRes}`);
      }

      if (config.Settings.LogicRedirect.Enabled) {
        const template = `${handledRes.status === "skip" ? `${await getBotName(config, session)}想要跳过此次回复` : `回复于 ${finalReplyTo} 的消息已生成，来自 API ${curAPI}:`}
---
内容: ${handledRes.res && handledRes.res.trim() ? handledRes.res : "无"}
---
逻辑: ${handledRes.logic}
---
指令：${handledRes.execute?.length ? handledRes.execute : "无"}
---
距离下次：${nextTriggerCountbyLLM} -> ${nextTriggerCount}
---
消耗: 输入 ${handledRes?.usage?.prompt_tokens}, 输出 ${handledRes?.usage?.completion_tokens}`;
        // 有时候 LLM 就算跳过回复，也会生成内容，这个时候应该无视跳过，发送内容
        // 有时候 LLM 会生成空内容，这个时候就算是success也不应该发送内容，但是如果有执行指令，应该执行
        const templateNoTag = template.replace(handledRes.res, handledRes.resNoTag);
        const botMessageId = config.Debug.TestMode
          ? (await session.send(templateNoTag))[0]
          : (await session.bot.sendMessage(config.Settings.LogicRedirect.Target, templateNoTag))[0];
        sendQueue.clearQuietTimeout(config.Settings.LogicRedirect.Target); // 发
        if (config.Settings.AddWhattoQueue === "所有此插件发送和接收的消息") {
          sendQueue.updateSendQueue(
            config.Settings.LogicRedirect.Target,
            await getBotName(config, session),
            session.event.selfId,
            template,
            botMessageId,
            config.MemorySlot.Filter,
            config.MemorySlot.FirstTriggerCount,
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

        // 过滤空字符串
        const sentences = result.filter(s => s.trim());

        // 合并标签前后的文本
        const mergedSentences: string[] = [];
        for (let i = 0; i < sentences.length; i++) {
          if (sentences[i].startsWith('<') && sentences[i].endsWith('>')) {
            if (i > 0) {
              mergedSentences[mergedSentences.length - 1] += sentences[i];
            } else {
              mergedSentences.push(sentences[i]);
            }
            if (i < sentences.length - 1 && !sentences[i + 1].startsWith('<')) {
              mergedSentences[mergedSentences.length - 1] += sentences[i + 1];
              i++;
            }
          } else {
            mergedSentences.push(sentences[i]);
          }
        }

        return mergedSentences;
      };

      const sentences = splitByTags(finalRes);
      const sentencesNoTag = splitByTags(handledRes.resNoTagExceptQuote);

      // 如果 AI 使用了指令
      if (handledRes.execute) {
        handledRes.execute.forEach(async (command) => {
          try {
            const botMessageId = config.Debug.TestMode
              ? (await session.send(h("execute", {}, command)))[0]
              : (await session.bot.sendMessage(finalReplyTo, h("execute", {}, command)))[0]; // 执行每个指令，获取返回的消息ID字符串数组
            // sendQueue.clearQuietTimeout(finalReplyTo); // 发，但指令执行不需要清除静默期
            if (config.Settings.AddWhattoQueue === "所有此插件发送和接收的消息" || config.Settings.AddWhattoQueue === "所有和LLM交互的消息") { // 虽然 LLM 使用的指令本身并不会发到消息界面，但为了防止 LLM 忘记自己用过指令，加入队列
              sendQueue.updateSendQueue(
                finalReplyTo,
                await getBotName(config, session),
                session.event.selfId,
                h("execute", {}, command).toString(),
                botMessageId,
                config.MemorySlot.Filter,
                config.MemorySlot.FirstTriggerCount,
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

        if (config.Bot.WordsPerSecond > 0) {
          // 按照字数等待
          const waitTime = Math.ceil(sentence.length / config.Bot.WordsPerSecond);
          await sleep(waitTime * 1000);
        }
        finalBotMsgId = config.Debug.TestMode
          ? (await session.send(sentence))[0]
          : (await session.bot.sendMessage(finalReplyTo, sentence))[0];
        sendQueue.clearQuietTimeout(finalReplyTo); // 发
        if (config.Settings.WholetoSplit && (config.Settings.AddWhattoQueue === "所有此插件发送和接收的消息" || config.Settings.AddWhattoQueue === "所有和LLM交互的消息")) {
          sendQueue.updateSendQueue(
            finalReplyTo,
            await getBotName(config, session),
            session.event.selfId,
            sentenceNoTag,
            finalBotMsgId,
            config.MemorySlot.Filter,
            config.MemorySlot.FirstTriggerCount,
            session.event.selfId
          )
        }
      }
      if (!config.Settings.WholetoSplit && (config.Settings.AddWhattoQueue === "所有此插件发送和接收的消息" || config.Settings.AddWhattoQueue === "所有和LLM交互的消息")) {
        sendQueue.updateSendQueue(
          finalReplyTo,
          await getBotName(config, session),
          session.event.selfId,
          handledRes.resNoTagExceptQuote,
          finalBotMsgId, // session.messageId，这里是机器人自己发的消息，设为最后一条消息的消息ID
          config.MemorySlot.Filter,
          config.MemorySlot.FirstTriggerCount,
          session.event.selfId
        );
      }
    }
  });
}

