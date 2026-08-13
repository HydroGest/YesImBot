import type { Session } from "koishi";

// region data models

/**
 * 事件类型枚举
 */
export enum TimelineEventType {
    // 普通消息/指令
    Message = "message", // 普通消息
    Command = "command", // 指令调用

    // 通知/状态变更
    MemberJoin = "notice.member.join",
    MemberLeave = "notice.member.leave",
    StateUpdate = "notice.state.update",
    Reaction = "notice.reaction",

    // 智能体执行活动
    AgentThought = "agent.thought",
    AgentTool = "agent.tool",
    AgentAction = "agent.action",
    ToolResult = "tool.result",
}

/**
 * 优先级：用于上下文截断时的保留权重
 */
export enum TimelinePriority {
    /**
     * 0: 噪音 (可丢弃)
     */
    Noise = 0,
    /**
     * 1: 普通 (标准历史)
     */
    Normal = 1,
    /**
     * 2: 重要 (关键事实)
     */
    Important = 2,
    /**
     * 3: 核心 (永久记忆/系统指令)
     */
    Core = 3,
}

export enum TimelineStage {
    New = "new",
    Active = "active",
    Archived = "archived",
    Deleted = "deleted",
}

/**
 * 事件线表基类
 */
export interface BaseTimelineEntry<Type extends TimelineEventType, Data extends Record<string, any>> {
    id: string;
    timestamp: Date;
    scope: Scope;
    type: Type;
    priority: TimelinePriority;
    stage: TimelineStage;

    // 直接嵌入事件数据 (JSON)
    data: Data;
}

// 消息事件
export interface MessageEventData {
    messageId: string;
    senderId: string;
    senderName: string;
    content: string;
    replyTo?: string;
}

export type MessageRecord = BaseTimelineEntry<TimelineEventType.Message, MessageEventData>;

// 通知/状态事件
export interface NoticeEventData {
    subType: string; // 具体通知类型
    targetId?: string; // 被操作的目标 (如被踢出的成员)
    operatorId?: string; // 操作者 (如管理员)
    details: Record<string, any>; // 变更详情 (如 { oldName: "A", newName: "B" })
    displayText: string; // 用于构建 Prompt 的自然语言描述
}

export type NoticeRecord = BaseTimelineEntry<
    TimelineEventType.MemberJoin | TimelineEventType.MemberLeave | TimelineEventType.StateUpdate | TimelineEventType.Reaction,
    NoticeEventData
>;

// region agent activity types

export interface AgentThoughtData {
    content: string;
}

export type AgentThoughtRecord = BaseTimelineEntry<TimelineEventType.AgentThought, AgentThoughtData>;

export interface AgentToolData {
    name: string;
    args: Record<string, any>;
}

export type AgentToolRecord = BaseTimelineEntry<TimelineEventType.AgentTool, AgentToolData>;

export interface AgentActionData {
    name: string;
    args: Record<string, any>;
}

export type AgentActionRecord = BaseTimelineEntry<TimelineEventType.AgentAction, AgentActionData>;

export interface ToolResultData {
    toolCallId?: string;
    status: string;
    result: Record<string, any> | string | string[];
    error?: string;
}

export type ToolResultRecord = BaseTimelineEntry<TimelineEventType.ToolResult, ToolResultData>;

export type AgentRecord = AgentThoughtRecord | AgentToolRecord | AgentActionRecord | ToolResultRecord;

// endregion

// 聚合类型
export type TimelineEntry = MessageRecord | NoticeRecord | AgentRecord;

// endregion

// region observation model

interface BaseObservation {
    type: string;
    timestamp: Date;
    stage?: TimelineStage;
}

export interface MessageObservation extends BaseObservation {
    type: "message";
    isMessage: true;

    sender: Entity;

    // 消息内容
    messageId: string;
    content: string;

    replyTo?: {
        messageId: string;
        content: string;
        sender: Entity;
    };
}

export interface NoticeObservation extends BaseObservation {
    type: "notice.member.join" | "notice.member.leave" | "notice.state.update" | "notice.reaction";
    isNotice: true;

    actor?: Entity;
    target?: Entity;

    description: string;
    details: Record<string, any>;
}

export type Observation = MessageObservation | NoticeObservation;

// endregion

// region entity model

