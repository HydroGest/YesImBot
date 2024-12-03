import { Context, Next, Random, Session } from "koishi";
import { clone, h } from "koishi";

import { Config } from "./config";
import { getMemberName, isChannelAllowed } from "./utils/toolkit";
import { ensurePromptFileExists } from "./utils/prompt";
import { SendQueue } from "./services/sendQueue";
import { AdapterSwitcher } from "./adapters";
import { getImageDescription } from "./services/imageViewer";
import { initDatabase } from "./database";

export const name = "yesimbot";

export const usage = `
"Yes! I'm Bot!" 是一个能让你的机器人激活灵魂的插件。\n
使用请阅读 [Github README](https://github.com/HydroGest/YesImBot/blob/main/readme.md)，推荐使用 [GPTGOD](https://gptgod.online/#/register?invite_code=envrd6lsla9nydtipzrbvid2r) 提供的 GPT-4o-mini 模型以获得最高性价比。\n
官方交流 & 测试群：[857518324](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=k3O5_1kNFJMERGxBOj1ci43jHvLvfru9&authKey=TkOxmhIa6kEQxULtJ0oMVU9FxoY2XNiA%2B7bQ4K%2FNx5%2F8C8ToakYZeDnQjL%2B31Rx%2B&noverify=0&group_code=857518324)
`;

export { Config } from "./config";

export const DATABASE_NAME = name;

export const inject = {
  optional: ['qmanager', 'interactions', 'database']
}

export function apply(ctx: Context, config: Config) {
  initDatabase(ctx);
  let adapterSwitcher: AdapterSwitcher;
  const sendQueue = new SendQueue(ctx, config);

  ctx.on("ready", async () => {
    adapterSwitcher = new AdapterSwitcher(config.API.APIList, config.Parameters);
    if (!config.Settings.UpdatePromptOnLoad) return;
    ctx.logger.info("正在尝试更新 Prompt 文件...");
    await ensurePromptFileExists(
      config.Bot.PromptFileUrl[config.Bot.PromptFileSelected],
      config.Debug.DebugAsInfo ? ctx : null,
      true
    );
  });

  ctx.on('message-created', async (session) => {
    const channelId = session.channelId;
    if (isChannelAllowed(config.MemorySlot.SlotContains, channelId)) {
      await sendQueue.addMessage(session);
    }
  })

  ctx.middleware(async (session: Session, next: Next) => {
    const channelId = session.channelId;
    if (!isChannelAllowed(config.MemorySlot.SlotContains, channelId))
      return next();
    // 检测是否达到发送次数或被 at
    // 返回 false 的条件：
    // 达到触发条数 或者 用户消息提及机器人且随机条件命中。也就是说：
    // 如果触发条数没有达到 (!isTriggerCountReached)
    // 并且消息没有提及机器人或者提及了机器人但随机条件未命中 (!(isAtMentioned && shouldReactToAt))
    // 那么就会执行内部的代码，即跳过这个中间件，不向api发送请求
    const isQueueFull: boolean = await sendQueue.checkQueueSize(channelId);
    const isMixedQueueFull: boolean = await sendQueue.checkMixedQueueSize(channelId);
    const loginStatus = await session.bot.getLogin();
    const isBotOnline = loginStatus.status === 1;
    const atRegex = new RegExp(`<at (id="${session.bot.selfId}".*?|type="all".*?${isBotOnline ? '|type="here"' : ''}).*?/>`);
    const isAtMentioned = atRegex.test(session.content);
    const shouldReactToAt = Random.bool(config.MemorySlot.AtReactPossibility);

    if (isQueueFull || isMixedQueueFull || isAtMentioned && shouldReactToAt || config.Debug.TestMode) {
      const parsedMessage: string[]= [];
      // 处理用户消息
      for (let chatMessage of await sendQueue.getMixedQueue(channelId)) {
          // 12月3日星期二 17:34
          const timeString = chatMessage.sendTime.toLocaleString("zh-CN", {month: "long",day: "numeric",hour: "2-digit",minute: "2-digit"})
          let messagePrefix = `[${timeString} ${chatMessage.channelType === "guild" ? ("from_channel:" + chatMessage.channelId + " sender_id:" + chatMessage.senderId) : ("from_qq:" + chatMessage.senderId)}]`;
          let userName: string;
          switch (config.Bot.NickorName) {
            case "群昵称":
              userName = chatMessage.senderNick;
            case "用户昵称":
            default:
              userName = chatMessage.senderName;
          }
          messagePrefix += ` "${userName}"`;
          const userContent = [];
          const elements = h.parse(chatMessage.content);
          for (let elem of elements) {
            switch (elem.type){
              case "text":
                // const { content } = elem.attrs;
                userContent.push(elem.attrs.content);
                break;
              case "at":
                // const { id } = elem.attrs;
                userContent.push(`@${await getMemberName(config, session, elem.attrs.id, chatMessage.channelId)}`);
                break;
              case "quote":
                // const { id } = elem.attrs;
                userContent.unshift(`REPLYTO(${elem.attrs.id})`);
                break;
              case "img":
                // const { src, summary, fileUnique } = elem.attrs;
                userContent.push(await getImageDescription(elem.attrs.src, config, elem.attrs.summary));
                break;
              case "face":
                // const { id, name } = elem.attrs;
                userContent.push(`[表情:${elem.attrs.name}]`);
                break;
              case "mface":
                // const { url, summary } = elem.attrs;
                userContent.push(`[表情:${elem.attrs.summary}]`);
                break;
              default:
            }
          }
          // [messageId][{date} from_channel:{channelId} sender_id:{senderId}] "{senderName}" 说: {userContent}
          // [messageId][{date} from_qq:{senderId}] "{senderName}" 说: {userContent}
          // [messageId][{date} from_channel:{channelId} sender_id:{senderId}] "{senderName}" 回复({quoteMessageId}): {userContent}
          parsedMessage.push(`[${chatMessage.messageId}]${messagePrefix} ${chatMessage.quoteMessageId ? "回复(" + chatMessage.quoteMessageId + "):" : "说:"} ${userContent.join("")}\n`);
      }
      const chatHistory = parsedMessage.join("");
      const adapter = adapterSwitcher.getAdapter();


      
    }
  });
}

