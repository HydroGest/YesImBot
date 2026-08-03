export const DEFAULT_THRESHOLD = 0.9;
export const DEFAULT_CHAR_TOKEN_RATIO = 1.8;
export const DEFAULT_MIN_MESSAGES = 20;
export const DEFAULT_MAX_FAILURES = 3;
export const DEFAULT_CONTEXT_LENGTH = 128_000;
export const HARD_TRUNCATION_MESSAGE = "（由于上下文长度限制，更早的对话记录已被省略）";

export const COMPACT_SYSTEM_PROMPT = (personaName: string) =>
  `你是 ${personaName} 的记忆整理器。将近期对话压缩为第一人称的情景化记忆。`;

export const COMPACT_USER_PROMPT = (opts: {
  persona: string;
  previousMemory: string;
  conversation: string;
}) => `<persona>
${opts.persona}
</persona>

<previous_memory>
${opts.previousMemory || "无先前记忆"}
</previous_memory>

<recent_conversation>
${opts.conversation}
</recent_conversation>

请以角色第一人称，用情景化叙述输出压缩记忆。必须保留：
1. 正在进行的任务和未完成事项
2. 用户明确提出的目标、偏好和约束
3. 对后续回答有用的事实
4. 近期形成的结论和决定
5. 重要的人物关系和互动
不得捏造对话中未出现的事实。`;