/**
 * 数据库中的实体记录 (EntityRecord)
 * 这是一个扁平化的、通用的存储结构
 */
export interface EntityRecord {
    // 复合主键
    // User: "user:qq:123456"
    // Member: "member:qq:123456@guild:789"
    id: string;

    // 实体类型
    type: "user" | "member" | string;

    // 基础属性
    name: string;
    avatar?: string;

    // 关联键
    // 对于 Member，这里存储 userId 和 guildId
    // 对于 User，这里可能为空
    parentId?: string; // e.g. "guild:789"
    refId?: string; // e.g. "user:qq:123456"

    // 扩展属性 (JSON 字段)
    // 存放 roles, joinedAt, level 等特定类型的属性
    attributes: Record<string, any>;

    // 元数据
    createdAt: Date;
    updatedAt: Date;
}

/**
 * 实体 - 环境中的参与者或对象
 */
export interface Entity {
    id: string;
    type: string;
    name: string;
    description?: string;

    attributes?: Record<string, any>;
}

/**
 * 用户实体
 * 对应 type: "user"
 */
export interface UserEntity extends Entity {
    type: "user";
    attributes: {
        platform: string;
        avatar?: string;
    };
}

/**
 * 成员实体
 * 对应 type: "member"
 */
export interface MemberEntity extends Entity {
    type: "member";
    // 运行时可能会把关联的 UserEntity 挂载上来方便访问
    user?: UserEntity;

    attributes: {
        roles: string[];
        joinedAt?: Date;
        lastActive?: Date;
        [key: string]: unknown;
    };
}

// endregion

// region specific concepts

/**
 * 智能体自身信息
 */
export interface SelfInfo {
    id: string;
    name: string;
    avatar?: string;
    platform?: string;
}

export interface Memory {}

// endregion

// region world state model

/**
 * 环境 - 智能体活动的空间
 */
export interface Environment {
    /** 环境类型 */
    type: string;

    /** 环境唯一标识 */
    id: string;

    /** 环境名称 */
    name: string;

    /** 环境描述 (主观视角) */
    description?: string;

    /** 环境元数据 (场景特定) */
    metadata: Record<string, any>;
}

/**
 * 描述了智能体所处的世界
 *
 * 所有场景都可以抽象为:
 * - **在哪里** (Environment): 智能体活动的空间
 * - **有谁/什么** (Entity): 环境中的参与者或对象
 * - **发生了什么** (Event): 环境中发生的事情
 */
export interface HorizonView {
    /** 当前模式名称 */
    mode?: string;

    /** 触发此状态的感知 */
    percept: Percept;

    /** 智能体自身信息 */
    self: SelfInfo;

    /** 环境信息 */
    environment?: Environment;

    /** 实体列表 */
    entities?: Entity[];

    /** 事件历史 */
    history?: Observation[];

    /**
     * 工作记忆 / 执行链 (当前短时记忆)
     * 包含当前交互回合内产生的思考、工具调用、工具结果
     * 用于支持多步推理 (CoT) 和工具链 (Tool Chain)
     * 当回合结束时，这些内容应被归档或清理
     */
    workingHistory?: AgentRecord[];

    /** 检索到的记忆 (语义记忆) */
    memories?: Memory[];

    [key: string]: any;
}

// endregion

// region percept model

export enum PerceptType {
    UserMessage = "user.message", // 用户消息
    SystemSignal = "system.signal", // 系统信号
    TimerTick = "system.timer.tick", // 定时器触发
}

export interface BasePercept<T extends PerceptType> {
    id: string;
    type: T;
    scope: Scope;
    priority: number;
    timestamp: Date;
}

export interface UserMessagePercept extends BasePercept<PerceptType.UserMessage> {
    payload: {
        messageId: string;
        content: string;
        sender: {
            id: string;
            name: string;
            role?: string;
        };
        channel: {
            id: string;
            platform: string;
            guildId?: string;
        };
    };
    runtime?: {
        session: Session;
    };
}

export interface TimerTickPercept extends BasePercept<PerceptType.TimerTick> {
    payload: {
        taskId: string;
        taskType: string;
        params?: Record<string, any>;
    };
}

export type Percept = UserMessagePercept | TimerTickPercept;

// endregion

export interface Scope {
    platform?: string;
    channelId?: string;
    guildId?: string;
    isDirect?: boolean;
    userId?: string;
}
