# Tool Call Observer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional YesImBot Koishi plugin that immediately reports tool calls to chat and can opt in to TOON-compress JSON-like tool results for the model.

**Architecture:** Keep detailed tool payload observation in an external plugin registered through `ctx.yesimbot.registerAgentPlugin()`. Use runtime `beforeToolCall` for timing and `afterToolCall` for notification/result replacement. Touch agent-runtime only for the narrow failed-tool `afterToolCall` observability contract.

**Tech Stack:** TypeScript, Koishi 4, `@yesimbot/agent-runtime`, Yarn 4 workspaces, Vitest, pkgroll, oxlint/oxfmt.

## Global Constraints

- Use `yarn` commands through `rtk`, not `npm` or `pnpm`.
- Do not expose Koishi `Session`, Koishi `Context`, runtime handles, or large tool payloads through core service APIs.
- `compressJsonToolResults` is behavior-changing and must remain disabled by default.
- Default ignored tools must include `finalize_response`.
- Do not commit unless the user explicitly asks for commits; commit checkpoints below are review boundaries only.

---

## File Structure

- Modify: `packages/agent-runtime/src/agent.ts` for failed-tool `afterToolCall` invocation.
- Modify: `packages/agent-runtime/tests/tools.test.ts` for failed-tool hook regression coverage.
- Create: `plugins/tool-observer/package.json` for workspace package metadata.
- Create: `plugins/tool-observer/tsconfig.json` for package type checking.
- Create: `plugins/tool-observer/src/index.ts` for Koishi plugin registration, config schema, and hook wiring.
- Create: `plugins/tool-observer/src/format.ts` for JSON-like detection, redaction, TOON formatting, safe previews, and truncation.
- Create: `plugins/tool-observer/src/send.ts` for a small adapter around `unsafeBot.sendMessage()` with timeout/error isolation.
- Create: `plugins/tool-observer/tests/format.test.ts` for formatter, redaction, truncation, and JSON-like detection tests.
- Create: `plugins/tool-observer/tests/plugin.test.ts` for registration, notifications, ignored tools, send failures, and result compression tests.

---

### Task 1: Runtime Failed Tool Hook Observability

**Files:**
- Modify: `packages/agent-runtime/src/agent.ts`
- Modify: `packages/agent-runtime/tests/tools.test.ts`

**Interfaces:**
- Consumes: existing `pluginHost.helpers.afterToolCall(result, context)`.
- Produces: failed tool calls invoke `afterToolCall` with `ToolResultContext` where `isError: true` and `result` is `createDiagnostic(error)`.

- [ ] **Step 1: Add a failing regression test for failed tool hook context**

Add or update a test in `packages/agent-runtime/tests/tools.test.ts`:

```ts
it("reports failed tool calls to after hooks", async () => {
  const seen: unknown[] = [];
  const agent = createAgent({
    model: createSingleToolCallModel(),
    plugins: [
      {
        name: "failing-tool",
        tools: [
          {
            name: "inspect",
            inputSchema: z.object({}),
            execute: async () => {
              throw new Error("inspect boom");
            },
          },
        ],
      },
      {
        name: "observer",
        afterToolCall(result) {
          seen.push(result);
        },
      },
    ],
  });

  const turnId = agent.send(createUserMessage("hello"));

  await expect(agent.waitTurn(turnId)).resolves.toMatchObject({ status: "done" });
  expect(seen).toEqual([
    {
      toolCallId: "call_1",
      toolName: "inspect",
      args: {},
      result: expect.objectContaining({ name: "Error", message: "inspect boom" }),
      isError: true,
    },
  ]);
});
```

- [ ] **Step 2: Run the targeted failing test**

Run: `rtk yarn workspace @yesimbot/agent-runtime exec vitest run tests/tools.test.ts -t "reports failed tool calls to after hooks"`

Expected before the fix: FAIL because `seen` is empty or does not include the failed result context.

- [ ] **Step 3: Patch failed tool execution to call `afterToolCall`**

In `packages/agent-runtime/src/agent.ts`, update the `catch (error)` block inside wrapped tool execution to call `afterToolCall` before emitting `tool.failed` and rethrowing:

```ts
} catch (error) {
  const diagnostic = createDiagnostic(error);

  await pluginHost.helpers.afterToolCall(
    {
      toolCallId: options.toolCallId,
      toolName,
      args: nextInput,
      result: diagnostic,
      isError: true,
    },
    hookContext,
  );

  await emitInternal({
    type: "tool.failed",
    turnId,
    toolName,
    toolCallId: options.toolCallId,
    error: diagnostic,
  });
  throw error;
}
```

- [ ] **Step 4: Add fail-open coverage for failed-tool `afterToolCall` errors**

Add a test in `packages/agent-runtime/tests/tools.test.ts`:

```ts
it("fails open when after hook throws while observing a failed tool", async () => {
  const pluginErrors: string[] = [];
  const agent = createAgent({
    model: createSingleToolCallModel(),
    plugins: [
      {
        name: "failing-tool",
        tools: [
          {
            name: "inspect",
            inputSchema: z.object({}),
            execute: async () => {
              throw new Error("inspect boom");
            },
          },
        ],
      },
      {
        name: "broken-observer",
        afterToolCall() {
          throw new Error("observer boom");
        },
      },
    ],
  });

  agent.channel.subscribe("internal", (event) => {
    if (event.type === "plugin.error") {
      pluginErrors.push(`${event.plugin}:${event.error.message}`);
    }
  });

  const turnId = agent.send(createUserMessage("hello"));

  await expect(agent.waitTurn(turnId)).resolves.toMatchObject({ status: "done" });
  expect(pluginErrors).toContain("broken-observer:observer boom");
});
```

- [ ] **Step 5: Verify runtime tests pass**

Run: `rtk yarn workspace @yesimbot/agent-runtime exec vitest run tests/tools.test.ts`

Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Inspect: `rtk git diff -- packages/agent-runtime/src/agent.ts packages/agent-runtime/tests/tools.test.ts`

Commit only if explicitly requested by the user.

---

### Task 2: Tool Observer Package Shell

**Files:**
- Create: `plugins/tool-observer/package.json`
- Create: `plugins/tool-observer/tsconfig.json`
- Create: `plugins/tool-observer/src/index.ts`
- Create: `plugins/tool-observer/tests/plugin.test.ts`

**Interfaces:**
- Produces: `ToolObserverConfig`, default config constants, and a Koishi plugin class with `static name = "yesimbot-tool-observer"`.
- Produces: an `AgentPlugin` named `tool-observer` registered per channel runtime.

- [ ] **Step 1: Create package metadata**

Create `plugins/tool-observer/package.json`:

```json
{
  "name": "koishi-plugin-yesimbot-tool-observer",
  "version": "0.0.1",
  "files": ["dist"],
  "type": "module",
  "main": "./dist/index.cjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "require": "./dist/index.cjs"
    },
    "./package.json": "./package.json"
  },
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  },
  "scripts": {
    "build": "npx pkgroll",
    "check-types": "tsc --noEmit",
    "clean": "rimraf dist && rimraf tsconfig.tsbuildinfo",
    "fmt": "oxfmt",
    "lint": "oxlint",
    "pub": "yarn npm publish --access public",
    "test": "vitest run"
  },
  "devDependencies": {
    "@yesimbot/agent-runtime": "workspace:^",
    "koishi": "^4.18.10",
    "koishi-plugin-yesimbot": "workspace:^",
    "vitest": "^4.0.18"
  },
  "peerDependencies": {
    "@yesimbot/agent-runtime": "workspace:^",
    "koishi": "^4.18.10",
    "koishi-plugin-yesimbot": "workspace:^"
  },
  "koishi": {
    "description": {
      "zh": "YesImBot 工具调用观察插件",
      "en": "YesImBot tool call observer plugin"
    }
  }
}
```

- [ ] **Step 2: Create package tsconfig**

Create `plugins/tool-observer/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist",
    "tsBuildInfoFile": "tsconfig.tsbuildinfo"
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Write failing registration test**

Create `plugins/tool-observer/tests/plugin.test.ts` with the initial registration test:

```ts
import type { AgentPlugin } from "@yesimbot/agent-runtime";
import { describe, expect, it, vi } from "vitest";

import ToolObserverPlugin from "../src/index.js";

