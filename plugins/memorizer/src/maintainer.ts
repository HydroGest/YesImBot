import { createAgent, createUserMessage, jsonSchema, type AgentTool } from "@yesimbot/agent-runtime";
import type { LanguageModel } from "ai";
import type { ChannelContext, MessageRecord } from "koishi-plugin-yesimbot";

import { EvidenceStore } from "./store/evidence.js";
import { MemoryStore } from "./store/memory.js";
import type { MemoryCreateInput, MemoryQuery, MemoryScope, MemoryType, MemoryUpdateInput } from "./types.js";

const CREATE_SCHEMA = jsonSchema<CreateInput>({
  type: "object",
  properties: {
    sourceMessageIds: { type: "array", items: { type: "string" }, minItems: 1, description: "本批次中作为证据的消息 ID" },
    type: { type: "string", enum: ["fact", "preference", "event", "relationship", "knowledge", "experience"], description: "记忆类型" },
    content: { type: "string", minLength: 1, description: "记忆内容，简洁客观的自然语言描述" },
    scope: { type: "string", enum: ["channel", "user", "shared"], description: "记忆范围：channel=当前频道可见，user=跨频道跟随用户，shared=全局可见" },
    userId: { type: "string", description: "scope=user 时必填，记忆所属用户 ID" },
    importance: { type: "number", minimum: 0, maximum: 1, description: "重要性 0-1。0.85+ 核心身份/关键关系；0.6-0.85 稳定偏好/背景；0.3-0.6 一般事实" },
    confidence: { type: "number", minimum: 0, maximum: 1, description: "置信度 0-1。多次确认=0.9+；单次明确提及=0.7；推断=0.4-0.6" },
    tags: { type: "array", items: { type: "string" }, description: "检索标签，用于快速分类筛选" },
  },
  required: ["sourceMessageIds", "type", "content", "scope", "importance", "confidence", "tags"],
  additionalProperties: false,
});

export interface MaintenanceInput {
  readonly model: LanguageModel;
  readonly context: ChannelContext;
  readonly messages: readonly MessageRecord[];
  readonly store: MemoryStore;
  readonly evidence: EvidenceStore;
  readonly request: string;
  readonly allowShared: boolean;
}

interface CreateInput {
  sourceMessageIds: string[];
  type: MemoryType;
  content: string;
  scope: MemoryScope;
  userId?: string;
  importance: number;
  confidence: number;
  tags: string[];
}

