import type { Context, Query } from "koishi";
import type { HistoryConfig } from "./config";
import type { MessageRecord, Observation, Scope, TimelineEntry } from "./types";
import { TableName } from "@/shared/constants";
import { TimelineEventType, TimelinePriority, TimelineStage } from "./types";

interface EventQueryOptions {
    scope: Query.Expr<Scope>;
    types?: TimelineEventType[];
    limit?: number;
    since?: Date;
    until?: Date;
    orderBy?: "asc" | "desc";
}

export class EventManager {
    constructor(
        private ctx: Context,
        private config: HistoryConfig,
    ) {}

    // -------- 写入 --------
    public async record(entry: TimelineEntry): Promise<TimelineEntry> {
        return this.ctx.database.create(TableName.Timeline, entry) as Promise<TimelineEntry>;
    }

    // -------- 查询 --------
    public async query(options: EventQueryOptions): Promise<TimelineEntry[]> {
        const query: Query.Expr<TimelineEntry> = {};

        if (options.scope) {
            query.scope = options.scope;
        }

        if (options.types && options.types.length > 0) {
            // @ts-expect-error typing check
            query.type = { $in: options.types };
        }

        if (options.since) {
            query.timestamp = { ...query.timestamp, $gte: options.since };
        }

        if (options.until) {
            query.timestamp = { ...query.timestamp, $lte: options.until };
        }

        let dbQuery = this.ctx.database.select(TableName.Timeline).where(query);

        if (options.orderBy) {
            dbQuery = dbQuery.orderBy("timestamp", options.orderBy);
        }

        if (options.limit) {
            dbQuery = dbQuery.limit(options.limit);
        }

        return dbQuery.execute() as Promise<TimelineEntry[]>;
    }

    // -------- 视图转换 --------
    public toObservations(entries: TimelineEntry[]): Observation[] {
        const observations: Observation[] = [];
        for (const entry of entries) {
            switch (entry.type) {
                case TimelineEventType.Message:
                    observations.push({
                        type: "message",
                        stage: entry.stage,
                        isMessage: true,
                        timestamp: entry.timestamp,
                        messageId: entry.data.messageId,
                        sender: {
                            type: "user",
                            id: entry.data.senderId,
                            name: entry.data.senderName,
                        },
                        content: entry.data.content,
                    });
                    break;
                case TimelineEventType.MemberJoin:
                case TimelineEventType.MemberLeave:
                case TimelineEventType.StateUpdate:
                case TimelineEventType.Reaction:
                    observations.push({
                        type: `notice.${entry.type.toLowerCase()}` as Observation["type"],
                        stage: entry.stage,
                        isNotice: true,
                        timestamp: entry.timestamp,
                    } as Observation);
                    break;
            }
        }
        return observations;
    }

    public async markAsActive(scope: Scope, before?: Date): Promise<void> {
        const query: Query<TimelineEntry> = {
            scope,
            stage: TimelineStage.New,
            timestamp: before ? { $lte: before } : undefined,
        };
        await this.ctx.database.set(TableName.Timeline, query, { stage: TimelineStage.Active });
    }

    public async recordMessage(message: Omit<MessageRecord, "type" | "priority">): Promise<MessageRecord> {
        const fullMessage: MessageRecord = {
            ...message,
            type: TimelineEventType.Message,
            priority: TimelinePriority.Normal,
        };
        const result = await this.ctx.database.create(TableName.Timeline, fullMessage);
        this.ctx.logger.debug(`${message.scope} ${message.data.senderId}: ${message.data.content}`);
        return result as MessageRecord;
    }

    public async clearWorkingMemory(scope: Scope) {
        const { AgentAction, AgentThought, AgentTool, ToolResult } = TimelineEventType;
        const query: Query<TimelineEntry> = {
            type: { $in: [AgentAction, AgentThought, AgentTool, ToolResult] },
            scope,
            stage: { $in: [TimelineStage.New, TimelineStage.Active] },
        } as unknown as Query<TimelineEntry>;
        await this.ctx.database.set(TableName.Timeline, query, { stage: TimelineStage.Archived });
    }
}
