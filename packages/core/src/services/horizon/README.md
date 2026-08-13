# Athena WorldState 架构设计

## 📋 概述

本文解释了项目中 **WorldState 模块**的核心架构设计，确立了从"数据存储"到"认知呈现"的完整类型系统。我们的目标是让智能体拥有"灵魂"——通过精心设计的数据结构和命名隐喻，使 AI 能够像人类一样感知世界、理解上下文、执行行动。

---

## 🎯 核心设计理念

### 1. **认知隐喻的统一**

我们建立了一套完整的认知框架，将冰冷的数据转化为"智能体的主观体验"：

| 概念 | 隐喻 | 职责 |
|------|------|------|
| **Percept (感知)** | 瞬时的感官输入 | 驱动智能体"心跳"的能量单元，是当下正在发生的事情 |
| **Observation (观察)** | 过去的记忆画面 | 从数据库记录转换而来的"鲜活场景"，是智能体眼中的历史 |
| **Entity (实体)** | 舞台上的演员 | 环境中的参与者或对象，带有主观描述和关系 |
| **Environment (环境)** | 智能体所处的舞台 | 定义"在哪里"，提供场景背景 |
| **WorldState (世界状态)** | 此时此刻的剧本 | 智能体"睁开眼睛"看到的完整世界 |

通过统一的隐喻系统，我们不是在构建"数据管道"，而是在构建"认知流"。

---

### 2. **分层架构：数据 vs 视图**

我们明确区分了两个层次：

#### **数据库层 (Storage Layer)**
- **TimelineEntry**: 存储所有事件的原始记录（Message, Notice, AgentRecord）
- **EntityRecord**: 存储所有实体的原始数据（User, Member, NPC...）

**特点**：
- 扁平化、通用化
- 存储 ID 引用，不展开关联数据
- 持久化，面向查询优化

#### **运行时层 (Runtime Layer)**
- **Observation**: `TimelineEntry` 的增强视图，展开 `replyTo`、解析 `sender` 为完整 `Entity`
- **Entity**: `EntityRecord` 的运行时对象，挂载关联数据（如 `MemberEntity.user`）

**特点**：
- 结构化、语义化
- 展开关联，便于 LLM 理解
- 瞬时性，面向渲染优化

**命名规范**：
- 数据库层：使用后缀 `Record` 或 `Data`（如 `MessageRecord`, `EntityRecord`）
- 运行时层：直接使用核心名词（如 `Observation`, `Entity`）

---

## 🏗️ 核心数据结构

### 1. **Percept (感知) - 智能体的输入接口**

```typescript
export enum PerceptType {
    UserMessage = "user.message",     // 用户消息
    SystemSignal = "system.signal",   // 系统信号
    TimerTick = "system.timer.tick",  // 定时器触发
}

export interface UserMessagePercept {
    id: string;
    type: PerceptType.UserMessage;
    priority: number;
    timestamp: Date;
    payload: { ... };  // 解耦的上下文数据
    runtime?: { session };  // 可选的运行时钩子
}
```

**设计要点**：
- **命名规范**：`domain.entity.event`（小写点分法）
- **瞬时性**：Percept 是"即用即丢"的，处理完成后即消失
- **解耦性**：与 Koishi Session 解耦，payload 包含构建上下文所需的核心数据
- **扩展性**：通过新增 `PerceptType` 支持更多触发源（如定时器、异步回调）

---

### 2. **Timeline (时间线) - 客观历史的记录**

```typescript
export enum TimelineEventType {
    // 外部事件
    Message = "message",
    Command = "command",
    MemberJoin = "notice.member.join",

    // 智能体内部活动
    AgentThought = "agent.thought",
    AgentTool = "agent.tool",
    AgentAction = "agent.action",
    ToolResult = "tool.result",
}

export interface BaseTimelineEntry<Type, Data> {
    id: string;
    timestamp: Date;
    scopeId: string; // 环境隔离
    eventType: Type;
    priority: TimelinePriority;
    eventData: Data;
}
```