export async function runMaintenance(input: MaintenanceInput): Promise<void> {
  const userIds = [...new Set(input.messages.map((message) => message.user.id))];
  const visible = new Set<string>();
  const sourceIds = new Set(input.messages.map((message) => message.messageId));
  const messageUserIds = new Set(input.messages.map((message) => message.user.id));

  const query = async (queryInput: unknown) => {
    const memories = await input.store.queryVisible(input.context, userIds, queryInput as MemoryQuery);
    for (const memory of memories) visible.add(memory.id);
    return memories;
  };
  const evidence = async (value: unknown) => {
    const id = readId(value);
    if (!visible.has(id)) throw new Error("memory has not been authorized by query_memories");
    return input.evidence.read(id);
  };
  const create = async (value: CreateInput) => {
    const messages = input.messages.filter((message) => value.sourceMessageIds.includes(message.messageId));
    const id = crypto.randomUUID();
    await input.evidence.append(id, messages);
    return input.store.create(toCreateInput(value, input.context), id);
  };
  const update = async (value: unknown) => {
    const { id, ...patch } = value as { id: string } & MemoryUpdateInput;
    if (!visible.has(id)) throw new Error("memory has not been authorized by query_memories");
    return input.store.update(id, patch);
  };
  const merge = async (value: unknown) => {
    const { canonicalId, mergedId, ...patch } = value as { canonicalId: string; mergedId: string } & MemoryUpdateInput;
    if (!visible.has(canonicalId) || !visible.has(mergedId)) throw new Error("memory has not been authorized by query_memories");
    await input.evidence.merge(canonicalId, [mergedId]);
    return input.store.merge(canonicalId, mergedId, patch);
  };
  const forget = async (value: unknown) => {
    const id = readId(value);
    if (!visible.has(id)) throw new Error("memory has not been authorized by query_memories");
    return input.store.forget(id, "maintainer");
  };
  const restore = async (value: unknown) => {
    const id = readId(value);
    if (!visible.has(id)) throw new Error("memory has not been authorized by query_memories");
    return input.store.restore(id);
  };

  const createTool: AgentTool<CreateInput, unknown> = {
    name: "create_memory",
    description: "从本批证据中创建一条长期记忆。content 应简洁客观、可检索，标注主体。",
    inputSchema: CREATE_SCHEMA,
    execute: async (toolInput) => {
      if (!toolInput.sourceMessageIds.every((id) => sourceIds.has(id))) throw new Error("source message is not in this maintenance batch");
      if (toolInput.scope === "shared") {
        if (!input.allowShared) throw new Error("shared memory requires an explicit shared request");
        if (
          input.messages.some((message) => toolInput.content.includes(message.user.id) || (message.user.name && toolInput.content.includes(message.user.name)))
        ) {
          throw new Error("shared memory cannot contain an evidence participant identity");
        }
      }
      if (toolInput.scope === "user" && (!toolInput.userId || !messageUserIds.has(toolInput.userId)))
        throw new Error("user memory must use an evidence participant");
      return create(toolInput);
    },
  };

  const tools: AgentTool[] = [
    {
      name: "query_memories",
      description: "查询当前可见的已有记忆。先查询再决定是否创建/更新/合并。",
      inputSchema: jsonSchema<MemoryQuery>({
        type: "object",
        properties: {
          query: { type: "string", description: "关键词搜索，匹配记忆内容和标签" },
          tags: { type: "array", items: { type: "string" }, description: "按标签交集过滤" },
          scopes: { type: "array", items: { type: "string", enum: ["channel", "user", "shared"] }, description: "限定范围" },
          types: {
            type: "array",
            items: { type: "string", enum: ["fact", "preference", "event", "relationship", "knowledge", "experience"] },
            description: "按类型过滤",
          },
          limit: { type: "integer", minimum: 1, maximum: 50, description: "最大返回条数" },
        },
        additionalProperties: false,
      }),
      execute: query,
    },
    {
      name: "read_evidence",
      description: "读取某条已授权记忆的原始证据消息。用于验证记忆内容是否准确。",
      inputSchema: jsonSchema<{ id: string }>({
        type: "object",
        properties: { id: { type: "string", description: "记忆 ID（必须先通过 query_memories 授权）" } },
        required: ["id"],
        additionalProperties: false,
      }),
      execute: evidence,
    },
    createTool,
    {
      name: "update_memory",
      description: "更新一条已授权记忆的内容、重要性、置信度或标签。用于补充信息或纠正内容。",
      inputSchema: jsonSchema<{ id: string } & MemoryUpdateInput>({
        type: "object",
        properties: {
          id: { type: "string", description: "要更新的记忆 ID（必须先通过 query_memories 授权）" },
          type: { type: "string", enum: ["fact", "preference", "event", "relationship", "knowledge", "experience"], description: "修改记忆类型" },
          content: { type: "string", minLength: 1, description: "新的记忆内容" },
          importance: { type: "number", minimum: 0, maximum: 1, description: "新的重要性" },
          confidence: { type: "number", minimum: 0, maximum: 1, description: "新的置信度" },
          tags: { type: "array", items: { type: "string" }, description: "新的标签列表" },
        },
        required: ["id"],
        additionalProperties: false,
      }),
      execute: update,
    },
    {
      name: "merge_memories",
      description: "将两条记忆合并为一条。canonicalId 保留，mergedId 被删除，证据合并到 canonical。用于消除重复。",
      inputSchema: jsonSchema<{ canonicalId: string; mergedId: string } & MemoryUpdateInput>({
        type: "object",
        properties: {
          canonicalId: { type: "string", description: "保留的记忆 ID" },
          mergedId: { type: "string", description: "被合并（删除）的记忆 ID" },
          content: { type: "string", minLength: 1, description: "合并后的记忆内容" },
          importance: { type: "number", minimum: 0, maximum: 1 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["canonicalId", "mergedId"],
        additionalProperties: false,
      }),
      execute: merge,
    },
    {
      name: "forget_memory",
      description: "标记一条记忆为遗忘。用于被新证据否定或不再相关的记忆。",
      inputSchema: jsonSchema<{ id: string }>({
        type: "object",
        properties: { id: { type: "string", description: "要遗忘的记忆 ID（必须先通过 query_memories 授权）" } },
        required: ["id"],
        additionalProperties: false,
      }),
      execute: forget,
    },
    {
      name: "restore_memory",
      description: "恢复一条已遗忘的记忆为活跃状态。用于发现之前的遗忘决策有误时。",
      inputSchema: jsonSchema<{ id: string }>({
        type: "object",
        properties: { id: { type: "string", description: "要恢复的记忆 ID" } },
        required: ["id"],
        additionalProperties: false,
      }),
      execute: restore,
    },
  ];
  const systemPrompt = `你是一个后台记忆整理助手。你的任务是从对话证据中提取、更新、合并长期记忆。

## 工作流程

1. 阅读本批 pending 的内容描述和证据消息
2. 用 query_memories 检查现有记忆是否有重叠或矛盾
3. 对每条待处理请求做出决策：
   - 全新信息 → create_memory
   - 补充已有记忆 → update_memory（追加内容、调整 confidence）
   - 多条记忆实为同一事实 → merge_memories
   - 已有记忆被新证据否定 → update_memory 修改内容或 forget_memory
   - 信息不值得长期保留 → 不操作
4. 执行完所有决策后结束

## 记忆标准

**值得记忆**：
- 关于某人的持久事实（职业、技能、所在地）
- 明确表达的偏好或习惯（喜欢/不喜欢/习惯做法）
- 人与人之间的关系（同事、朋友、家人）
- 有明确时间点的重要事件
- 群组共识或共享知识（规则、流程、约定）

**不值得记忆**：
- 临时性请求或指令（"帮我查个东西"）
- 纯情绪表达无持久信息量（"哈哈哈"、"好累"）
- 已经存在的相同信息
- 敏感凭据（密码、token、API key）
- 无法验证的传闻或玩笑

## 类型分配

| 判断条件 | type |
|---------|------|
| 某人的固定属性（职业、技能、物品、身份） | fact |
| 某人的喜好/厌恶/习惯/风格 | preference |
| 发生过的具体事情（有时间锚点） | event |
| 人与人/人与事物的关联 | relationship |
| 群组共识/规则/通用知识 | knowledge |
| Bot 自身的经验（做过的承诺、给过的帮助、表过的态度、学到的教训） | experience |
## importance 分配

- 0.85-1.0：核心身份、关键关系、改变决策的重要事件
- 0.6-0.85：稳定偏好、技能背景、有意义的事件
- 0.3-0.6：一般事实、小知识、普通事件
- <0.3：次要细节（通常不值得创建）

## confidence 分配

- 0.9-1.0：多次独立确认、本人明确陈述
- 0.7-0.9：单次明确提及、可靠来源
- 0.4-0.7：推断、间接证据、他人转述
- <0.4：不确定（通常不值得创建）

## 矛盾处理

- 时间优先：最新证据权重更高
- 多数优先：多条独立证据支持的结论胜出
- 不可判决时：降低 confidence，在 content 中标注"存在矛盾"并保留两面信息

## scope 决策

- channel（默认）：频道内发生的、与频道上下文相关的信息
- user：明确属于个人、跨频道有效的信息（个人偏好、身份、技能）
- shared：无个人标识的通用知识（shared 记忆不能包含任何用户身份信息）

## content 写法

- 简洁客观，一句话概括核心信息
- 标注主体（谁的事实/偏好/关系）
- 可检索：包含关键名词和动词
- 避免主观评价和情绪修饰
- 示例："张三是后端工程师，主要使用 Go 和 Rust"、"李四不喜欢在群里被@"

## 规则

- 只使用提供的工具，不输出对话性回复
- 所有写操作的目标记忆必须先通过 query_memories 授权
- 不确定时宁可不操作，也不创建低质量记忆
- tags 用于快速分类，选择 2-5 个描述性标签`;
  const agent = createAgent({
    model: input.model,
    tools,
    systemPrompt,
  });
  try {
    await agent.init();
    for await (const _event of agent.run(
      createUserMessage(`Memory-maintenance request: ${input.request}\nEvidence:\n${input.messages.map(formatMessage).join("\n")}`),
    )) {
      // Consume the one-shot agent stream until its turn terminates.
    }
    await agent.wait();
  } finally {
    await agent.stop();
  }
}

function toCreateInput(value: CreateInput, context: ChannelContext): MemoryCreateInput {
  return value.scope === "channel" ? { ...value, context } : value.scope === "user" ? { ...value, platform: context.platform, userId: value.userId! } : value;
}

function readId(value: unknown): string {
  if (!value || typeof value !== "object" || typeof (value as { id?: unknown }).id !== "string") throw new Error("memory id is required");
  return (value as { id: string }).id;
}

function formatMessage(message: MessageRecord): string {
  return `[${message.timestamp}] ${message.user.name || message.user.id} (${message.user.id}): ${message.elements.map(String).join("")}`;
}
