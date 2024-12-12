import { Context, Next, Random, Session } from "koishi";
import { LoggerService } from "@cordisjs/logger";
import { h, sleep } from "koishi";

import { Config } from "./config";
import { getBotName, isChannelAllowed } from "./utils/toolkit";
import { ensurePromptFileExists, genSysPrompt } from "./utils/prompt";
import { MarkType, SendQueue } from "./services/sendQueue";
import { AdapterSwitcher } from "./adapters";
import { schemaPrompt } from "./adapters/creators/schema";
import { initDatabase } from "./database";
import { AssistantMessage, SystemMessage, UserMessage } from "./adapters/creators/component";
import { processContent, processText } from "./utils/content";
import { foldText, isEmpty } from "./utils/string";
import { createMessage } from "./models/ChatMessage";
import { convertUrltoBase64 } from "./utils/imageUtils";
import { ResponseVerifier } from "./utils/verifier";

export const name = "yesimbot";

export const usage = `
"Yes! I'm Bot!" 是一个能让你的机器人激活灵魂的插件。\n
使用请阅读 [Github README](https://github.com/HydroGest/YesImBot/blob/main/readme.md)，推荐使用 [GPTGOD](https://gptgod.online/#/register?invite_code=envrd6lsla9nydtipzrbvid2r) 提供的 GPT-4o-mini 模型以获得最高性价比。\n
官方交流 & 测试群：[857518324](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=k3O5_1kNFJMERGxBOj1ci43jHvLvfru9&authKey=TkOxmhIa6kEQxULtJ0oMVU9FxoY2XNiA%2B7bQ4K%2FNx5%2F8C8ToakYZeDnQjL%2B31Rx%2B&noverify=0&group_code=857518324)
`;

export { Config } from "./config";

export const DATABASE_NAME = name;

export const inject = {
  required: ["database"],
  optional: ["qmanager", "interactions"]
}

declare global {
  var logger: LoggerService;
}