function createMockContext() {
  const readyHandlers: Array<() => void | Promise<void>> = [];
  const disposeHandlers: Array<() => void | Promise<void>> = [];
  const disposeAgentPlugin = vi.fn();
  const registerAgentPlugin = vi.fn<(factory: (context: never) => AgentPlugin) => () => void>(
    () => disposeAgentPlugin,
  );

  return {
    ctx: {
      logger: vi.fn(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() })),
      on: vi.fn((event: string, handler: () => void | Promise<void>) => {
        if (event === "ready") readyHandlers.push(handler);
        if (event === "dispose") disposeHandlers.push(handler);
      }),
      yesimbot: { registerAgentPlugin },
    },
    readyHandlers,
    disposeHandlers,
    registerAgentPlugin,
    disposeAgentPlugin,
  };
}

describe("tool observer plugin", () => {
  it("registers and disposes an agent plugin factory", async () => {
    const harness = createMockContext();

    new ToolObserverPlugin(harness.ctx as never, {});
    await harness.readyHandlers[0]?.();

    expect(harness.registerAgentPlugin).toHaveBeenCalledOnce();

    await harness.disposeHandlers[0]?.();
    expect(harness.disposeAgentPlugin).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 4: Run the failing plugin test**

Run: `rtk yarn workspace koishi-plugin-yesimbot-tool-observer exec vitest run tests/plugin.test.ts`

Expected before implementation: FAIL because the package and plugin do not exist or registration is missing.

- [ ] **Step 5: Implement plugin shell**

Create `plugins/tool-observer/src/index.ts`:

```ts
import type { AgentPlugin, ToolCallContext, ToolResultContext } from "@yesimbot/agent-runtime";
import { Context, Logger, Schema } from "koishi";
import type {} from "koishi-plugin-yesimbot";

export interface ToolObserverConfig {
  enabled?: boolean;
  displayArgs?: boolean;
  displayResult?: boolean;
  displayMaxChars?: number;
  ignoredTools?: string[];
  redactKeys?: string[];
  compressJsonToolResults?: boolean;
  compressedResultMaxChars?: number;
  sendTimeoutMs?: number;
}

const DEFAULT_IGNORED_TOOLS = ["finalize_response"];
const DEFAULT_REDACT_KEYS = ["apiKey", "authorization", "password", "secret", "token"];

export default class ToolObserverPlugin {
  static name = "yesimbot-tool-observer";
  static inject = ["yesimbot"];
  static usage = "工具调用观察插件，向聊天窗口展示工具调用摘要";
  static Config: Schema<ToolObserverConfig> = Schema.object({
    enabled: Schema.boolean().default(true).description("启用工具调用观察"),
    displayArgs: Schema.boolean().default(true).description("展示工具参数概览"),
    displayResult: Schema.boolean().default(true).description("展示工具结果概览"),
    displayMaxChars: Schema.number().default(1200).description("聊天展示的单段最大字符数"),
    ignoredTools: Schema.array(Schema.string())
      .default(DEFAULT_IGNORED_TOOLS)
      .description("不展示的工具名"),
    redactKeys: Schema.array(Schema.string())
      .default(DEFAULT_REDACT_KEYS)
      .description("需要隐藏的参数或结果字段名"),
    compressJsonToolResults: Schema.boolean()
      .default(false)
      .description("将 JSON-like 工具结果压缩为 TOON 字符串后返回给模型"),
    compressedResultMaxChars: Schema.number().default(8000).description("压缩结果最大字符数"),
    sendTimeoutMs: Schema.number().default(5000).description("发送观察消息的超时时间"),
  });

  public readonly ctx: Context;
  public readonly config: Required<ToolObserverConfig>;
  public readonly logger: Logger;

  private disposeAgentPlugin?: () => void;

  constructor(ctx: Context, config: ToolObserverConfig) {
    this.ctx = ctx;
    this.config = {
      enabled: config.enabled ?? true,
      displayArgs: config.displayArgs ?? true,
      displayResult: config.displayResult ?? true,
      displayMaxChars: config.displayMaxChars ?? 1200,
      ignoredTools: config.ignoredTools ?? DEFAULT_IGNORED_TOOLS,
      redactKeys: config.redactKeys ?? DEFAULT_REDACT_KEYS,
      compressJsonToolResults: config.compressJsonToolResults ?? false,
      compressedResultMaxChars: config.compressedResultMaxChars ?? 8000,
      sendTimeoutMs: config.sendTimeoutMs ?? 5000,
    };
    this.logger = ctx.logger("yesimbot.tool-observer");
    ctx.on("ready", this.start.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  async start(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;

    if (!this.config.enabled) {
      return;
    }

    this.disposeAgentPlugin = this.ctx.yesimbot.registerAgentPlugin((channelContext) => {
      const calls = new Map<string, { startedAt: number; args: unknown }>();

      return {
        name: "tool-observer",
        beforeToolCall: (call: ToolCallContext) => {
          calls.set(call.toolCallId, { startedAt: Date.now(), args: call.args });
          return { type: "allow" };
        },
        afterToolCall: async (result: ToolResultContext) => {
          calls.delete(result.toolCallId);
          void channelContext;
          return undefined;
        },
      } satisfies AgentPlugin;
    });
  }

  async stop(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;
  }
}
```

- [ ] **Step 6: Verify package shell**

Run: `rtk yarn workspace koishi-plugin-yesimbot-tool-observer exec vitest run tests/plugin.test.ts`

Expected: PASS.

- [ ] **Step 7: Review checkpoint**

Inspect: `rtk git diff -- plugins/tool-observer/package.json plugins/tool-observer/tsconfig.json plugins/tool-observer/src/index.ts plugins/tool-observer/tests/plugin.test.ts`

Commit only if explicitly requested by the user.

---

### Task 3: Formatting, TOON, Redaction, And Limits

**Files:**
- Create: `plugins/tool-observer/src/format.ts`
- Create: `plugins/tool-observer/tests/format.test.ts`
- Modify: `plugins/tool-observer/src/index.ts`

**Interfaces:**
- Produces: `isJsonLike(value: unknown): value is JsonValue`.
- Produces: `redactJsonLike(value: JsonValue, keys: readonly string[]): JsonValue`.
- Produces: `formatPreview(value: unknown, options: PreviewOptions): string`.
- Produces: `formatToon(value: JsonValue): string`.

- [ ] **Step 1: Write formatter tests**

Create `plugins/tool-observer/tests/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { formatPreview, formatToon, isJsonLike, redactJsonLike } from "../src/format.js";

describe("tool observer formatting", () => {
  it("detects JSON-like values", () => {
    expect(isJsonLike({ query: "koishi", limit: 3 })).toBe(true);
    expect(isJsonLike([{ title: "A" }])).toBe(true);
    expect(isJsonLike("plain text")).toBe(false);
    expect(isJsonLike(new Date())).toBe(false);
  });

  it("redacts configured keys recursively", () => {
    expect(
      redactJsonLike(
        { token: "abc", nested: { apiKey: "secret", keep: "ok" } },
        ["token", "apiKey"],
      ),
    ).toEqual({ token: "[redacted]", nested: { apiKey: "[redacted]", keep: "ok" } });
  });

  it("formats objects as compact TOON", () => {
    expect(formatToon({ query: "koishi", limit: 3 })).toBe("query: koishi\nlimit: 3");
  });

  it("formats arrays as compact TOON", () => {
    expect(formatToon([{ title: "A" }, { title: "B" }])).toBe(
      "items[2]:\n  - title: A\n  - title: B",
    );
  });

  it("truncates long previews", () => {
    expect(
      formatPreview({ text: "abcdef" }, { maxChars: 10, redactKeys: [] }),
    ).toBe("text: abc...\n[truncated]");
  });
});
```

- [ ] **Step 2: Run formatter tests to verify failure**

Run: `rtk yarn workspace koishi-plugin-yesimbot-tool-observer exec vitest run tests/format.test.ts`

Expected before implementation: FAIL because `src/format.ts` does not exist.

- [ ] **Step 3: Implement formatter module**

Create `plugins/tool-observer/src/format.ts`:

```ts
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface PreviewOptions {
  maxChars: number;
  redactKeys: readonly string[];
}

const REDACTED = "[redacted]";

export function isJsonLike(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (typeof value === "string") return false;
  if (Array.isArray(value)) return value.every(isJsonLike);
  if (!isPlainObject(value)) return false;
  return Object.values(value).every((entry) => typeof entry !== "string" || isJsonLikeString(entry)) &&
    Object.values(value).every(isJsonLikeObjectValue);
}

function isJsonLikeObjectValue(value: unknown): value is JsonValue {
  if (typeof value === "string") return true;
  return isJsonLike(value);
}

function isJsonLikeString(_value: string): boolean {
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function redactJsonLike(value: JsonValue, keys: readonly string[]): JsonValue {
  const normalized = new Set(keys.map((key) => key.toLowerCase()));
  return redact(value, normalized);
}

function redact(value: JsonValue, keys: ReadonlySet<string>): JsonValue {
  if (Array.isArray(value)) return value.map((entry) => redact(entry, keys));
  if (!isRecord(value)) return value;

  const next: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = keys.has(key.toLowerCase()) ? REDACTED : redact(entry, keys);
  }
  return next;
}

function isRecord(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function formatPreview(value: unknown, options: PreviewOptions): string {
  const formatted = isJsonLike(value)
    ? formatToon(redactJsonLike(value, options.redactKeys))
    : safeText(value);
  return truncate(formatted, options.maxChars);
}

export function formatToon(value: JsonValue): string {
  return formatValue(value, 0, "items");
}

function formatValue(value: JsonValue, indent: number, arrayName: string): string {
  if (Array.isArray(value)) {
    const prefix = `${arrayName}[${value.length}]:`;
    if (value.length === 0) return `${arrayName}[0]: []`;
    return [prefix, ...value.map((entry) => `${spaces(indent + 2)}- ${formatValue(entry, indent + 2, "items").replace(/\n/g, `\n${spaces(indent + 4)}`)}`)].join("\n");
  }

  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, entry]) => {
        if (Array.isArray(entry) || isRecord(entry)) {
          return `${spaces(indent)}${key}:\n${spaces(indent + 2)}${formatValue(entry, indent + 2, key).replace(/\n/g, `\n${spaces(indent + 2)}`)}`;
        }
        return `${spaces(indent)}${key}: ${formatScalar(entry)}`;
      })
      .join("\n");
  }

  return formatScalar(value);
}

function formatScalar(value: JsonPrimitive): string {
  if (value === null) return "null";
  return String(value);
}

function spaces(count: number): string {
  return " ".repeat(count);
}

function safeText(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 15))}...\n[truncated]`;
}
```

- [ ] **Step 4: Run and adjust formatter tests**

Run: `rtk yarn workspace koishi-plugin-yesimbot-tool-observer exec vitest run tests/format.test.ts`

Expected: PASS after adjusting exact indentation only if the implementation output is intentionally clearer and the tests are updated to match that deterministic output.

- [ ] **Step 5: Export formatter use points from plugin**

Update `plugins/tool-observer/src/index.ts` imports for later tasks:

```ts
import { formatPreview, formatToon, isJsonLike, redactJsonLike } from "./format.js";
```

Expected: TypeScript imports resolve.

- [ ] **Step 6: Review checkpoint**

Inspect: `rtk git diff -- plugins/tool-observer/src/format.ts plugins/tool-observer/tests/format.test.ts plugins/tool-observer/src/index.ts`

Commit only if explicitly requested by the user.

---

### Task 4: Immediate Chat Notifications

**Files:**
- Create: `plugins/tool-observer/src/send.ts`
- Modify: `plugins/tool-observer/src/index.ts`
- Modify: `plugins/tool-observer/tests/plugin.test.ts`

**Interfaces:**
- Produces: `sendToolObserverMessage(bot: unknown, channelId: string, content: string, timeoutMs: number): Promise<void>`.
- Consumes: `formatPreview()` from Task 3.

- [ ] **Step 1: Add notification behavior tests**

Extend `plugins/tool-observer/tests/plugin.test.ts` with a factory helper and notification test:

```ts
it("sends one notification after a successful non-ignored tool call", async () => {
  const harness = createMockContext();
  const sendMessage = vi.fn(async () => undefined);

  new ToolObserverPlugin(harness.ctx as never, { displayMaxChars: 200 });
  await harness.readyHandlers[0]?.();

  const factory = harness.registerAgentPlugin.mock.calls[0]?.[0];
  const plugin = factory?.({
    channel: { platform: "onebot", selfId: "bot", channelId: "group", type: "group" },
    platform: { name: "onebot", unsafeBot: { sendMessage } },
  } as never);

  await plugin?.beforeToolCall?.(
    { toolCallId: "call_1", toolName: "web_search", args: { query: "koishi" } },
    { turnId: "turn_1" } as never,
  );
  await plugin?.afterToolCall?.(
    {
      toolCallId: "call_1",
      toolName: "web_search",
      args: { query: "koishi" },
      result: { items: [{ title: "Koishi" }] },
      isError: false,
    },
    { turnId: "turn_1" } as never,
  );

  expect(sendMessage).toHaveBeenCalledWith(
    "group",
    expect.stringContaining("web_search"),
  );
  expect(sendMessage.mock.calls[0]?.[1]).toContain("status: success");
  expect(sendMessage.mock.calls[0]?.[1]).toContain("query: koishi");
  expect(sendMessage.mock.calls[0]?.[1]).toContain("items:");
});
```

- [ ] **Step 2: Add ignored and send-failure tests**

Add tests in `plugins/tool-observer/tests/plugin.test.ts`:

```ts
it("does not notify ignored tools", async () => {
  const harness = createMockContext();
  const sendMessage = vi.fn(async () => undefined);

  new ToolObserverPlugin(harness.ctx as never, { ignoredTools: ["finalize_response"] });
  await harness.readyHandlers[0]?.();

  const plugin = harness.registerAgentPlugin.mock.calls[0]?.[0]?.({
    channel: { platform: "onebot", selfId: "bot", channelId: "group", type: "group" },
    platform: { name: "onebot", unsafeBot: { sendMessage } },
  } as never);

  await plugin?.afterToolCall?.(
    { toolCallId: "call_1", toolName: "finalize_response", args: {}, result: { ok: true }, isError: false },
    { turnId: "turn_1" } as never,
  );

  expect(sendMessage).not.toHaveBeenCalled();
});

it("does not fail the hook when notification send fails", async () => {
  const harness = createMockContext();
  const sendMessage = vi.fn(async () => {
    throw new Error("send boom");
  });

  new ToolObserverPlugin(harness.ctx as never, {});
  await harness.readyHandlers[0]?.();

  const plugin = harness.registerAgentPlugin.mock.calls[0]?.[0]?.({
    channel: { platform: "onebot", selfId: "bot", channelId: "group", type: "group" },
    platform: { name: "onebot", unsafeBot: { sendMessage } },
  } as never);

  await expect(
    plugin?.afterToolCall?.(
      { toolCallId: "call_1", toolName: "web_search", args: {}, result: { ok: true }, isError: false },
      { turnId: "turn_1" } as never,
    ),
  ).resolves.toBeUndefined();
});
```

- [ ] **Step 3: Run notification tests to verify failure**

Run: `rtk yarn workspace koishi-plugin-yesimbot-tool-observer exec vitest run tests/plugin.test.ts`

Expected before implementation: FAIL because `afterToolCall` does not send notifications.

- [ ] **Step 4: Implement send helper**

Create `plugins/tool-observer/src/send.ts`:

```ts
interface MessageBot {
  sendMessage(channelId: string, content: string): Promise<unknown> | unknown;
}

function isMessageBot(bot: unknown): bot is MessageBot {
  return typeof bot === "object" && bot !== null && "sendMessage" in bot;
}

export async function sendToolObserverMessage(
  bot: unknown,
  channelId: string,
  content: string,
  timeoutMs: number,
): Promise<void> {
  if (!isMessageBot(bot)) {
    throw new Error("Current platform bot cannot send proactive messages");
  }

  await withTimeout(Promise.resolve(bot.sendMessage(channelId, content)), timeoutMs);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Tool observer message send timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
```

- [ ] **Step 5: Implement notification rendering in `afterToolCall`**

Update `plugins/tool-observer/src/index.ts` to use `formatPreview()` and `sendToolObserverMessage()`:

```ts
function isIgnored(toolName: string, ignoredTools: readonly string[]): boolean {
  return ignoredTools.includes(toolName);
}

function buildNotification(options: {
  toolName: string;
  status: "success" | "error";
  elapsedMs: number;
  args: unknown;
  result: unknown;
  config: Required<ToolObserverConfig>;
}): string {
  const lines = [
    `Tool call: ${options.toolName}`,
    `status: ${options.status}`,
    `elapsedMs: ${options.elapsedMs}`,
  ];

  if (options.config.displayArgs) {
    lines.push("", "args:", formatPreview(options.args, {
      maxChars: options.config.displayMaxChars,
      redactKeys: options.config.redactKeys,
    }));
  }

  if (options.config.displayResult) {
    lines.push("", "result:", formatPreview(options.result, {
      maxChars: options.config.displayMaxChars,
      redactKeys: options.config.redactKeys,
    }));
  }

  return lines.join("\n");
}
```

Inside `afterToolCall`, before result compression logic:

```ts
if (isIgnored(result.toolName, this.config.ignoredTools)) {
  calls.delete(result.toolCallId);
  return undefined;
}

const started = calls.get(result.toolCallId);
calls.delete(result.toolCallId);
const elapsedMs = started ? Date.now() - started.startedAt : 0;
const message = buildNotification({
  toolName: result.toolName,
  status: result.isError ? "error" : "success",
  elapsedMs,
  args: result.args,
  result: result.result,
  config: this.config,
});

try {
  await sendToolObserverMessage(
    channelContext.platform.unsafeBot,
    channelContext.channel.channelId,
    message,
    this.config.sendTimeoutMs,
  );
} catch (error) {
  this.logger.warn(`Tool observer notification failed: ${error instanceof Error ? error.message : String(error)}`);
}
```

- [ ] **Step 6: Verify notification tests pass**

Run: `rtk yarn workspace koishi-plugin-yesimbot-tool-observer exec vitest run tests/plugin.test.ts`

Expected: PASS.

- [ ] **Step 7: Review checkpoint**

Inspect: `rtk git diff -- plugins/tool-observer/src/index.ts plugins/tool-observer/src/send.ts plugins/tool-observer/tests/plugin.test.ts`

Commit only if explicitly requested by the user.

---

### Task 5: Optional Model-Visible TOON Compression

**Files:**
- Modify: `plugins/tool-observer/src/index.ts`
- Modify: `plugins/tool-observer/tests/plugin.test.ts`

**Interfaces:**
- Consumes: `isJsonLike()`, `redactJsonLike()`, and `formatToon()` from Task 3.
- Produces: `afterToolCall` returns `{ result: string }` only for configured, successful, JSON-like, non-ignored tool results.

- [ ] **Step 1: Add default non-rewriting test**

Add to `plugins/tool-observer/tests/plugin.test.ts`:

```ts
it("does not rewrite tool results by default", async () => {
  const harness = createMockContext();
  const sendMessage = vi.fn(async () => undefined);

  new ToolObserverPlugin(harness.ctx as never, {});
  await harness.readyHandlers[0]?.();

  const plugin = harness.registerAgentPlugin.mock.calls[0]?.[0]?.({
    channel: { platform: "onebot", selfId: "bot", channelId: "group", type: "group" },
    platform: { name: "onebot", unsafeBot: { sendMessage } },
  } as never);

  await expect(
    plugin?.afterToolCall?.(
      { toolCallId: "call_1", toolName: "web_search", args: {}, result: { items: [{ title: "A" }] }, isError: false },
      { turnId: "turn_1" } as never,
    ),
  ).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Add opt-in compression tests**

Add to `plugins/tool-observer/tests/plugin.test.ts`:

```ts
it("rewrites JSON-like successful results when compression is enabled", async () => {
  const harness = createMockContext();
  const sendMessage = vi.fn(async () => undefined);

  new ToolObserverPlugin(harness.ctx as never, { compressJsonToolResults: true });
  await harness.readyHandlers[0]?.();

  const plugin = harness.registerAgentPlugin.mock.calls[0]?.[0]?.({
    channel: { platform: "onebot", selfId: "bot", channelId: "group", type: "group" },
    platform: { name: "onebot", unsafeBot: { sendMessage } },
  } as never);

  await expect(
    plugin?.afterToolCall?.(
      { toolCallId: "call_1", toolName: "web_search", args: {}, result: { items: [{ title: "A" }] }, isError: false },
      { turnId: "turn_1" } as never,
    ),
  ).resolves.toEqual({ result: expect.stringContaining("items:") });
});

it("does not rewrite failed or non-JSON-like results", async () => {
  const harness = createMockContext();
  const sendMessage = vi.fn(async () => undefined);

  new ToolObserverPlugin(harness.ctx as never, { compressJsonToolResults: true });
  await harness.readyHandlers[0]?.();

  const plugin = harness.registerAgentPlugin.mock.calls[0]?.[0]?.({
    channel: { platform: "onebot", selfId: "bot", channelId: "group", type: "group" },
    platform: { name: "onebot", unsafeBot: { sendMessage } },
  } as never);

  await expect(
    plugin?.afterToolCall?.(
      { toolCallId: "call_1", toolName: "web_search", args: {}, result: "plain text", isError: false },
      { turnId: "turn_1" } as never,
    ),
  ).resolves.toBeUndefined();

  await expect(
    plugin?.afterToolCall?.(
      { toolCallId: "call_2", toolName: "web_search", args: {}, result: { name: "Error" }, isError: true },
      { turnId: "turn_1" } as never,
    ),
  ).resolves.toBeUndefined();
});
```

- [ ] **Step 3: Run compression tests to verify failure**

Run: `rtk yarn workspace koishi-plugin-yesimbot-tool-observer exec vitest run tests/plugin.test.ts -t "rewrite"`

Expected before implementation: FAIL because compression does not return patches.

- [ ] **Step 4: Implement compression patch logic**

Add a helper in `plugins/tool-observer/src/index.ts`:

```ts
function createCompressedResult(
  result: ToolResultContext,
  config: Required<ToolObserverConfig>,
): { result: string } | undefined {
  if (!config.compressJsonToolResults || result.isError || !isJsonLike(result.result)) {
    return undefined;
  }

  const redacted = redactJsonLike(result.result, config.redactKeys);
  const toon = formatToon(redacted);
  if (toon.length > config.compressedResultMaxChars) {
    return { result: `${toon.slice(0, Math.max(0, config.compressedResultMaxChars - 15))}...\n[truncated]` };
  }
  return { result: toon };
}
```

At the end of `afterToolCall`, return the helper result:

```ts
return createCompressedResult(result, this.config);
```

- [ ] **Step 5: Verify compression tests pass**

Run: `rtk yarn workspace koishi-plugin-yesimbot-tool-observer exec vitest run tests/plugin.test.ts`

Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Inspect: `rtk git diff -- plugins/tool-observer/src/index.ts plugins/tool-observer/tests/plugin.test.ts`

Commit only if explicitly requested by the user.

---

### Task 6: Documentation And Verification

**Files:**
- Modify: `plugins/tool-observer/package.json`
- Create or modify: package README only if existing package convention requires one.
- Modify: implementation files only for fixes found by verification.

**Interfaces:**
- Produces: package-scoped verification evidence for tests, types, and build.

- [ ] **Step 1: Add concise package usage text if package convention needs it**

If other plugin packages do not have READMEs, keep documentation in `static usage` and Koishi schema descriptions only. If adding `plugins/tool-observer/README.md`, include exactly this content:

```md
# koishi-plugin-yesimbot-tool-observer

Optional YesImBot plugin that reports each visible tool call to the chat after it completes.

By default the plugin only observes and displays tool calls. `compressJsonToolResults` is disabled by default because it rewrites JSON-like tool results into TOON strings before the model sees them.
```

- [ ] **Step 2: Run package tests**

Run: `rtk yarn turbo run test --filter=koishi-plugin-yesimbot-tool-observer`

Expected: PASS.

- [ ] **Step 3: Run package type check**

Run: `rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-tool-observer`

Expected: PASS.

- [ ] **Step 4: Run affected runtime tests**

Run: `rtk yarn workspace @yesimbot/agent-runtime exec vitest run tests/tools.test.ts`

Expected: PASS.

- [ ] **Step 5: Run affected builds if tests or type resolution need built outputs**

Run: `rtk yarn turbo run build --filter=@yesimbot/agent-runtime --filter=koishi-plugin-yesimbot-tool-observer`

Expected: PASS.

- [ ] **Step 6: Final diff review**

Run: `rtk git diff --stat`

Expected: Changes are limited to `packages/agent-runtime` failed-hook handling/tests and the new `plugins/tool-observer` package.

- [ ] **Step 7: Review checkpoint**

Commit only if explicitly requested by the user.
