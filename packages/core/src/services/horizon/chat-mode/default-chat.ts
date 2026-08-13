import type { Context } from "koishi";
import type { ModeResult } from "./types";
import type { HorizonService } from "@/services/horizon/service";
import type { AgentRecord, Percept, SelfInfo, UserMessagePercept } from "@/services/horizon/types";
import { message } from "xsai";
import { PerceptType, TimelineEventType, TimelineStage } from "@/services/horizon/types";
import { loadPartial, loadTemplate } from "@/services/prompt";
import { Services } from "@/shared";
import { formatDate } from "@/shared/utils";
import { BaseChatMode } from "./base";

export class DefaultChatMode extends BaseChatMode {
    name = "default-chat";
    priority = 100; // 最低优先级，兜底

    constructor(
        ctx: Context,
        private horizon: HorizonService,
    ) {
        super(ctx);
        this.registerTemplates();
    }

    registerTemplates(): void {
        const promptService = this.ctx[Services.Prompt];

        // 注册主模板
        promptService.registerTemplate("agent.system.chat", loadTemplate("agent.system.chat"));
        promptService.registerTemplate("agent.user.events", loadTemplate("agent.user.events"));

        // 注册 partials
        promptService.registerTemplate("identity", loadPartial("identity"));
        promptService.registerTemplate("environment", loadPartial("environment"));
        promptService.registerTemplate("working_memory", loadPartial("working_memory"));
        promptService.registerTemplate("memories", loadPartial("memories"));
        promptService.registerTemplate("tools", loadPartial("tools"));
        promptService.registerTemplate("output", loadPartial("output"));
    }

    match(percept: Percept): boolean {
        return percept.type === PerceptType.UserMessage;
    }

    async buildContext(percept: UserMessagePercept): Promise<ModeResult> {
        const { scope } = percept;

        // 查询历史消息
        const entries = await this.horizon.events.query({
            scope: {
                platform: scope.platform,
                channelId: scope.channelId,
                isDirect: scope.isDirect,
            },
            types: [TimelineEventType.Message],
            limit: 30, // 30条消息窗口
            orderBy: "desc",
        });

        // 转换为 Observation 格式
        const observations = this.horizon.events.toObservations(entries.reverse());

        const working = (await this.horizon.events.query({
            scope: {
                platform: scope.platform,
                channelId: scope.channelId,
                isDirect: scope.isDirect,
            },
            types: [
                TimelineEventType.AgentAction,
                TimelineEventType.AgentThought,
                TimelineEventType.AgentTool,
                TimelineEventType.ToolResult,
            ],
            limit: 10, // 最近10条工作记忆
            orderBy: "desc",
        })) as AgentRecord[];

        const workingMemory = working.reverse().map((record) => {
            switch (record.type) {
                case TimelineEventType.AgentAction:
                    return {
                        isAction: true,
                        name: record.data.name,
                        args: record.data.args,
                        message: JSON.stringify({
                            name: record.data.name,
                            args: record.data.args,
                        }),
                    };
                case TimelineEventType.AgentThought:
                    return {
                        isThought: true,
                        content: record.data.content,
                        message: record.data.content,
                    };
                case TimelineEventType.AgentTool:
                    return {
                        isTool: true,
                        name: record.data.name,
                        args: record.data.args,
                        message: JSON.stringify({
                            name: record.data.name,
                            args: record.data.args,
                        }),
                    };
                case TimelineEventType.ToolResult:
                    return {
                        isToolResult: true,
                        toolCallId: record.data.toolCallId,
                        status: record.data.status,
                        result: record.data.result,
                        error: record.data.error,
                        message: JSON.stringify({
                            status: record.data.status,
                            result: record.data.result,
                            error: record.data.error,
                        }),
                    };
                default:
                    return {
                        isUnknown: true,
                        message: "未知事件类型",
                    };
            }
        });

        // 获取自身信息
        const selfInfo: SelfInfo = {
            id: percept.runtime.session.selfId,
            name: percept.runtime.session.bot.user.name,
        };

        // 构建事件列表，标记自己的消息
        const events = observations.map((obs) => {
            const event: any = { ...obs };
            if (obs.type === "message") {
                const isSelf = obs.sender.id === selfInfo.id;
                if (isSelf) {
                    event.isSelfMessage = true;
                } else {
                    event.isUserMessage = true;
                }
            } else {
                event.isSystemEvent = true;
            }
            switch (obs.stage) {
                case TimelineStage.New:
                    event.isNew = true;
                    break;
                case TimelineStage.Active:
                    event.isActive = true;
                    break;
                case TimelineStage.Archived:
                    event.isArchived = true;
                    break;
                case TimelineStage.Deleted:
                    event.isDeleted = true;
                    break;
                default:
                    event.isArchived = true;
                    break;
            }
            return event;
        });

        // 获取环境信息
        const environment = await this.horizon.getEnvironment(scope);

        // 构建频道信息
        const channel = {
            id: percept.payload.channel.id,
            platform: percept.payload.channel.platform,
            type: percept.payload.channel.guildId ? "group" : "private",
            name: environment?.name || percept.payload.channel.id,
            _isGroup: !!percept.payload.channel.guildId,
            _isPrivate: !percept.payload.channel.guildId,
        };

        // 构建参与者列表
        const entities = await this.horizon.getEntities({ scope });
        const participants = entities.map((entity) => ({
            id: entity.id,
            name: entity.name,
            relationship: entity.attributes?.relationship,
            recentImpression: entity.attributes?.recentImpression,
        }));

        // 构建触发事件
        const trigger = {
            isUserMessage: true,
            isSystemEvent: false,
            timestamp: percept.timestamp,
            sender: percept.payload.sender,
            content: percept.payload.content,
        };

        return {
            view: {
                mode: "default-chat",
                percept,
                self: selfInfo,
                environment,
                entities,
                history: observations,

                // 模板渲染用的结构化数据
                bot: {
                    id: selfInfo.id,
                    name: selfInfo.name,
                    platform: channel.platform,
                },
                channel,
                participants,
                events,
                trigger,
                workingMemory,

                // 功能开关
                enableThoughts: false, // MVP 阶段关闭 thoughts
            },
            templates: {
                system: "agent.system.chat",
                user: "agent.user.events",
            },
            partials: ["identity", "environment", "working_memory", "memories", "tools", "output"],
        };
    }
}
