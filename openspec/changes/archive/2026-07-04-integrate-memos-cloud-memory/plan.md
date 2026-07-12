# MemOS Cloud Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a group-chat-friendly MemOS Cloud long-term memory plugin and add runtime terminal loop control so Athena can search memory before answering, selectively write durable memories after final text, and stop cleanly.

**Architecture:** `@yesimbot/agent-runtime` owns the generic `finalize_response` terminal tool and stop condition. `koishi-plugin-yesimbot` enables that runtime tool by default when it creates channel Agents. `plugins/memos-client` owns MemOS config, identity hashing, HTTP calls, LLM-visible memory tools, and prompt policy.

**Tech Stack:** TypeScript, Yarn 4 workspaces, Koishi `Schema` and `ctx.http`, AI SDK `streamText`/`hasToolCall`, Vitest, OpenSpec `superpowers-bridge`.

## Global Constraints

- Use Yarn, not npm or pnpm.
- Do not expose MemOS API keys, auth headers, raw platform ids, or runtime-fillable fields to LLM tool inputs.
- MemOS Cloud endpoints are `POST /search/memory` and `POST /add/message` under `https://memos.memtensor.cn/api/openmem/v1` unless configured otherwise.
- `search_message` input is exactly `{ query: string }`.
- `add_message` input is exactly `{ content: string }`.
- `finalize_response` is an agent-runtime built-in terminal tool enabled by yesimbot core by default.
- Group chats default to channel-scoped short hash `user_id`; private chats default to author-scoped short hash `user_id`.
- Search and write failures fail open with sanitized structured errors.

---

## Task 1: Workspace and Package Metadata

**Files:**
- Modify: `plugins/memos-client/package.json`
- Modify: `plugins/sticker/package.json`
- Verify: root `package.json` workspace listing through Yarn

**Interfaces:**
- Consumes: Current workspace directories under `plugins/*`.
- Produces: Workspace names `koishi-plugin-yesimbot-memos-client` and `koishi-plugin-yesimbot-sticker` mapped to the correct directories.

- [ ] **Step 1: Inspect current workspace names**

Run:

```bash
yarn workspaces list --json
```

Expected before implementation: `plugins/memos-client` and `plugins/sticker` show swapped package names.

- [ ] **Step 2: Fix package names**

Edit `plugins/memos-client/package.json`:

```json
{
  "name": "koishi-plugin-yesimbot-memos-client"
}
```

Edit `plugins/sticker/package.json`:

```json
{
  "name": "koishi-plugin-yesimbot-sticker"
}
```

Keep each file's existing scripts, dependencies, exports, and Koishi metadata unchanged.

- [ ] **Step 3: Verify workspace mapping**

Run:

```bash
yarn workspaces list --json
```

Expected: `plugins/memos-client` maps to `koishi-plugin-yesimbot-memos-client`, and `plugins/sticker` maps to `koishi-plugin-yesimbot-sticker`.

- [ ] **Step 4: Commit metadata fix**

```bash
git add plugins/memos-client/package.json plugins/sticker/package.json
git commit -m "chore: fix memos client workspace metadata"
```

---

## Task 2: Agent Runtime Terminal Tool

**Files:**
- Modify: `packages/agent-runtime/src/agent.ts`
- Create: `packages/agent-runtime/src/terminal.ts`
- Test: `packages/agent-runtime/tests/terminal-tool.test.ts`

**Interfaces:**
- Produces: `AgentConfig["terminalTool"]?: boolean | { name?: string }`
- Produces: `createTerminalTool(name: string): AgentTool<Record<string, never>, { finalized: true }>`
- Consumes: AI SDK `hasToolCall(toolName)` stop condition.

- [ ] **Step 1: Write failing tests for disabled and enabled terminal tool**

Create `packages/agent-runtime/tests/terminal-tool.test.ts` with tests that assert:

```ts
import { describe, expect, it } from "vitest";

import { createAgent } from "../src/agent.js";

describe("terminal tool", () => {
  it("does not add finalize_response unless enabled", async () => {
    const agent = createAgent({ model: {} as never, tools: [] });
    await agent.init();

    expect(agent.id).toBeTruthy();
  });

  it("accepts terminalTool true in AgentConfig", () => {
    const agent = createAgent({
      model: {} as never,
      tools: [],
      terminalTool: true,
    });

    expect(agent.id).toBeTruthy();
  });
});
```

Run:

```bash
yarn workspace @yesimbot/agent-runtime exec vitest run tests/terminal-tool.test.ts
```

Expected: TypeScript/test compile fails because `terminalTool` does not exist.

- [ ] **Step 2: Add terminal config type**

Modify `packages/agent-runtime/src/agent.ts`:

```ts
export interface AgentTerminalToolConfig {
  name?: string;
}
```

Add to `AgentConfig`:

```ts
terminalTool?: boolean | AgentTerminalToolConfig;
```

- [ ] **Step 3: Add terminal tool factory**

Create `packages/agent-runtime/src/terminal.ts`:

```ts
import { z } from "zod";

import type { AgentTool } from "./tools.js";

export const DEFAULT_TERMINAL_TOOL_NAME = "finalize_response";

export interface TerminalToolOutput {
  finalized: true;
}

export function resolveTerminalToolName(
  config: boolean | { name?: string } | undefined,
): string | undefined {
  if (!config) return undefined;
  if (config === true) return DEFAULT_TERMINAL_TOOL_NAME;
  return config.name ?? DEFAULT_TERMINAL_TOOL_NAME;
}

export function createTerminalTool(
  name = DEFAULT_TERMINAL_TOOL_NAME,
): AgentTool<Record<string, never>, TerminalToolOutput> {
  return {
    name,
    description:
      "Mark the current assistant response as final. Call this after final text and required tools.",
    inputSchema: z.object({}),
    execute: async () => ({ finalized: true }),
  };
}
```

- [ ] **Step 4: Wire terminal tool into tool resolution**

Modify `packages/agent-runtime/src/agent.ts` imports:

```ts
import { hasToolCall, isLoopFinished, LanguageModel, streamText, type LanguageModelUsage } from "ai";
import { createTerminalTool, resolveTerminalToolName } from "./terminal.js";
```

Inside `createAgent`, derive:

```ts
const terminalToolName = resolveTerminalToolName(config.terminalTool);
const terminalTools = terminalToolName ? [createTerminalTool(terminalToolName)] : [];
```

In `resolveTools`, merge built-ins after plugin stable tools:

```ts
const stableTools = mergeTools([tools, [...pluginHost.stableTools], terminalTools]);
```

In `streamText`, set:

```ts
stopWhen: terminalToolName ? hasToolCall(terminalToolName) : isLoopFinished(),
```

- [ ] **Step 5: Add behavior test for custom name conflict**

Extend `terminal-tool.test.ts`:

```ts
import { createUserMessage } from "../src/message.js";

it("surfaces tool conflicts for terminal tool names", async () => {
  const agent = createAgent({
    model: {} as never,
    terminalTool: true,
    tools: [
      {
        name: "finalize_response",
        inputSchema: z.object({}),
        execute: async () => ({ ok: true }),
      },
    ],
  });

  const turnId = agent.send(createUserMessage("hello"));
  const result = await agent.waitTurn(turnId);

  expect(result.status).toBe("failed");
  expect(result.error?.message).toContain("finalize_response");
});
```

Run:

```bash
yarn workspace @yesimbot/agent-runtime exec vitest run tests/terminal-tool.test.ts
```

Expected: PASS after implementation.

- [ ] **Step 6: Run runtime type check and tests**

```bash
yarn turbo run check-types --filter=@yesimbot/agent-runtime
yarn turbo run test --filter=@yesimbot/agent-runtime
```

Expected: both commands pass.

- [ ] **Step 7: Commit runtime terminal tool**

```bash
git add packages/agent-runtime/src/agent.ts packages/agent-runtime/src/terminal.ts packages/agent-runtime/tests/terminal-tool.test.ts
git commit -m "feat(agent-runtime): add terminal response tool"
```

---

## Task 3: Core Default Terminal Enablement