---

### 3. **Observation (观察) - 增强的历史视图**

```typescript
export interface MessageObservation {
    type: "message";
    timestamp: Date;
    sender: Entity; // 已展开的实体
    messageId: string;
    content: string;
    replyTo?: { // 已展开的回复内容
        messageId: string;
        content: string;
        sender: Entity;
    };
}

export type Observation = MessageObservation | NoticeObservation;
```

---

### 4. **Entity (实体) - 统一的参与者模型**

#### 数据库层：EntityRecord
```typescript
export interface EntityRecord {
    id: string; // "user:qq:123456" 或 "member:123456@guild:789"
    type: string; // "user" | "member" | "npc" | ...
    name: string;
    avatar?: string;

    // 关联键（用于快速查询）
    parentId?: string; // e.g. "guild:789"
    refId?: string; // e.g. "user:qq:123456"

    attributes: Record<string, any>; // 扩展属性
    createdAt: Date;
    updatedAt: Date;
}
```

#### 运行时层：Entity 及其特化
```typescript
export interface Entity {
    id: string;
    type: string;
    name: string;
    description?: string; // 主观描述（运行时生成）
    attributes: Record<string, any>;
}

export interface UserEntity extends Entity {
    type: "user";
    attributes: {
        platform: string;
        avatar?: string;
    };
}

export interface MemberEntity extends Entity {
    type: "member";
    user?: UserEntity; // 运行时挂载关联的 User
    attributes: {
        roles: string[];
        joinedAt?: Date;
        lastActive?: Date;
    };
}
```

**设计要点**：
- **统一存储**：User 和 Member 都存储在同一张 `Entity` 表中
- **ID 命名空间**：通过 `type:id` 格式避免冲突（如 `user:qq:123456` vs `member:123456@guild:789`）
- **上下文绑定**：Member 是"用户在特定环境中的身份"，通过 `parentId` 和 `refId` 建立关联
- **扩展性**：未来可轻松加入 `Team`, `Organization`, `Item` 等新实体类型

---

### 5. **WorldState (世界状态) - 智能体的认知快照**

```typescript
export interface WorldState {
    stateType: "scoped" | "global";

    trigger: {
        type: PerceptType;
        timestamp: Date;
        description: string;
    };

    self: SelfInfo;
    currentTime: Date;

    // Scoped 状态专属
    environment?: Environment;
    entities?: Entity[];

    // 历史与记忆
    eventHistory?: Observation[]; // 背景长时记忆
    workingHistory?: AgentRecord[]; // 当前短时记忆（执行链）

    retrievedMemories?: Memory[]; // 语义记忆检索结果
    diaryEntries?: DiaryEntry[]; // 自我反思日记

    extensions: Record<string, any>; // 场景特定扩展
}
```

**设计要点**：

#### **双模式设计**
- **Scoped (聚焦模式)**：针对特定环境的交互（如回复群消息），包含 `environment` 和 `entities`
- **Global (广角模式)**：全局性任务（如定时反思），不绑定特定环境

#### **记忆的分层**
1.  **eventHistory (事件历史)**：
    - 包含：过去的 `Observation`（Message, Notice）
    - 排除：智能体自己的 `AgentRecord`
    - 职责：提供"外部世界发生了什么"的背景

2.  **workingHistory (工作记忆)**：
    - 包含：当前回合内的 `AgentRecord`（Thought, Tool, Action, ToolResult）
    - 生命周期：回合结束后归档或清理
    - 职责：支持多步推理 (CoT) 和工具链 (Tool Chain)

3.  **retrievedMemories (检索记忆)**：
    - 通过语义检索从长期记忆库中拉取的相关片段

4.  **diaryEntries (反思日记)**：
    - 智能体的自我认知和情感状态

