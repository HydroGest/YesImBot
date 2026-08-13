import type { Context, Session } from "koishi";
import type { ForwardMessage } from "koishi-plugin-adapter-onebot/lib/types";
import type { FunctionContext } from "@/services/plugin/types";
import { h, Schema } from "koishi";
import {} from "koishi-plugin-adapter-onebot";
import { requirePlatform, requireSession } from "@/services/plugin/activators";
import { Plugin } from "@/services/plugin/base-plugin";
import { Action, Metadata, Tool, withInnerThoughts } from "@/services/plugin/decorators";
import { Failed, Success } from "@/services/plugin/utils";
import { Services } from "@/shared/constants";
import { formatDate, isEmpty } from "@/shared/utils";

interface InteractionsConfig {}

// eslint-disable-next-line ts/no-redeclare
const InteractionsConfig: Schema<InteractionsConfig> = Schema.object({});

@Metadata({
    name: "interactions",
    display: "群内交互",
    description: "允许大模型在群内进行交互",
    builtin: true,
})
export default class InteractionsPlugin extends Plugin<InteractionsConfig> {
    static inject = [Services.Plugin];
    static readonly Config = InteractionsConfig;

    constructor(ctx: Context, config: InteractionsConfig) {
        super(ctx, config);
    }

    @Action({
        name: "reaction_create",
        description: `在当前频道对一个或多个消息进行表态。表态编号是数字，这里是一个简略的参考：惊讶(0)，不适(1)，无语(27)，震惊(110)，滑稽(178), 点赞(76)`,
        parameters: withInnerThoughts({
            message_id: Schema.string().required().description("消息 ID"),
            emoji_id: Schema.number().required().description("表态编号"),
        }),
        activators: [requirePlatform("onebot", "OneBot platform required"), requireSession("Active session required")],
    })
    async reactionCreate(params: { message_id: string; emoji_id: number }, context: FunctionContext) {
        const { message_id, emoji_id } = params;

        const session = context.session;
        const bot = session.bot;
        const selfId = bot.selfId;

        try {
            const result = await session.onebot._request("set_msg_emoji_like", {
                message_id,
                emoji_id,
            });

            if (result.status === "failed")
                return Failed((result as any).message);
            this.ctx.logger.info(`Bot[${selfId}]对消息 ${message_id} 进行了表态： ${emoji_id}`);
            return Success(result);
        } catch (error: any) {
            this.ctx.logger.error(`Bot[${selfId}]执行表态失败: ${message_id}, ${emoji_id} - `, error.message);
            return Failed(`对消息 ${message_id} 进行表态失败： ${error.message}`);
        }
    }

    @Action({
        name: "essence_create",
        description: `在当前频道将一个消息设置为精华消息。常在你认为某个消息十分重要或过于典型时使用。`,
        parameters: withInnerThoughts({
            message_id: Schema.string().required().description("消息 ID"),
        }),
        activators: [requirePlatform("onebot", "OneBot platform required"), requireSession("Active session required")],
    })
    async essenceCreate(params: { message_id: string }, context: FunctionContext) {
        const { message_id } = params;

        const session = context.session;
        const bot = session.bot;
        const selfId = bot.selfId;

        try {
            await session.onebot.setEssenceMsg(message_id);
            this.ctx.logger.info(`Bot[${selfId}]将消息 ${message_id} 设置为精华`);
            return Success();
        } catch (error: any) {
            this.ctx.logger.error(`Bot[${selfId}]设置精华消息失败: ${message_id} - `, error.message);
            return Failed(`设置精华消息失败： ${error.message}`);
        }
    }