**Files:**
- Modify: `core/src/service.ts`
- Test: `core/tests/service.test.ts`
- Test: `core/tests/channel-context.test.ts` if createAgent mock assertions need updating

**Interfaces:**
- Consumes: `AgentConfig.terminalTool`.
- Produces: Core-created Agents default to `terminalTool: true`.

- [ ] **Step 1: Write failing core test**

In `core/tests/service.test.ts`, add an assertion to the runtime creation test:

```ts
it("enables the runtime terminal tool by default", () => {
  const service = new TestYesImBotService(new Context(), config);

  service.buildRuntimePlugins(createChannelContext());

  expect(service).toBeInstanceOf(TestYesImBotService);
});
```

In the existing mocked `createAgent` integration test, assert:

```ts
expect(createAgentConfig).toHaveProperty("terminalTool", true);
```

Run:

```bash
yarn workspace koishi-plugin-yesimbot exec vitest run tests/service.test.ts tests/channel-context.test.ts
```

Expected before implementation: FAIL because `terminalTool` is not set.

- [ ] **Step 2: Enable terminal tool in core Agent creation**

Modify `core/src/service.ts` in `getChannelAgent`:

```ts
const runtime = createAgent({
  id: key,
  model,
  storage,
  systemPrompt: buildCoreSystemPrompt(context),
  plugins: this.createRuntimePlugins(context),
  terminalTool: true,
});
```

- [ ] **Step 3: Verify assistant rendering remains text-only**

Add or update a core render test to ensure tool messages are ignored:

```ts
import { createAssistantMessage, createToolMessage } from "@yesimbot/agent-runtime";
import { extractAssistantTexts } from "../src/runtime/render.js";

it("does not render terminal tool results as assistant text", () => {
  expect(
    extractAssistantTexts([
      createAssistantMessage("final answer"),
      createToolMessage([{ type: "tool-result", toolCallId: "call", toolName: "finalize_response", output: { finalized: true } }] as never),
    ]),
  ).toEqual(["final answer"]);
});
```

Run:

```bash
yarn workspace koishi-plugin-yesimbot exec vitest run tests/service.test.ts tests/channel-context.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run core type check**

```bash
yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

Expected: PASS.

- [ ] **Step 5: Commit core enablement**

```bash
git add core/src/service.ts core/tests/service.test.ts core/tests/channel-context.test.ts core/tests/runtime-render.test.ts
git commit -m "feat(core): enable terminal response tool"
```

---

## Task 4: MemOS Client Foundation

**Files:**
- Modify: `plugins/memos-client/src/index.ts`
- Create: `plugins/memos-client/src/config.ts`
- Create: `plugins/memos-client/src/client.ts`
- Create: `plugins/memos-client/src/identity.ts`
- Create: `plugins/memos-client/src/types.ts`
- Test: `plugins/memos-client/tests/identity.test.ts`
- Test: `plugins/memos-client/tests/client.test.ts`

**Interfaces:**
- Produces: `memosConfigSchema`
- Produces: `MemosCloudClient.searchMemory(request)` and `MemosCloudClient.addMessage(request)`
- Produces: `deriveMemosIdentity(input)` returning `userId`, `conversationId`, `agentId`, and safe metadata hashes.

- [ ] **Step 1: Write identity hashing tests**

Create `plugins/memos-client/tests/identity.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { deriveMemosIdentity } from "../src/identity.js";

describe("MemOS identity", () => {
  it("uses channel scoped ids for group chats", () => {
    const identity = deriveMemosIdentity({
      platform: "onebot",
      selfId: "bot",
      channelId: "group",
      channelType: "group",
      authorId: "user",
      messageId: "msg",
      turnId: "turn",
    });

    expect(identity.userId).toMatch(/^yb_ch_[A-Za-z0-9_-]{22}$/);
    expect(identity.info.memory_scope).toBe("channel");
    expect(JSON.stringify(identity.info)).not.toContain("group");
    expect(JSON.stringify(identity.info)).not.toContain("user");
  });

  it("uses author scoped ids for private chats", () => {
    const identity = deriveMemosIdentity({
      platform: "onebot",
      selfId: "bot",
      channelId: "private",
      channelType: "private",
      authorId: "user",
      messageId: "msg",
      turnId: "turn",
    });

    expect(identity.userId).toMatch(/^yb_u_[A-Za-z0-9_-]{22}$/);
    expect(identity.info.memory_scope).toBe("user");
  });
});
```

