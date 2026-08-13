import type { Context, Session } from "koishi";
import type { HistoryConfig } from "./config";
import type { EventManager } from "./event-manager";
import type { HorizonService } from "./service";
import type { MemberEntity, UserMessagePercept } from "./types";
import type { AssetService } from "@/services/assets";
import { Random } from "koishi";
import { Services, TableName } from "@/shared/constants";
import { truncate } from "@/shared/utils";
import { PerceptType, TimelineStage } from "./types";

export class EventListener {
    private readonly disposers: (() => boolean)[] = [];

    private assetService: AssetService;
    private events: EventManager;

    constructor(
        private ctx: Context,
        private config: HistoryConfig,
        private service: HorizonService,
    ) {
        this.assetService = ctx[Services.Asset];
        this.events = service.events;
    }

    public start(): void {
        this.registerEventListeners();
    }

    public stop(): void {
        this.disposers.forEach((dispose) => dispose());
        this.disposers.length = 0;
    }

    private registerEventListeners(): void {
        // 这个中间件记录用户消息，并触发响应流程
        this.disposers.push(
            this.ctx.middleware(async (session, next) => {
                if (!this.service.isChannelAllowed(session))
                    return next();

                if (session.author?.isBot)
                    return next();

                await this.recordUserMessage(session);
                await next();

                const percept: UserMessagePercept = {
                    id: Random.id(),
                    type: PerceptType.UserMessage,
                    priority: 5,
                    scope: {
                        platform: session.platform,
                        channelId: session.channelId,
                        guildId: session.guildId,
                        isDirect: session.isDirect,
                    },
                    timestamp: new Date(),
                    payload: {
                        messageId: session.messageId,
                        content: session.content,
                        sender: {
                            id: session.userId,
                            name: session.author?.name || session.userId,
                        },
                        channel: {
                            id: session.channelId,
                            platform: session.platform,
                            guildId: session.guildId,
                        },
                    },
                    runtime: {
                        session,
                    },
                };
                this.ctx.emit("horizon/percept", percept);
            }),
        );

        // 在发送后记录机器人消息
        this.disposers.push(
            this.ctx.on(
                "after-send",
                (session) => {
                    if (!this.service.isChannelAllowed(session))
                        return;
                    this.recordBotSentMessage(session);
                },
                true,
            ),
        );

        // 记录从另一个设备手动发送的消息
        this.disposers.push(
            this.ctx.on("message", (session) => {
                if (!this.service.isChannelAllowed(session))
                    return;
                if (session.userId === session.bot.selfId && !session.scope) {
                    if (this.config.ignoreSelfMessage)
                        return;
                    this.handleOperatorMessage(session);
                }
            }),
        );

        // 监听系统事件，记录特定事件
        // this.disposers.push(
        //     this.ctx.on("internal/session", (session) => {
        //         if (!this.service.isChannelAllowed(session))
        //             return;
        //         if (session.type === "notice" && session.platform === "onebot")
        //             return this.handleNotice(session);
        //         if (session.type === "guild-member" && session.platform === "onebot")
        //             return this.handleGuildMember(session);
        //         if (session.type === "message-deleted")
        //             return this.handleMessageDeleted(session);
        //     }),
        // );
    }

    private async handleOperatorMessage(session: Session): Promise<void> {
        this.ctx.logger.debug(`记录手动发送的消息 | 频道: ${session.cid}`);
        await this.recordBotSentMessage(session);
    }

    private async recordUserMessage(session: Session): Promise<void> {
        /* prettier-ignore */
        this.ctx.logger.info(`用户消息 | ${session.author.name} | 频道: ${session.cid} | 内容: ${truncate(session.content).replace(/\n/g, " ")}`);

        if (session.guildId) {
            await this.updateMemberInfo(session);
        }

        const content = await this.assetService.transform(session.content);
        this.ctx.logger.debug(`记录转义后的消息：${content}`);

        await this.events.recordMessage({
            id: Random.id(),
            scope: {
                platform: session.platform,
                channelId: session.channelId,
                guildId: session.guildId,
                isDirect: session.isDirect,
            },
            stage: TimelineStage.New,
            timestamp: new Date(session.timestamp),
            data: {
                messageId: session.messageId,
                senderId: session.author.id,
                senderName: session.author.nick || session.author.name,
                content: session.content,
            },
        });
    }

    private async recordBotSentMessage(session: Session): Promise<void> {
        if (!session.content || !session.messageId)
            return;

        this.ctx.logger.debug(`记录机器人消息 | 频道: ${session.cid} | 消息ID: ${session.messageId}`);

        await this.events.recordMessage({
            id: Random.id(),
            scope: {
                platform: session.platform,
                channelId: session.channelId,
                guildId: session.guildId,
                isDirect: session.isDirect,
            },
            stage: TimelineStage.Active,
            timestamp: new Date(session.timestamp),
            data: {
                messageId: session.messageId,
                senderId: session.bot.selfId,
                senderName: session.bot.user.nick || session.bot.user.nick,
                content: session.content,
            },
        });
    }

    // TODO: 从平台适配器拉取用户信息
    private async updateMemberInfo(session: Session): Promise<void> {
        if (!session.guildId || !session.author)
            return;

        try {
            const memberKey: Partial<MemberEntity> = {
                type: "member",
                id: `${session.platform}:${session.author.id}@guild:${session.guildId}`,
            };
            const memberData: Partial<MemberEntity> = {
                name: session.author.nick || session.author.name,
                attributes: {
                    roles: (session.author.roles ?? []).map(role => role.id || role.name || String(role)),
                    platform: session.platform,
                    avatar: session.author.avatar,
                },
            };

            const existing = await this.ctx.database.get(TableName.Entity, memberKey);
            if (existing.length > 0) {
                await this.ctx.database.set(TableName.Entity, memberKey, memberData);
            } else {
                await this.ctx.database.create(TableName.Entity, { ...memberKey, ...memberData });
            }
        } catch (error: any) {
            this.ctx.logger.error(`更新成员信息失败: ${error.message}`);
        }
    }
}