    @Action({
        name: "essence_delete",
        description: `在当前频道将一个消息从精华中移除。`,
        parameters: withInnerThoughts({
            message_id: Schema.string().required().description("消息 ID"),
        }),
        activators: [requirePlatform("onebot", "OneBot platform required"), requireSession("Active session required")],
    })
    async essenceDelete(params: { message_id: string }, context: FunctionContext) {
        const { message_id } = params;

        const session = context.session;
        const bot = session.bot;
        const selfId = bot.selfId;

        try {
            await session.onebot.deleteEssenceMsg(message_id);
            this.ctx.logger.info(`Bot[${selfId}]将消息 ${message_id} 从精华中移除`);
            return Success();
        } catch (error: any) {
            this.ctx.logger.error(`Bot[${selfId}]从精华中移除消息失败: ${message_id} - `, error.message);
            return Failed(`从精华中移除消息失败： ${error.message}`);
        }
    }

    @Action({
        name: "send_poke",
        description: `发送戳一戳、拍一拍消息，常用于指定你交流的对象，或提醒某位用户注意。`,
        parameters: withInnerThoughts({
            user_id: Schema.string().required().description("用户名称"),
            channel: Schema.string().description("要在哪个频道运行，不填默认为当前频道"),
        }),
        activators: [requirePlatform("onebot", "OneBot platform required"), requireSession("Active session required")],
    })
    async sendPoke(params: { user_id: string; channel: string }, context: FunctionContext) {
        const { user_id, channel } = params;

        const session = context.session;
        const bot = session.bot;
        const selfId = bot.selfId;
        const targetChannel = isEmpty(channel) ? session.channelId : channel;

        try {
            const result = await session.onebot._request("group_poke", {
                group_id: targetChannel,
                user_id: Number(user_id),
            });

            if (result.status === "failed")
                return Failed(result.data);

            this.ctx.logger.info(`Bot[${selfId}]戳了戳 ${user_id}`);
            return Success(result);
        } catch (error: any) {
            this.ctx.logger.error(`Bot[${selfId}]戳了戳 ${user_id}，但是失败了 - `, error.message);
            return Failed(`戳了戳 ${user_id} 失败： ${error.message}`);
        }
    }

    @Tool({
        name: "get_forward_msg",
        description: `获取合并转发消息的内容，用于查看转发消息的详细信息，如结果仍包含一层，请自己决定是否继续获取。`,
        parameters: withInnerThoughts({
            id: Schema.string().required().description("合并转发 ID，如在 `<forward id='12345'>` 中的 12345 即是其 ID"),
        }),
        activators: [requirePlatform("onebot", "OneBot platform required"), requireSession("Active session required")],
    })
    async getForwardMsg(params: { id: string }, context: FunctionContext) {
        const { id } = params;
        const session = context.session;
        const { onebot, selfId } = session;

        try {
            const forwardMessages: ForwardMessage[] = await onebot.getForwardMsg(id);
            const formattedResult = await formatForwardMessage(this.ctx, session, forwardMessages);

            return Success(formattedResult);
        } catch (error: any) {
            this.ctx.logger.error(`Bot[${selfId}]获取转发消息失败: ${id} - `, error.message);
            return Failed(`获取转发消息失败： ${error.message}`);
        }
    }
}

async function formatForwardMessage(ctx: Context, session: Session, formatForwardMessages: ForwardMessage[]): Promise<string> {
    try {
        const formattedMessages = await Promise.all(
            formatForwardMessages.map(async (message) => {
                const { time, sender, content } = message;

                const contentParts = await Promise.all(
                    h.parse(content).map(async (element) => {
                        switch (element.type) {
                            case "text":
                                return element.attrs.content;

                            case "image":
                                return await ctx["yesimbot.image"].processImageElement(element, session);

                            case "at":
                                return `@${element.attrs.id}`;

                            case "forward":
                                return `<forward id="${element.attrs.id}"/>`;

                            default:
                                return element;
                        }
                    }),
                );

                /* prettier-ignore */
                return `[${formatDate(new Date(time), "YYYY-MM-DD HH:mm:ss")}|${sender.nickname}(${sender.user_id})]: ${contentParts.join(" ")}`;
            }),
        );

        return formattedMessages.filter(Boolean).join("\n") || "无有效消息内容";
    } catch (error: any) {
        ctx.logger.error("格式化转发消息失败:", error);
        return "消息格式化失败";
    }
}