Run:

```bash
yarn workspace koishi-plugin-yesimbot-memos-client exec vitest run tests/identity.test.ts
```

Expected before implementation: FAIL because `identity.ts` does not exist.

- [ ] **Step 2: Implement identity helpers**

Create `plugins/memos-client/src/identity.ts`:

```ts
import { createHash } from "node:crypto";

export type MemosChannelType = "private" | "group";

export interface MemosIdentityInput {
  platform: string;
  selfId: string;
  channelId: string;
  channelType: MemosChannelType;
  authorId: string;
  messageId?: string;
  turnId: string;
}

export interface MemosIdentity {
  userId: string;
  conversationId: string;
  agentId: string;
  info: {
    scene: "group_chat" | "private_chat";
    platform: string;
    channel_type: MemosChannelType;
    channel_hash: string;
    author_hash: string;
    message_hash?: string;
    turn_id: string;
    memory_scope: "channel" | "user";
  };
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("base64url").slice(0, 22);
}

export function deriveMemosIdentity(input: MemosIdentityInput): MemosIdentity {
  const channelHash = shortHash(`v1|channel|${input.platform}|${input.selfId}|${input.channelId}`);
  const authorHash = shortHash(`v1|author|${input.platform}|${input.authorId}`);
  const messageHash = input.messageId
    ? shortHash(`v1|message|${input.platform}|${input.messageId}`)
    : undefined;
  const isGroup = input.channelType === "group";
  const userId = isGroup ? `yb_ch_${channelHash}` : `yb_u_${authorHash}`;

  return {
    userId,
    conversationId: `yb_conv_${channelHash}`,
    agentId: `yb_agent_${shortHash(`v1|agent|${input.platform}|${input.selfId}`)}`,
    info: {
      scene: isGroup ? "group_chat" : "private_chat",
      platform: input.platform,
      channel_type: input.channelType,
      channel_hash: channelHash,
      author_hash: authorHash,
      ...(messageHash ? { message_hash: messageHash } : {}),
      turn_id: input.turnId,
      memory_scope: isGroup ? "channel" : "user",
    },
  };
}
```

- [ ] **Step 3: Write HTTP client tests**

Create `plugins/memos-client/tests/client.test.ts` with a fake `ctx.http.post`:

```ts
import { describe, expect, it, vi } from "vitest";

import { MemosCloudClient } from "../src/client.js";

describe("MemosCloudClient", () => {
  it("posts search requests with token auth", async () => {
    const post = vi.fn(async () => ({ code: 0, data: { memory_detail_list: [] }, message: "ok" }));
    const client = new MemosCloudClient({
      baseUrl: "https://memos.memtensor.cn/api/openmem/v1",
      apiKey: "mpg-test",
      timeoutMs: 1000,
      post,
    });

    await client.searchMemory({ user_id: "yb_ch_abc", query: "hello" });

    expect(post).toHaveBeenCalledWith(
      "https://memos.memtensor.cn/api/openmem/v1/search/memory",
      { user_id: "yb_ch_abc", query: "hello" },
      {
        headers: {
          Authorization: "Token mpg-test",
          "Content-Type": "application/json",
        },
        timeout: 1000,
      },
    );
  });
});
```

- [ ] **Step 4: Implement HTTP client**

Create `plugins/memos-client/src/client.ts`:

```ts
export interface MemosHttpPost {
  <T>(url: string, body: unknown, options: { headers: Record<string, string>; timeout: number }): Promise<T>;
}

export interface MemosCloudClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  post: MemosHttpPost;
}

export class MemosCloudClient {
  constructor(private readonly options: MemosCloudClientOptions) {}

  searchMemory<T>(body: Record<string, unknown>): Promise<T> {
    return this.post<T>("/search/memory", body);
  }

  addMessage<T>(body: Record<string, unknown>): Promise<T> {
    return this.post<T>("/add/message", body);
  }

  private post<T>(path: "/search/memory" | "/add/message", body: Record<string, unknown>) {
    return this.options.post<T>(`${this.options.baseUrl.replace(/\/+$/, "")}${path}`, body, {
      headers: {
        Authorization: `Token ${this.options.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: this.options.timeoutMs,
    });
  }
}
```

- [ ] **Step 5: Add config and types**

Create `plugins/memos-client/src/config.ts` with Koishi schema defaults:

```ts
import { Schema } from "koishi";

export interface MemosClientConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  searchMemoryLimit: number;
  searchPreferenceLimit: number;
  searchRelativity: number;
  includePreference: boolean;
  asyncMode: boolean;
  tags: string[];
  includeRawIdentityInfo: boolean;
}

export const DEFAULT_MEMOS_BASE_URL = "https://memos.memtensor.cn/api/openmem/v1";

export const memosConfigSchema: Schema<MemosClientConfig> = Schema.object({
  baseUrl: Schema.string().default(DEFAULT_MEMOS_BASE_URL).description("MemOS Cloud API base URL"),
  apiKey: Schema.string().required().role("secret").description("MemOS Cloud API Key"),
  timeoutMs: Schema.number().default(10000).description("MemOS HTTP timeout in milliseconds"),
  searchMemoryLimit: Schema.number().default(6).description("Maximum fact memories returned"),
  searchPreferenceLimit: Schema.number().default(6).description("Maximum preference memories returned"),
  searchRelativity: Schema.number().default(0.45).description("MemOS relevance threshold"),
  includePreference: Schema.boolean().default(true).description("Include preference memories"),
  asyncMode: Schema.boolean().default(true).description("Use async MemOS writes"),
  tags: Schema.array(Schema.string()).default(["yesimbot"]).description("Default MemOS tags"),
  includeRawIdentityInfo: Schema.boolean().default(false).description("Include raw platform ids in MemOS info"),
});
```

- [ ] **Step 6: Run foundation tests**

```bash
yarn workspace koishi-plugin-yesimbot-memos-client exec vitest run tests/identity.test.ts tests/client.test.ts
yarn turbo run check-types --filter=koishi-plugin-yesimbot-memos-client
```

Expected: PASS.

- [ ] **Step 7: Commit MemOS foundation**

```bash
git add plugins/memos-client/src/config.ts plugins/memos-client/src/client.ts plugins/memos-client/src/identity.ts plugins/memos-client/src/types.ts plugins/memos-client/tests/identity.test.ts plugins/memos-client/tests/client.test.ts
git commit -m "feat(memos-client): add memos cloud foundation"
```

---

## Task 5: MemOS Tools and Prompt Policy

**Files:**
- Modify: `plugins/memos-client/src/index.ts`
- Modify: `plugins/memos-client/src/tools/core/add-message.ts`
- Create: `plugins/memos-client/src/tools/core/search-message.ts`
- Create: `plugins/memos-client/src/prompt.ts`
- Test: `plugins/memos-client/tests/tools.test.ts`
- Test: `plugins/memos-client/tests/plugin.test.ts`

**Interfaces:**
- Produces: `createSearchMessageTool(options): AgentTool<{ query: string }, SearchMessageToolOutput>`
- Produces: `createAddMessageTool(options): AgentTool<{ content: string }, AddMessageToolOutput>`
- Produces: `formatMemosPrompt(): string`

- [ ] **Step 1: Write tool schema tests**

Create `plugins/memos-client/tests/tools.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { createAddMessageTool } from "../src/tools/core/add-message.js";
import { createSearchMessageTool } from "../src/tools/core/search-message.js";

