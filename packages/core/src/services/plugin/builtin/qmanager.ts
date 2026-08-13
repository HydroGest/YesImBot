import type { Context } from "koishi";
import type { FunctionContext } from "@/services/plugin/types";
import { Schema } from "koishi";
import { requireSession } from "@/services/plugin/activators";
import { Plugin } from "@/services/plugin/base-plugin";
import { Action, Metadata, withInnerThoughts } from "@/services/plugin/decorators";
import { Failed, Success } from "@/services/plugin/utils";
import { isEmpty } from "@/shared/utils";

interface QManagerConfig {}

@Metadata({
    name: "qmanager",
    display: "频道管理",
    description: "管理频道内用户和消息",
    builtin: true,
})
export default class QManagerPlugin extends Plugin<QManagerConfig> {
    static readonly Config = Schema.object({});

    constructor(ctx: Context, config: QManagerConfig) {
        super(ctx, config);
    }

    @Action({
        name: "delmsg",
        description: `撤回一条消息。撤回用户/你自己的消息。当你认为别人刷屏或发表不当内容时，运行这条指令。`,
        parameters: withInnerThoughts({
            message_id: Schema.string().required().description("要撤回的消息编号"),
            channel_id: Schema.string().description("要在哪个频道运行，不填默认为当前频道"),
        }),
        activators: [requireSession("Active session required")],
    })
    async delmsg({ message_id, channel_id }: { message_id: string; channel_id?: string }, context: FunctionContext) {
        const session = context.session;
        if (isEmpty(message_id))
            return Failed("message_id is required");
        const targetChannel = isEmpty(channel_id) ? session.channelId : channel_id;
        try {
            await session.bot.deleteMessage(targetChannel, message_id);
            this.ctx.logger.info(`Bot[${session.selfId}]撤回了消息: ${message_id}`);
            return Success();
        } catch (error: any) {
            this.ctx.logger.error(`Bot[${session.selfId}]撤回消息失败: ${message_id} - `, error.message);
            return Failed(`撤回消息失败 - ${error.message}`);
        }
    }

    @Action({
        name: "ban",
        description: `禁言用户。`,
        parameters: withInnerThoughts({
            user_id: Schema.string().required().description("要禁言的用户 ID"),
            duration: Schema.number()
                .required()
                .description("禁言时长，单位为分钟。你不应该禁言他人超过 10 分钟。时长设为 0 表示解除禁言。"),
            channel_id: Schema.string().description("要在哪个频道运行，不填默认为当前频道"),
        }),
        activators: [requireSession("Active session required")],
    })
    async ban(
        { user_id, duration, channel_id }: { user_id: string; duration: number; channel_id?: string },
        context: FunctionContext,
    ) {
        const session = context.session;
        if (isEmpty(user_id))
            return Failed("user_id is required");
        const targetChannel = isEmpty(channel_id) ? session.channelId : channel_id;
        try {
            await session.bot.muteGuildMember(targetChannel, user_id, Number(duration) * 60 * 1000);
            this.ctx.logger.info(`Bot[${session.selfId}]在频道 ${targetChannel} 禁言用户: ${user_id}`);
            return Success();
        } catch (error: any) {
            this.ctx.logger.error(
                `Bot[${session.selfId}]在频道 ${targetChannel} 禁言用户: ${user_id} 失败 - `,
                error.message,
            );
            return Failed(`禁言用户 ${user_id} 失败 - ${error.message}`);
        }
    }

    @Action({
        name: "kick",
        description: `踢出用户。`,
        parameters: withInnerThoughts({
            user_id: Schema.string().required().description("要踢出的用户 ID"),
            channel_id: Schema.string().description("要在哪个频道运行，不填默认为当前频道"),
        }),
        activators: [requireSession("Active session required")],
    })
    async kick({ user_id, channel_id }: { user_id: string; channel_id?: string }, context: FunctionContext) {
        const session = context.session;
        if (isEmpty(user_id))
            return Failed("user_id is required");
        const targetChannel = isEmpty(channel_id) ? session.channelId : channel_id;
        try {
            await session.bot.kickGuildMember(targetChannel, user_id);
            this.ctx.logger.info(`Bot[${session.selfId}]在频道 ${targetChannel} 踢出了用户: ${user_id}`);
            return Success();
        } catch (error: any) {
            this.ctx.logger.error(
                `Bot[${session.selfId}]在频道 ${targetChannel} 踢出用户: ${user_id} 失败 - `,
                error.message,
            );
            return Failed(`踢出用户 ${user_id} 失败 - ${error.message}`);
        }
    }
}
