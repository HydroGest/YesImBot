import type { Context, Session } from "koishi";
import type { Config } from "@/config";

import type { HorizonService, Percept, UserMessagePercept } from "@/services/horizon";
import type { ModelService } from "@/services/model";
import type { PromptService } from "@/services/prompt";
import { Service } from "koishi";
import { ChatModelSwitcher } from "@/services/model";
import { Services } from "@/shared/constants";
import { HeartbeatProcessor } from "./heartbeat-processor";
import { WillingnessManager } from "./willing";

type WithDispose<T> = T & { dispose: () => void };

declare module "koishi" {
    interface Events {
        "after-send": (session: Session) => void;
    }
}

export class AgentCore extends Service<Config> {
    static readonly inject = [Services.Asset, Services.Memory, Services.Model, Services.Prompt, Services.Plugin, Services.Horizon];

    // 依赖的服务
    private readonly horizon: HorizonService;
    private readonly model: ModelService;
    private readonly prompt: PromptService;

    // 核心组件
    private willing: WillingnessManager;
    private processor: HeartbeatProcessor;

    private modelSwitcher: ChatModelSwitcher;

    private readonly runningTasks = new Set<string>();
    private readonly debouncedReplyTasks = new Map<string, WithDispose<(percept: Percept) => void>>();
    private readonly deferredTimers = new Map<string, NodeJS.Timeout>();
    private readonly queuedMessages = new Map<string, UserMessagePercept[]>();

    constructor(ctx: Context, config: Config) {
        super(ctx, Services.Agent, true);
        this.config = config;

        this.horizon = this.ctx[Services.Horizon];
        this.model = this.ctx[Services.Model];
        this.prompt = this.ctx[Services.Prompt];

        const groupName = this.config.chatModelGroup || this.config.groups?.[0]?.name;
        const group = this.config.groups?.find((g) => g.name === groupName);
        if (!group)
            throw new Error(`无法找到聊天模型组: ${groupName}`);

        const models = this.model.resolveChatModels(group.name);

        this.modelSwitcher = new ChatModelSwitcher(this.logger, this.model, { name: group.name, models }, this.config.switchConfig);
        this.willing = new WillingnessManager(ctx, config);
        this.processor = new HeartbeatProcessor(ctx, config, this.modelSwitcher);
    }

    protected async start(): Promise<void> {
        this.ctx.on("horizon/percept", (percept) => {
            this.dispatch(percept);
        });

        this.willing.startDecayCycle();
    }

    protected stop(): void {
        this.debouncedReplyTasks.forEach((task) => task.dispose());
        this.deferredTimers.forEach((timer) => clearTimeout(timer));
        this.queuedMessages.clear();
        this.willing.stopDecayCycle();
    }

    /**
     * 感知分发器
     * 根据感知类型分发到不同的处理逻辑
     */
    private dispatch(percept: Percept): void {
        switch (percept.type) {
            case "user.message": // PerceptType.UserMessage
                this.handleUserMessage(percept);
                break;
            // case PerceptType.SystemSignal:
            //     this.handleSystemSignal(percept);
            //     break;
            default:
                this.logger.warn(`未知的感知类型: ${(percept as any).type}`);
        }
    }

    private handleUserMessage(percept: UserMessagePercept): void {
        const { channel, sender } = percept.payload;
        const channelKey = `${channel.platform}:${channel.id}`;

        // 1. 意愿检测 (Willingness)
        let decision = false;
        try {
            // 注意：这里我们需要传递 session 给 willing 模块，因为它可能依赖 session 的某些属性
            // 如果 willing 模块未来解耦，这里也可以只传 payload
            if (!percept.runtime?.session) {
                this.logger.warn(`[${channelKey}] 缺少运行时 Session，跳过意愿检测`);
                return;
            }

            const willingnessBefore = this.willing.getCurrentWillingness(channelKey);
            const result = this.willing.shouldReply(percept.runtime.session);
            const willingnessAfter = this.willing.getCurrentWillingness(channelKey);

            decision = result.decision;
            /* prettier-ignore */
            this.logger.debug(`[${channelKey}] 意愿计算: ${willingnessBefore.toFixed(2)} -> ${willingnessAfter.toFixed(2)} | 回复概率: ${(result.probability * 100).toFixed(1)}% | 初步决策: ${decision}`);
        } catch (error: any) {
            this.logger.error(`计算意愿值失败，已阻止本次响应: ${error.message}`);
            return;
        }

        if (!decision) {
            return;
        }

        // 2. 调度任务
        this.schedule(percept);
    }

    public schedule(percept: Percept): void {
        const { type } = percept;

        switch (type) {
            case "user.message": { // PerceptType.UserMessage
                const { channel } = percept.payload;
                const channelKey = `${channel.platform}:${channel.id}`;

                if (this.runningTasks.has(channelKey)) {
                    if (this.isForcedPercept(percept)) {
                        const queue = this.queuedMessages.get(channelKey) ?? [];
                        queue.push(percept);
                        this.queuedMessages.set(channelKey, queue);
                        this.logger.info(`[${channelKey}] 频道忙，@/私聊消息已排队，等待当前任务结束`);
                    }
                    else {
                        this.logger.info(`[${channelKey}] 频道当前有任务在运行，跳过本次响应`);
                    }
                    return;
                }

                const schedulingStack = new Error("Scheduling context stack").stack;

                // 将堆栈传递给任务
                this.getDebouncedTask(channelKey, schedulingStack)(percept);
                break;
            }
        }
    }

    private getDebouncedTask(channelKey: string, _schedulingStack?: string): WithDispose<(percept: UserMessagePercept) => void> {
        let debouncedTask = this.debouncedReplyTasks.get(channelKey);
        if (!debouncedTask) {
            debouncedTask = this.ctx.debounce(async (percept: UserMessagePercept) => {
                this.runningTasks.add(channelKey);
                this.logger.debug(`[${channelKey}] 锁定频道并开始执行任务`);
                try {
                    const { channel } = percept.payload;
                    const chatKey = `${channel.platform}:${channel.id}`;
                    this.willing.handlePreReply(chatKey);
                    const success = await this.processor.runCycle(percept);
                    if (success && percept.runtime?.session) {
                        const willingnessBeforeReply = this.willing.getCurrentWillingness(chatKey);
                        this.willing.handlePostReply(percept.runtime.session, chatKey);
                        const willingnessAfterReply = this.willing.getCurrentWillingness(chatKey);
                        /* prettier-ignore */
                        this.logger.debug(`[${chatKey}] 回复成功，意愿值已更新: ${willingnessBeforeReply.toFixed(2)} -> ${willingnessAfterReply.toFixed(2)}`);
                    }
                } catch (error: any) {
                    this.logger.error(`调度任务执行失败 (Channel: ${channelKey}): ${error.message}`);
                } finally {
                    this.runningTasks.delete(channelKey);
                    this.logger.debug(`[${channelKey}] 频道锁已释放`);

                    const queue = this.queuedMessages.get(channelKey);
                    const next = queue?.shift();
                    if (next) {
                        if (queue.length === 0)
                            this.queuedMessages.delete(channelKey);
                        this.logger.debug(`[${channelKey}] 开始处理排队消息`);
                        this.schedule(next);
                    }
                    else if (queue) {
                        this.queuedMessages.delete(channelKey);
                    }
                }
            }, this.config.debounceMs);
            this.debouncedReplyTasks.set(channelKey, debouncedTask);
        }
        return debouncedTask;
    }

    private isForcedPercept(percept: UserMessagePercept): boolean {
        const session = percept.runtime?.session;
        return session ? this.willing.isForcedReply(session) : false;
    }
}