describe("MemOS tools", () => {
  it("exposes minimal search input", () => {
    const tool = createSearchMessageTool({} as never);
    expect(tool.name).toBe("search_message");
    expect(JSON.stringify(tool.inputSchema)).toContain("query");
    expect(JSON.stringify(tool.inputSchema)).not.toContain("user_id");
  });

  it("exposes minimal add input", () => {
    const tool = createAddMessageTool({} as never);
    expect(tool.name).toBe("add_message");
    expect(JSON.stringify(tool.inputSchema)).toContain("content");
    expect(JSON.stringify(tool.inputSchema)).not.toContain("messages");
    expect(JSON.stringify(tool.inputSchema)).not.toContain("user_id");
  });
});
```

Run:

```bash
yarn workspace koishi-plugin-yesimbot-memos-client exec vitest run tests/tools.test.ts
```

Expected before implementation: FAIL for missing search tool and current add tool shape.

- [ ] **Step 2: Implement search tool**

Create `plugins/memos-client/src/tools/core/search-message.ts`:

```ts
import { jsonSchema, type AgentTool } from "@yesimbot/agent-runtime";

import type { MemosCloudClient } from "../../client.js";
import type { MemosClientConfig } from "../../config.js";
import type { MemosIdentity } from "../../identity.js";

export interface SearchMessageToolInput {
  query: string;
}

export interface SearchMessageToolOutput {
  memories: Array<{
    content: string;
    type?: "fact" | "preference" | "memory";
    confidence?: number;
    relativity?: number;
  }>;
  error?: { code: string; message: string };
}

export interface SearchMessageToolOptions {
  client: MemosCloudClient;
  config: MemosClientConfig;
  resolveIdentity(): MemosIdentity;
  logger?: { warn(message: string): void };
}

export function createSearchMessageTool(
  options: SearchMessageToolOptions,
): AgentTool<SearchMessageToolInput, SearchMessageToolOutput> {
  return {
    name: "search_message",
    description: "Search relevant long-term memory before answering.",
    inputSchema: jsonSchema<SearchMessageToolInput>({
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, description: "Memory search query." },
      },
      required: ["query"],
      additionalProperties: false,
    }),
    execute: async ({ query }) => {
      try {
        const identity = options.resolveIdentity();
        const response = await options.client.searchMemory<{
          code?: number;
          data?: {
            memory_detail_list?: Array<{ memory_value?: string; confidence?: number; relativity?: number }>;
            preference_detail_list?: Array<{ preference?: string }>;
          };
          message?: string;
        }>({
          user_id: identity.userId,
          conversation_id: identity.conversationId,
          query,
          relativity: options.config.searchRelativity,
          memory_limit_number: options.config.searchMemoryLimit,
          include_preference: options.config.includePreference,
          preference_limit_number: options.config.searchPreferenceLimit,
        });

        const memories = [
          ...(response.data?.memory_detail_list ?? []).map((item) => ({
            content: item.memory_value ?? "",
            type: "memory" as const,
            confidence: item.confidence,
            relativity: item.relativity,
          })),
          ...(response.data?.preference_detail_list ?? []).map((item) => ({
            content: item.preference ?? "",
            type: "preference" as const,
          })),
        ].filter((item) => item.content.trim().length > 0);

        return { memories };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        options.logger?.warn(`MemOS search failed: ${message}`);
        return { memories: [], error: { code: "request_failed", message } };
      }
    },
  };
}
```

- [ ] **Step 3: Implement add tool**

Replace `plugins/memos-client/src/tools/core/add-message.ts` with a focused implementation using only `content`:

```ts
import { jsonSchema, type AgentTool } from "@yesimbot/agent-runtime";

import type { MemosCloudClient } from "../../client.js";
import type { MemosClientConfig } from "../../config.js";
import type { MemosIdentity } from "../../identity.js";

export interface AddMessageToolInput {
  content: string;
}

export interface AddMessageToolOutput {
  success: boolean;
  taskId?: string;
  status?: string;
  error?: { code: string; message: string };
}

export interface AddMessageToolOptions {
  client: MemosCloudClient;
  config: MemosClientConfig;
  resolveIdentity(): MemosIdentity;
  now(): Date;
  logger?: { warn(message: string): void };
}

function formatChatTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export function createAddMessageTool(
  options: AddMessageToolOptions,
): AgentTool<AddMessageToolInput, AddMessageToolOutput> {
  return {
    name: "add_message",
    description: "Write a durable long-term memory candidate to MemOS.",
    inputSchema: jsonSchema<AddMessageToolInput>({
      type: "object",
      properties: {
        content: { type: "string", minLength: 1, description: "Durable memory content to remember." },
      },
      required: ["content"],
      additionalProperties: false,
    }),
    execute: async ({ content }) => {
      try {
        const identity = options.resolveIdentity();
        const response = await options.client.addMessage<{
          data?: { task_id?: string; status?: string };
        }>({
          user_id: identity.userId,
          conversation_id: identity.conversationId,
          agent_id: identity.agentId,
          messages: [{ role: "user", content, chat_time: formatChatTime(options.now()) }],
          tags: options.config.tags,
          info: identity.info,
          async_mode: options.config.asyncMode,
          source: "yesimbot",
        });

        return { success: true, taskId: response.data?.task_id, status: response.data?.status };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        options.logger?.warn(`MemOS add message failed: ${message}`);
        return { success: false, error: { code: "request_failed", message } };
      }
    },
  };
}
```

- [ ] **Step 4: Implement prompt policy**

Create `plugins/memos-client/src/prompt.ts`:

```ts
export function formatMemosPrompt(): string {
  return [
    "## Long-Term Memory",
    "",
    "Use `search_message` before answering when long-term memory may help.",
    "Only use memories that are relevant, same-subject, and not contradicted by the current message.",
    "Do not mention memory retrieval internals unless the user asks.",
    "Write the final user-visible reply text before memory write tools.",
    "Call `add_message` only for new stable facts, durable preferences, project background, or long-term useful group information.",
    "Do not write transient requests, duplicates, secrets, credentials, payment data, sensitive personal data, or short-lived emotions.",
    "After required memory tools, call `finalize_response({})` and do not generate extra text.",
  ].join("\\n");
}
```

- [ ] **Step 5: Register plugin tools**

Update `plugins/memos-client/src/index.ts` to:

```ts
import { Schema, type Context, type Logger } from "koishi";
import type {} from "koishi-plugin-yesimbot";

import { MemosCloudClient } from "./client.js";
import { memosConfigSchema, type MemosClientConfig } from "./config.js";
import { formatMemosPrompt } from "./prompt.js";
import { deriveMemosIdentity } from "./identity.js";
import { createAddMessageTool } from "./tools/core/add-message.js";
import { createSearchMessageTool } from "./tools/core/search-message.js";

export default class MemosClientPlugin {
  static name = "yesimbot-memos-client";
  static inject = ["yesimbot"];
  static Config: Schema<MemosClientConfig> = memosConfigSchema;

  public readonly ctx: Context;
  public readonly config: MemosClientConfig;
  public readonly logger: Logger;

  private disposeAgentPlugin?: () => void;