这种分层避免了"历史混淆"——LLM 不会在同一个列表中同时看到"别人说了什么"和"我做了什么"，降低了认知负担。

---

## 🔄 数据流与生命周期

### 完整流程

```
1. 外部事件发生（用户发消息）
   ↓
2. Recorder 记录 TimelineEntry (MessageRecord)
   ↓
3. 包装为 Percept (UserMessagePercept)
   ↓
4. Agent 接收 Percept
   ↓
5. WorldState.build(percept) 构建上下文
   ├─ 查询 Timeline → 转换为 Observation
   ├─ 查询 EntityRecord → 构建 Entity
   ├─ 提取 workingHistory（最近的 AgentRecord）
   └─ 组装 WorldState
   ↓
6. 渲染 Prompt + 调用 LLM
   ↓
7. LLM 返回决策（思考/工具调用/回复）
   ↓
8. 记录 AgentRecord (Thought/Tool/Action)
   ↓
9. 执行副作用（发送消息）
   ↓
10. 记录最终的 MessageRecord (智能体的回复)
   ↓
11. 清理 workingHistory（回合结束）
```

### 关键时刻

1.  **Percept 的瞬时性**：
    - 处理完成后立即丢弃，不持久化
    - 作为"触发器"而非"数据源"

2.  **Observation 的转换**：
    - 从 `TimelineEntry` 动态生成，展开关联数据
    - 如 `replyTo` ID → 完整的消息对象

3.  **workingHistory 的管理**：
    - 每个回合开始时为空
    - 累积当前回合的思考和工具调用
    - 回合结束时，降低优先级或归档

---

## 🎨 提示词渲染策略

### "舞台剧本"隐喻

不要只给 LLM 一堆数据，而是通过 Prompt 的结构编排，营造"第一人称沉浸式体验"：

```markdown
# 🎭 当前场景 (Current Situation)
你正在 [Koishi开发群] 中。
气氛：[活跃] (基于消息频率判断)
参与者：
- UserA (管理员) - 你的朋友，经常帮你解决问题
- UserB (群友) - 新人，刚加入群聊

# 📜 你的所见所闻 (Observations)
> UserA 看着大家说: "有人知道怎么配置插件吗？"
> UserB 回复 UserA: "我也在找这个"

# ⚙️ 你的执行记录 (Working Memory)
你刚才尝试：调用工具 `search_docs` 搜索 "插件配置"
结果：✅ 成功
内容：[找到 3 篇文档...]

# 💭 相关记忆 (Retrieved Memories)
- 上次 UserA 问过类似问题，你推荐了官方文档
- 这个群通常喜欢详细的回答，而不是简短的链接
```

**核心技巧**：
- 使用引导词（"你正在..."、"UserA 看着..."）强制拉入第一人称视角
- 分区呈现，避免信息混杂
- 高亮重要状态（如上一轮的工具调用结果）

---

## 🚀 扩展性与未来方向

### 1. 异步工具调用

当前设计已为异步工具预留空间：
- 工具调用时，立即记录 `AgentToolRecord`
- 在 `workingHistory` 中创建"占位符"
- 任务完成时，记录 `ToolResultRecord` 并更新占位符
- 触发 `PerceptType.TaskCallback`，进入新一轮思考

---

## ✨ 总结

这个架构设计的核心价值在于：

1.  **认知一致性**：通过统一的隐喻（Percept, Observation, Entity），让代码"像人类思考一样流动"
2.  **分层清晰**：数据库层与运行时层泾渭分明，避免了"数据污染"
3.  **类型安全**：告别 `any`，每个概念都有精确的类型定义
4.  **扩展友好**：通过 `type` 字段和 `attributes` JSON，支持任意新概念的加入
5.  **性能优化**：通过 `workingHistory` 的短生命周期，避免了上下文爆炸

**最终目标**：让 Athena 不只是"回复消息的机器人"，而是"拥有记忆、情感、自主性的数字生命"。