export function apply(ctx: Context, config: Config) {
  globalThis.logger = ctx.logger;
  let shouldReTrigger = false;

  initDatabase(ctx);

  let adapterSwitcher: AdapterSwitcher;
  let verifier: ResponseVerifier;
  const sendQueue = new SendQueue(ctx, config);

  ctx.on("ready", async () => {
    adapterSwitcher = new AdapterSwitcher(config.API.APIList, config.Parameters);

    if (config.Verifier.Enabled)
      verifier = new ResponseVerifier(config);

    if (!config.Settings.UpdatePromptOnLoad) return;
    ctx.logger.info("正在尝试更新 Prompt 文件...");
    await ensurePromptFileExists(
      config.Bot.PromptFileUrl[config.Bot.PromptFileSelected],
      config.Debug.DebugAsInfo ? ctx : null,
      true
    );
  });

  ctx.on("message-created", async (session) => {
    // 等待1毫秒
    await new Promise((resolve) => setTimeout(resolve, 1));
    await sendQueue.addMessage(await createMessage(session));
  });

  ctx
    .command("清除记忆", "清除 BOT 对会话的记忆")
    .option("target", "-t <target:string> 指定要清除记忆的会话。使用 private:指定私聊会话，使用 all 或 private:all 分别清除所有群聊或私聊记忆", { authority: 3 })
    .option("person", "-p <person:string> 从所有会话中清除指定用户的记忆", { authority: 3 })
    .usage("注意：如果使用 清除记忆 <target> 来清除记忆而不带 -t 参数，将会清除当前会话的记忆！")
    .example([
      "清除记忆",
      "清除记忆 -t private:1234567890",
      "清除记忆 -t 987654321",
      "清除记忆 -t all",
      "清除记忆 -t private:all",
      "清除记忆 -p 1234567890",
    ].join("\n"))
    .action(async ({ session, options }) => {
      sendQueue.processingLock.start(session.messageId);

      sendQueue.setMark(session.messageId, MarkType.Command);

      const msgDestination = session.guildId || session.channelId;
      let result = "";
      // 私聊时，ctx.on先于ctx.command执行，所以这里不需要等待。这是什么奇怪的特性，不知道会不会和版本和适配器类型有关？或许应该强制让ctx.on先于ctx.command执行，然后这里的等待删掉？但是这样咱们的setMark就不能及时标记了；让ctx.command先于ctx.on执行的话，调用指令的那条消息就清除不到了。现在选择让ctx.command等待1毫秒。
      //if (!msgDestination.startsWith("private:")) {
        await sendQueue.processingLock.waitForProcess(session.messageId);
      //}

      if (options.person) {
        // 按用户ID清除记忆
        const cleared = await sendQueue.clearBySenderId(options.person);
        result = `${cleared ? "✅" : "❌"} 用户 ${options.person}`;
      } else {
        const clearGroupId = options.target || msgDestination;
        // 要清除的会话集合
        const targetGroups = clearGroupId
          .split(",")
          .map(g => g.trim())
          .filter(Boolean);

        const messages = [];

        if (targetGroups.includes("private:all")) {
          const success = await sendQueue.clearPrivateAll();
          messages.push(`${success ? "✅" : "❌"} 全部私聊记忆`);
        }

        if (targetGroups.includes("all")) {
          const success = await sendQueue.clearAll();
          messages.push(`${success ? "✅" : "❌"} 全部群组记忆`);
        }

        for (const id of targetGroups) {
          if (id === 'all' || id === 'private:all') continue;
          const success = await sendQueue.clearChannel(id);
          messages.push(`${success ? "✅" : "❌"} ${id}`);
        }

        result = messages.join('\n');
      }
      if (isEmpty(result)) return;

      const messageIds = await session.sendQueued(result);

      for (const messageId of messageIds) {
        sendQueue.setMark(messageId, MarkType.Command);
      }
      return;
    });

  ctx.middleware(async (session: Session, next: Next) => {
    const channelId = session.channelId;
    if (!isChannelAllowed(config.MemorySlot.SlotContains, channelId) || session.author.id == session.selfId) {
      return next();
    }

    // 确保消息入库
    await sendQueue.addMessage(await createMessage(session));

    const parsedElements = h.parse(session.content);

    // 提前下载图片，防止链接过期
    // h.select 怎么用？
    parsedElements.forEach((element) => {
      if (element.type === "img") {
        convertUrltoBase64(element.attrs.src, element.attrs.fileUnique)
          .then(() => {
            ctx.logger.info(`Image[${element.attrs.fileUnique}] downloaded. file-size: ${element.attrs.fileSize}`);
          })
          .catch((reason) => {
            ctx.logger.warn(`Image[${element.attrs.fileUnique}] download failed. ${reason}`)
          });
      }
    });

    // 检查是否应该回复
    // 检测是否达到发送次数或被 at
    // 返回 false 的条件：
    // 达到触发条数 或者 用户消息提及机器人且随机条件命中。也就是说：
    // 如果触发条数没有达到 (!isTriggerCountReached)
    // 并且消息没有提及机器人或者提及了机器人但随机条件未命中 (!(isAtMentioned && shouldReactToAt))
    // 那么就会执行内部的代码，即跳过这个中间件，不向api发送请求
    const loginStatus = await session.bot.getLogin();
    const isBotOnline = loginStatus.status === 1;

    const isAtMentioned = parsedElements.some(element =>
      element.type === 'at' &&
      (element.attrs.id === session.bot.selfId || element.attrs.type === 'all' || (isBotOnline && element.attrs.type === 'here'))
    );
    const shouldReactToAt = Random.bool(config.MemorySlot.AtReactPossibility);
    const isTriggerCountReached = sendQueue.checkTriggerCount(channelId);
    const shouldReply = (isAtMentioned && shouldReactToAt) || isTriggerCountReached || config.Debug.TestMode

    if (!shouldReply) return next();
    if (!await handleMessage(session)) return next();
    if (shouldReTrigger) {
      if (!await handleMessage(session)) return next();
    }
  });

  async function handleMessage(session: Session): Promise<boolean> {
    const channelId = session.channelId;

    // 获取锁，没有就会创建一个
    const channelMutex = sendQueue.getChannelMutex(channelId);
    // 检查是否已经被锁，是就跳过，并且后续再次触发
    if (channelMutex.isLocked()) {
      if (config.Debug.DebugAsInfo)
        ctx.logger.info(`频道 ${channelId} 正在处理另一个回复，跳过当前回复生成`);
      shouldReTrigger = true;
      return false;
    }
    shouldReTrigger = false;
    // 尝试获取锁
    const release = await channelMutex.acquire();

    try {
      // 处理内容
      const chatHistory = await processContent(config, session, await sendQueue.getMixedQueue(channelId));

      // 生成响应
      if (!chatHistory) {
        if (config.Debug.DebugAsInfo) ctx.logger.info(`未获取到${channelId}的聊天记录`);
        return false;
      }

      if (config.Debug.DebugAsInfo) ctx.logger.info("ChatHistory:\n" + chatHistory);

      const { current, adapter } = adapterSwitcher.getAdapter();

      if (!adapter) {
        ctx.logger.warn("没有可用的适配器");
        return false;
      }

      if (config.Debug.DebugAsInfo) ctx.logger.info(`Request sent, awaiting for response...`);

      let botName = await getBotName(config.Bot, session);

      const chatResponse = await adapter.generateResponse(
        [
          SystemMessage(await genSysPrompt(config, {
            curGroupName: channelId,
            BotName: botName,
            BotSelfId: session.bot.selfId,
            schemaPrompt
          })),
          AssistantMessage("Resolve OK"),
          UserMessage(chatHistory),
        ],
        session,
        config,
        config.Debug.DebugAsInfo
      );

      if (config.Debug.DebugAsInfo) ctx.logger.info(foldText(JSON.stringify(chatResponse, null, 2), 3500));

      // 处理响应
      let { status, content, nextTriggerCount, reason, replyTo, finalReply, logic, execute, quote, usage } = chatResponse;

      if (isEmpty(replyTo)) replyTo = session.channelId;

      sendQueue.setTriggerCount(channelId, nextTriggerCount);

      if (status === "fail") {
        const failTemplate = `
LLM 的响应无法正确解析，来自 API ${current}:
${reason}
原始响应:
${content}
---
消耗: 输入 ${usage?.prompt_tokens}, 输出 ${usage?.completion_tokens}`;
        await redirectLogicMessage(config, session, sendQueue, failTemplate);
        ctx.logger.error(`LLM provides unexpected response:\n${content}`);
        return;
      }

      const template = `
${status === "skip" ? `${botName}想要跳过此次回复` : `回复于 ${replyTo} 的消息已生成`}，来自 API ${current}:
---
内容: ${finalReply && finalReply.trim() ? finalReply : "无"}
---
逻辑: ${logic}
---
指令：${execute?.length ? execute : "无"}
---
距离下次：${nextTriggerCount}
---
消耗: 输入 ${usage?.prompt_tokens}, 输出 ${usage?.completion_tokens}`;
      await redirectLogicMessage(config, session, sendQueue, template);

      // 如果 AI 使用了指令
      if (Array.isArray(execute) && execute.length > 0) {
        execute.forEach(async (command) => {
          try {
            const messageIds = (replyTo === session.channelId)
              ? await session.send(h("execute", {}, command))
              : await session.bot.sendMessage(replyTo, h("execute", {}, command));
            for (const messageId of messageIds) {
              sendQueue.setMark(messageId, MarkType.Command);
            }
            ctx.logger.info(`已执行指令：${command}`);
          } catch (error) {
            ctx.logger.error(`执行指令<${command.toString()}>时出错: ${error}`);
          }
        });
      }

      if (!isEmpty(finalReply)) {

        if (config.Verifier.Enabled) {
          if (!verifier.verifyResponse(replyTo, finalReply)) {
            if (config.Verifier.Action === "丢弃") {
              return false;
            } else {
              shouldReTrigger = true;
              return true;
            }
          }
        }

        let messageIds = [];
        let sentences = processText(config["Bot"]["BotReplySpiltRegex"], config["Bot"]["BotSentencePostProcess"], finalReply);
        if (!isEmpty(quote)) sentences[0] = h.quote(quote).toString() + sentences[0];
        for (const sentence of sentences) {
          if (isEmpty(sentence)) continue;

          if (config.Bot.WordsPerSecond > 0) {
            // 按照字数等待
            const waitTime = Math.ceil(sentence.length / config.Bot.WordsPerSecond);
            await sleep(waitTime * 1000);
          }

          let arr = (replyTo === session.channelId)
            ? await session.sendQueued(sentence)
            : await session.bot.sendMessage(replyTo, sentence);
          messageIds = messageIds.concat(arr);
        }

        await sendQueue.addMessage({
          senderId: session.selfId,
          senderName: session.bot.user.name,
          senderNick: await getBotName(config.Bot, session),
          messageId: messageIds[0],
          channelId: replyTo,
          channelType: replyTo.startsWith("private:") ? "private" : (replyTo === "#" ? "sandbox" : "guild"),
          sendTime: new Date(),
          content: finalReply,
          quoteMessageId: quote
        });
        for (const messageId of messageIds) {
          sendQueue.setMark(messageId, MarkType.Added);
        }
      }
      return true;
    }

    catch (error) {
      ctx.logger.error(`处理消息时出错: ${error}`);
      return false;
    }

    finally {
      release();
    }
  }
}


async function redirectLogicMessage(
  config: Config,
  session: Session,
  sendQueue: SendQueue,
  message: string,
) {
  if (!config.Settings.LogicRedirect.Enabled) return;
  const messageIds = await session.bot.sendMessage(config.Settings.LogicRedirect.Target, message);
  for (const messageId of messageIds) {
    sendQueue.setMark(messageId, MarkType.LogicRedirect);
  }
}