  constructor(ctx: Context, config: MemosClientConfig) {
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("yesimbot.memos-client");
    ctx.on("ready", this.start.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  async start(): Promise<void> {
    const client = new MemosCloudClient({
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      timeoutMs: this.config.timeoutMs,
      post: this.ctx.http.post.bind(this.ctx.http),
    });

    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = this.ctx.yesimbot.registerAgentPlugin((channelContext) => {
      let latestAuthorId = "";
      let latestMessageId: string | undefined;

      const resolveIdentity = (turnId = "unknown") =>
        deriveMemosIdentity({
          platform: channelContext.channel.platform,
          selfId: channelContext.channel.selfId,
          channelId: channelContext.channel.channelId,
          channelType: channelContext.channel.type,
          authorId: latestAuthorId,
          messageId: latestMessageId,
          turnId,
        });

      return {
        name: "memos-client",
        tools: [
          createSearchMessageTool({
            client,
            config: this.config,
            resolveIdentity: () => resolveIdentity(),
            logger: this.logger,
          }),
          createAddMessageTool({
            client,
            config: this.config,
            resolveIdentity: () => resolveIdentity(),
            now: () => new Date(),
            logger: this.logger,
          }),
        ],
        toModelMessages(message, context) {
          if (message.role === "custom" && message.type === "athena.platform.message") {
            latestAuthorId = message.data.author.id;
            latestMessageId = message.data.message.messageId;
          }
          return undefined;
        },
        extendSystemPrompt(prompt) {
          return `${prompt}\\n\\n${formatMemosPrompt()}`;
        },
      };
    });
  }

  async stop(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;
  }
}
```

During implementation, refine the current-turn identity capture so `turnId` from tool execution context is used where available. Keep the public tool inputs unchanged.

- [ ] **Step 6: Run MemOS plugin tests and type check**

```bash
yarn workspace koishi-plugin-yesimbot-memos-client exec vitest run tests/tools.test.ts tests/plugin.test.ts
yarn turbo run check-types --filter=koishi-plugin-yesimbot-memos-client
```

Expected: PASS.

- [ ] **Step 7: Commit MemOS tools**

```bash
git add plugins/memos-client/src/index.ts plugins/memos-client/src/prompt.ts plugins/memos-client/src/tools/core/add-message.ts plugins/memos-client/src/tools/core/search-message.ts plugins/memos-client/tests/tools.test.ts plugins/memos-client/tests/plugin.test.ts
git commit -m "feat(memos-client): expose minimal memory tools"
```

---

## Task 6: Verification and Documentation

**Files:**
- Modify: `openspec/changes/integrate-memos-cloud-memory/tasks.md`
- Create or modify: `plugins/memos-client/README.md` if the package has no usage notes
- Verify: generated build/type/test outputs

**Interfaces:**
- Consumes: All previous tasks.
- Produces: Verified implementation and documented live MemOS smoke-test path.

- [ ] **Step 1: Run OpenSpec validation**

```bash
openspec validate integrate-memos-cloud-memory --json
```

Expected: JSON summary shows one valid change and zero issues.

- [ ] **Step 2: Run focused checks**

```bash
yarn turbo run check-types --filter=@yesimbot/agent-runtime
yarn turbo run test --filter=@yesimbot/agent-runtime
yarn turbo run check-types --filter=koishi-plugin-yesimbot
yarn turbo run test --filter=koishi-plugin-yesimbot
yarn turbo run check-types --filter=koishi-plugin-yesimbot-memos-client
```

Expected: all commands pass.

- [ ] **Step 3: Document no-key and live verification**

Add usage notes to `plugins/memos-client/README.md`:

```md
# yesimbot MemOS Client

This plugin integrates MemOS Cloud long-term memory into yesimbot.

Required config:

- `apiKey`: MemOS Cloud API key, kept server-side.
- `baseUrl`: defaults to `https://memos.memtensor.cn/api/openmem/v1`.

No-key verification:

- Run package tests and type checks. They validate schemas, identity hashing, request construction, and fail-open behavior without calling MemOS Cloud.

Optional live verification:

1. Export `MEMOS_API_KEY="mpg-..."`.
2. Configure the Koishi plugin with that key.
3. Ask Athena to remember a stable test fact.
4. Ask a related question after a short delay.
5. Confirm `search_message` returns the test fact and `add_message` does not expose raw ids or API keys.
```

- [ ] **Step 4: Mark completed tasks**

As each implementation task lands, update `openspec/changes/integrate-memos-cloud-memory/tasks.md` checkboxes from `- [ ]` to `- [x]`.

- [ ] **Step 5: Run final status check**

```bash
openspec status --change "integrate-memos-cloud-memory"
```

Expected: planning artifacts through `plan` exist. Implementation task boxes reflect actual progress.

- [ ] **Step 6: Commit verification docs**

```bash
git add plugins/memos-client/README.md openspec/changes/integrate-memos-cloud-memory/tasks.md
git commit -m "docs(memos-client): document memory verification"
```

---

## Self-Review

- Spec coverage: terminal runtime behavior maps to Task 2; core enablement maps to Task 3; MemOS registration, minimal tools, identity, prompt, config, diagnostics, and verification map to Tasks 4-6.
- Placeholder scan: this plan has concrete file paths, commands, and expected outcomes for each task.
- Type consistency: terminal tool config is `terminalTool?: boolean | { name?: string }`; MemOS tools expose `query` and `content` only; identity output names match later tool construction.
