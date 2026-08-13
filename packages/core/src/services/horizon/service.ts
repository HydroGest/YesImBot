import type { Context, Session } from "koishi";
import type { CommandService } from "../command";
import type { ModeResult } from "./chat-mode/types";
import type { Entity, EntityRecord, Environment, Percept, SelfInfo, TimelineEntry } from "./types";
import type { Config } from "@/config";
import { Service } from "koishi";
import { Services, TableName } from "@/shared/constants";
import { ChatModeManager, DefaultChatMode } from "./chat-mode";
import { EventManager } from "./event-manager";
import { EventListener } from "./listener";

declare module "koishi" {
    interface Context {
        [Services.Horizon]: HorizonService;
    }
    interface Events {
        "horizon/percept": (percept: Percept) => void;
    }
    interface Tables {
        [TableName.Entity]: EntityRecord;
        [TableName.Timeline]: TimelineEntry;
    }
}

export class HorizonService extends Service<Config> {
    static readonly inject = [
        Services.Asset,
        Services.Prompt,
        Services.Memory,
        Services.Command,
        "database",
    ];

    public readonly events: EventManager;
    private listener: EventListener;
    private modeManager: ChatModeManager;

    constructor(ctx: Context, config: Config) {
        super(ctx, Services.Horizon, true);
        this.config = config;

        this.events = new EventManager(ctx, config);
        this.listener = new EventListener(ctx, config, this);
        this.modeManager = new ChatModeManager(ctx);
    }

    protected async start(): Promise<void> {
        this.registerModels();

        this.listener.start();
        this.registerCommands();

        this.modeManager.register(new DefaultChatMode(this.ctx, this));

        this.ctx.logger.info("服务已启动");
    }

    protected stop(): void {
        this.listener.stop();
        this.ctx.logger.info("服务已停止");
    }

    public async build(percept: Percept): Promise<ModeResult> {
        const mode = await this.modeManager.resolve(percept);
        return mode;
    }

    public async getSelfInfo(scope: Scope): Promise<SelfInfo> {
        return {
            id: "agent-001",
            name: "智能体",
        };
    }

    /** 获取环境信息 */
    public async getEnvironment(scope: Scope): Promise<Environment | null> {
        return null;
    }

    /** 获取实体列表 */
    public async getEntities(options: { scope: Scope }): Promise<Entity[]> {
        return [];
    }

    /** 获取单个实体 */
    public async getEntity(options: { scope: Scope; entityId: string }): Promise<Entity | null> {
        return null;
    }

    /** 判断频道是否允许 */
    public isChannelAllowed(session: Session): boolean {
        const { platform, channelId, guildId, isDirect, userId } = session;
        return this.config.allowedChannels.some((c) => {
            return (
                c.platform === platform
                && (c.type === "private" ? isDirect : true)
                && (c.id === "*"
                    || c.id === channelId
                    || (guildId && c.id === guildId.trim())
                    || (c.type === "private" && c.id === userId.trim()))
            );
        });
    }

    private registerModels(): void {
        this.ctx.model.extend(
            TableName.Entity,
            {
                id: "string(32)",
                type: "string(32)",
                name: "string(255)",
                parentId: "string(255)",
                refId: "string(255)",
                attributes: "json",
            },
            {
                primary: ["id"],
            },
        );

        this.ctx.model.extend(
            TableName.Timeline,
            {
                id: "string(32)",
                scope: "object",
                type: "string(32)",
                priority: "unsigned",
                stage: "string(16)",
                timestamp: "timestamp",
                data: "json",
            },
            {
                primary: ["id"],
                autoInc: false,
            },
        );
    }

