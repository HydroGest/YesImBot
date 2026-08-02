import type { AgentToolExecuteContext } from "@yesimbot/agent-runtime";
import { describe, expect, it, vi } from "vitest";

import { createAddMessageTool } from "../src/tools/core/add-message.js";
import { createSearchMessageTool } from "../src/tools/core/search-message.js";
import type { MemosClientConfig, MemosIdentity } from "../src/types.js";

const config: MemosClientConfig = {
  baseUrl: "https://memos.example/api",
  apiKey: "mpg-secret",
  memoryScope: "auto",
  timeoutMs: 1000,
  searchMemoryLimit: 3,
  searchPreferenceLimit: 2,
  searchRelativity: 0.67,
  includePreference: true,
  searchFilterMode: "context",
  searchTags: ["yesimbot"],
  searchImportSources: [],
  asyncMode: true,
  tags: ["yesimbot", "test"],
  includeRawIdentityInfo: false,
};

const identity: MemosIdentity = {
  userId: "yb_subject_chat",
  agentId: "yb_agent_bot",
  info: {
    scene: "group_chat",
    platform: "onebot",
    channel_type: "group",
    channel_hash: "channel_hash",
    subject_hash: "subject_hash",
    author_hash: "author_hash",
    message_hash: "message_hash",
    turn_id: "turn-real",
    memory_scope: "channel",
    conversation_kind: "runtime_turn",
  },
};

function toolContext(turnId = "turn-real"): AgentToolExecuteContext {
  return {
    runtime: { id: "runtime" },
    channel: {} as never,
    state: {} as never,
    storage: {} as never,
    turnId,
    toolCallId: "tool-call",
  };
}

function schemaText(value: unknown): string {
  return JSON.stringify(value);
}

describe("MemOS tools", () => {
  it("exposes minimal search input", () => {
    const tool = createSearchMessageTool({
      client: {} as never,
      config,
      resolveIdentity: () => identity,
    });
    const schema = schemaText(tool.inputSchema);

    expect(tool.name).toBe("search_message");
    expect(schema).toContain("query");
    for (const forbidden of [
      "user_id",
      "agent_id",
      "baseUrl",
      "apiKey",
      "Authorization",
      "relativity",
      "memory_limit_number",
      "filter",
      "tags",
      "import_source",
    ]) {
      expect(schema).not.toContain(forbidden);
    }
  });

  it("constructs search requests with runtime-owned filters", async () => {
    const searchMemory = vi.fn<() => Promise<unknown>>(async () => ({
      code: 0,
      data: { memory_detail_list: [], preference_detail_list: [] },
      message: "ok",
    }));
    const tool = createSearchMessageTool({
      client: { searchMemory } as never,
      config: {
        ...config,
        searchFilterMode: "strict",
        searchTags: ["yesimbot", "qq_import"],
        searchImportSources: ["qq_chat"],
      },
      resolveIdentity: () => identity,
    });

    await tool.execute?.({ query: "项目背景" }, toolContext());

    expect(JSON.stringify(tool.inputSchema)).not.toContain("filter");
    expect(searchMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: identity.userId,
        filter: {
          and: expect.arrayContaining([
            { agent_id: identity.agentId },
            { scene: "group_chat" },
            { memory_scope: "channel" },
            { tags: { contains: "yesimbot" } },
            { tags: { contains: "qq_import" } },
            { import_source: "qq_chat" },
          ]),
        },
      }),
    );
    expect(searchMemory.mock.calls[0]?.[0]).not.toHaveProperty("conversation_id");
  });

  it("constructs search requests with runtime identity and normalizes memories", async () => {
    const searchMemory = vi.fn<
      () => Promise<{
        code: number;
        data: {
          memory_detail_list: Array<{
            memory_value: string;
            confidence?: number;
            relativity?: number;
          }>;
          preference_detail_list: Array<{ preference: string }>;
        };
        message: string;
      }>
    >(async () => ({
      code: 0,
      data: {
        memory_detail_list: [
          {
            id: "mem-1",
            memory_key: "package_manager",
            memory_value: "团队使用 Yarn 4。",
            tags: ["yesimbot", "qq_import"],
            confidence: 0.91,
            relativity: 0.82,
          },
          { memory_value: "" },
        ],
        preference_detail_list: [
          {
            preference: "偏好简洁回答。",
            tags: ["yesimbot"],
            source: { type: "memory_source" },
          },
        ],
      },
      message: "ok",
    }));
    const resolveIdentity = vi.fn<() => MemosIdentity>(() => identity);
    const tool = createSearchMessageTool({
      client: { searchMemory } as never,
      config,
      resolveIdentity,
    });

    await expect(tool.execute?.({ query: "项目包管理器" }, toolContext())).resolves.toEqual({
      outcome: "completed",
      memories: [
        {
          id: "mem-1",
          key: "package_manager",
          content: "团队使用 Yarn 4。",
          type: "memory",
          tags: ["yesimbot", "qq_import"],
          confidence: 0.91,
          relativity: 0.82,
        },
        {
          content: "偏好简洁回答。",
          type: "preference",
          source: {
            type: "memory_source",
            tags: ["yesimbot"],
          },
        },
      ],
    });

    expect(resolveIdentity).toHaveBeenCalledWith("turn-real");
    expect(searchMemory).toHaveBeenCalledWith({
      user_id: "yb_subject_chat",
      query: "项目包管理器",
      filter: {
        and: [{ scene: "group_chat" }, { memory_scope: "channel" }],
      },
      relativity: 0.67,
      memory_limit_number: 3,
      include_preference: true,
      preference_limit_number: 2,
    });
  });

  it("fails search open with sanitized structured errors", async () => {
    const warn = vi.fn<(message: string) => void>();
    const tool = createSearchMessageTool({
      client: {
        searchMemory: vi.fn<() => Promise<never>>(async () => {
          throw new Error("Authorization failed for Token mpg-secret");
        }),
      } as never,
      config,
      resolveIdentity: () => identity,
      logger: { warn },
    });

    const result = await tool.execute?.({ query: "secret" }, toolContext());

    expect(result).toEqual({
      outcome: "failed",
      memories: [],
      error: {
        code: "request_failed",
        message: "Authorization failed for Token [REDACTED]",
      },
    });
    expect(JSON.stringify(result)).not.toContain("mpg-secret");
    expect(warn).toHaveBeenCalledWith("MemOS search failed: Authorization failed for Token [REDACTED]");
  });

  it("exposes minimal add input", () => {
    const tool = createAddMessageTool({
      client: {} as never,
      config,
      resolveIdentity: () => identity,
      now: () => new Date(),
    });
    const schema = schemaText(tool.inputSchema);

    expect(tool.name).toBe("add_message");
    expect(schema).toContain("content");
    for (const forbidden of [
      "messages",
      "role",
      "user_id",
      "conversation_id",
      "agent_id",
      "chat_time",
      "tags",
      "info",
      "baseUrl",
      "apiKey",
      "async_mode",
    ]) {
      expect(schema).not.toContain(forbidden);
    }
  });

  it("wraps add content with runtime identity, metadata, and async mode", async () => {
    const addMessage = vi.fn<
      () => Promise<{
        code: number;
        data: { task_id: string; status: string };
        message: string;
      }>
    >(async () => ({
      code: 0,
      data: { task_id: "task-1", status: "pending" },
      message: "ok",
    }));
    const resolveIdentity = vi.fn<() => MemosIdentity>(() => identity);
    const tool = createAddMessageTool({
      client: { addMessage } as never,
      config,
      resolveIdentity,
      now: () => new Date("2026-07-05T03:04:05.000Z"),
    });

    await expect(tool.execute?.({ content: "团队稳定使用 Yarn 4。" }, toolContext())).resolves.toEqual({
      outcome: "accepted",
      taskId: "task-1",
    });

    expect(resolveIdentity).toHaveBeenCalledWith("turn-real");
    expect(addMessage).toHaveBeenCalledWith({
      user_id: "yb_subject_chat",
      agent_id: "yb_agent_bot",
      messages: [
        {
          role: "user",
          content: "团队稳定使用 Yarn 4。",
          chat_time: "2026-07-05 03:04:05",
        },
      ],
      tags: ["yesimbot", "test"],
      info: identity.info,
      async_mode: true,
      source: "yesimbot",
    });

    const synchronousTool = createAddMessageTool({
      client: { addMessage } as never,
      config: { ...config, asyncMode: false },
      resolveIdentity,
      now: () => new Date("2026-07-05T03:04:05.000Z"),
    });
    await expect(synchronousTool.execute?.({ content: "团队稳定使用 Yarn 4。" }, toolContext())).resolves.toEqual({
      outcome: "persisted",
      taskId: "task-1",
    });
    expect(addMessage).toHaveBeenLastCalledWith(expect.objectContaining({ async_mode: false }));
  });

  it("fails add open with sanitized structured errors", async () => {
    const warn = vi.fn<(message: string) => void>();
    const tool = createAddMessageTool({
      client: {
        addMessage: vi.fn<() => Promise<never>>(async () => {
          throw new Error("bad api key mpg-secret");
        }),
      } as never,
      config,
      resolveIdentity: () => identity,
      now: () => new Date(),
      logger: { warn },
    });

    const result = await tool.execute?.({ content: "remember me" }, toolContext());

    expect(result).toEqual({
      outcome: "failed",
      error: { code: "request_failed", message: "bad api key [REDACTED]" },
    });
    expect(JSON.stringify(result)).not.toContain("mpg-secret");
    expect(warn).toHaveBeenCalledWith("MemOS add message failed: bad api key [REDACTED]");
  });
});