    private registerCommands(): void {
        const commandService = this.ctx.get(Services.Command) as CommandService;
        const historyCmd = commandService.subcommand(".history", "历史记录管理指令集", { authority: 3 });

        historyCmd
            .subcommand(".clear", "清除指定频道的历史记录", { authority: 3 })
            .option("all", "-a <type:string> 清理全部指定类型的频道 (private, guild, all)")
            .option("platform", "-p <platform:string> 指定平台")
            .option("channel", "-c <channel:string> 指定频道ID (多个用逗号分隔)")
            .option("target", "-t <target:string> 指定目标 'platform:channelId' (多个用逗号分隔)")
            .usage(`清除历史记录上下文\n从数据库中永久移除相关对话、消息和系统事件，此操作不可恢复`)
            .example(
                [
                    "",
                    "history.clear                      # 清除当前频道的历史记录",
                    "history.clear -c 12345678          # 清除频道 12345678 的历史记录",
                    "history.clear -a private           # 清除所有私聊频道的历史记录",
                ].join("\n"),
            )
            .action(async ({ session, options }) => {
                this.ctx.database.transact(async (db) => {
                    const result = await db.remove(TableName.Timeline, {
                        scope: {
                            platform: options.platform || session.platform,
                            channelId: options.channel
                                ? options.channel.split(",").map((id) => id.trim())
                                : session.channelId,
                        },
                    });
                    this.ctx.logger.info(`已清除 ${result.removed} 条历史记录`);
                });
            });

        // const scheduleCmd = commandService.subcommand(".schedule", "计划任务管理指令集", { authority: 3 });

        // scheduleCmd
        //     .subcommand(".add", "添加计划任务")
        //     .option("name", "-n <name:string> 任务名称")
        //     .option("interval", "-i <interval:string> 执行间隔的 Cron 表达式")
        //     .option("action", "-a <action:string> 任务执行的操作描述")
        //     .usage("添加一个定时执行的任务")
        //     .example("schedule.add -n \"Daily Summary\" -i \"0 9 * * *\" -a \"Generate daily summary report\"")
        //     .action(async ({ session, options }) => {
        //         // Implementation for adding a scheduled task
        //         return "计划任务添加功能尚未实现";
        //     });

        // scheduleCmd
        //     .subcommand(".delay", "添加延迟任务")
        //     .option("name", "-n <name:string> 任务名称")
        //     .option("delay", "-d <delay:number> 延迟时间，单位为秒")
        //     .option("action", "-a <action:string> 任务执行的操作描述")
        //     .option("platform", "-p <platform:string> 指定平台")
        //     .option("channel", "-c <channel:string> 指定频道ID")
        //     .option("global", "-g 指定为全局任务")
        //     .usage("添加一个延迟执行的任务")
        //     .example("schedule.delay -n \"Reminder\" -d 3600 -a \"Send reminder message\"")
        //     .action(async ({ session, options }) => {
        //         if (!options.delay || isNaN(options.delay) || options.delay <= 0) {
        //             return "错误：请提供有效的延迟时间（秒）";
        //         }

        //         let platform, channelId;

        //         if (!options.global) {
        //             platform = options.platform || session.platform;
        //             channelId = options.channel || session.channelId;

        //             if (!platform || !channelId) {
        //                 return "错误：请指定有效的频道，或使用 -g 标记创建全局任务";
        //             }
        //         }

        //         this.ctx.setTimeout(() => {
        //             const percept: ScheduledTaskPercept = {
        //                 type: PerceptSource.ScheduledTask,
        //                 priority: 1,
        //                 timestamp: new Date(),
        //                 payload: {
        //                     taskId: `delay-${Date.now()}`,
        //                     taskType: options.name || "delayed_task",
        //                     platform: options.global ? undefined : platform,
        //                     channelId: options.global ? undefined : channelId,
        //                     params: {},
        //                     message: options.action || "No action specified",
        //                 },
        //             };
        //             this.ctx.emit("agent/percept-scheduled-task", percept);
        //         }, options.delay * 1000);

        //         return `延迟任务 "${options.name}" 已设置，将在 ${options.delay} 秒后执行`;
        //     });

        // scheduleCmd
        //     .subcommand(".list", "列出所有计划任务")
        //     .usage("显示当前所有已设置的计划任务")
        //     .action(async ({ session, options }) => {
        //         // Implementation for listing scheduled tasks
        //         return "计划任务列表功能尚未实现";
        //     });

        // scheduleCmd
        //     .subcommand(".remove", "移除计划任务")
        //     .usage("移除指定名称的计划任务，例如: schedule.remove -n \"Daily Summary\"")
        //     .action(async ({ session, options }) => {
        //         // Implementation for removing a scheduled task
        //         return "计划任务移除功能尚未实现";
        //     });
    }
}

interface Scope {
    platform?: string;
    channelId?: string;
    guildId?: string;
    isDirect?: boolean;
    userId?: string;
    scopeId?: string;
}
