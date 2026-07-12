# Agent Runtime Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new `@yesimbot/agent-runtime` package that implements the approved `ai-sdk`-based runtime, plugin lifecycle, append-only storage, turn lifecycle, and compact/audit dogfood plugins.

**Architecture:** Create a new package under `packages/agent-runtime` without changing `core` or the existing `packages/agent`. The runtime core owns message construction helpers, append pipeline, queue, model/tool execution, state, channel, and plugin orchestration; compact, audit, retry policy, session policy, and host integration stay outside core. The implementation proceeds test-first by stabilizing public types and primitives before model execution.

**Tech Stack:** TypeScript 5.9, Yarn 4 workspaces, `ai` 6, `@ai-sdk/provider-utils`, `vitest`, `pkgroll`, OpenSpec `superpowers-bridge`.

## Global Constraints

- The package directory MUST be `packages/agent-runtime`.
- The package name MUST be `@yesimbot/agent-runtime`.
- The runtime MUST keep `ai-sdk` as the model/provider abstraction and MUST NOT introduce `xsai`.
- Public runtime concepts MUST use `AgentMessage`, `AgentEntry`, `AgentEvent`, `AgentState`, and `TurnResult`; public `AgentInput`, `AgentOutput`, and `AgentMessageInput` MUST NOT be introduced.
- `AgentMessage.meta.id` and `AgentEntry.id` MUST both be required on persisted messages and MUST NOT be required to match.
- `append()` MUST persist messages without creating or triggering a model turn.
- `send()`, `run()`, and `waitTurn()` MUST model turn execution separately.
- `waitTurn()` MUST resolve retained results for done, failed, and aborted turns, and reject only for unknown/expired turn ids or wait cancellation.
- `ifBusy` MUST support `defer`, `join`, and `reject`; default is `defer`.
- Stream deltas MUST be emitted through channel events and MUST NOT be persisted by default.
- Complete assistant messages and tool results MUST be persisted at step boundaries.
- Multiple model-emitted tool calls MUST be executed in deterministic serial order in the first version.
- Runtime core MUST NOT implement automatic retry policy.
- Core events MUST be grouped under `agent.*`, `turn.*`, `message.*`, `tool.*`, and `plugin.*`.
- Runtime core MUST default to persisting only `turn.failed` and `turn.aborted` agent events.
- New runtime MUST NOT read, migrate, or convert old `packages/agent` session data.
- `compactPlugin` is the first dogfood plugin; `auditPlugin` is a development/debug plugin; HITL is out of scope.

---

## File Structure

- Create `packages/agent-runtime/package.json`: package metadata, exports, scripts, dependencies.
- Create `packages/agent-runtime/tsconfig.json`: package TypeScript config.
- Create `packages/agent-runtime/vitest.config.ts`: package test config.
- Create `packages/agent-runtime/README.md`: public API examples and constraints.
- Create `packages/agent-runtime/src/index.ts`: public root exports.
- Create `packages/agent-runtime/src/types.ts`: public message, entry, event, turn, storage, state, tool, and plugin types.
- Create `packages/agent-runtime/src/errors.ts`: runtime error classes and error classification.
- Create `packages/agent-runtime/src/id.ts`: local id factory used by message constructors and entries.
- Create `packages/agent-runtime/src/message.ts`: message constructor and entry creation helpers.
- Create `packages/agent-runtime/src/storage.ts`: storage interface and memory storage implementation.
- Create `packages/agent-runtime/src/channel.ts`: typed channel implementation.
- Create `packages/agent-runtime/src/state.ts`: JSON-serializable state manager and state entry persistence.
- Create `packages/agent-runtime/src/plugin.ts`: plugin ordering, optional plugin wrapper, lifecycle, hook helpers, diagnostics.
- Create `packages/agent-runtime/src/tools.ts`: tool merge, conflict detection, before/after hook composition.
- Create `packages/agent-runtime/src/model.ts`: `ai-sdk` message conversion and `streamText` integration.
- Create `packages/agent-runtime/src/turn.ts`: turn queue, busy behavior, retained results.
- Create `packages/agent-runtime/src/agent.ts`: `createAgent()` and public runtime methods.
- Create `packages/agent-runtime/src/plugins/compact.ts`: compact dogfood plugin.
- Create `packages/agent-runtime/src/plugins/audit.ts`: audit/debug plugin.
- Create `packages/agent-runtime/tests/*.test.ts`: focused unit tests for each subsystem.
- Create `packages/agent-runtime/tests/types/declaration-merging.test-d.ts`: type-level compile fixture imported by type tests.

---

## Task 1: Package Scaffold

**Files:**
- Create: `packages/agent-runtime/package.json`
- Create: `packages/agent-runtime/tsconfig.json`
- Create: `packages/agent-runtime/vitest.config.ts`
- Create: `packages/agent-runtime/src/index.ts`
- Create: `packages/agent-runtime/tests/package-boundary.test.ts`

**Interfaces:**
- Produces package scripts: `build`, `check-types`, `clean`, `test`.
- Produces public import path: `@yesimbot/agent-runtime`.

- [ ] **Step 1: Add package manifest**

Create `packages/agent-runtime/package.json`:

```json
{
  "name": "@yesimbot/agent-runtime",
  "version": "0.1.0-beta.1",
  "files": ["dist"],
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "require": "./dist/index.cjs",
      "default": "./dist/index.js"
    },
    "./plugins": {
      "types": "./dist/plugins/index.d.ts",
      "require": "./dist/plugins/index.cjs",
      "default": "./dist/plugins/index.js"
    },
    "./package.json": "./package.json"
  },
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  },
  "scripts": {
    "build": "npx pkgroll --sourcemap=inline",
    "check-types": "tsc --noEmit",
    "clean": "rimraf .turbo && rimraf dist && rimraf tsconfig.tsbuildinfo",
    "pub": "yarn npm publish --access public",
    "test": "vitest run"
  },
  "dependencies": {
    "@ai-sdk/provider-utils": "^4.0.0",
    "ai": "^6.0.0",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "vitest": "^4.0.18"
  }
}
```

- [ ] **Step 2: Add TypeScript and Vitest config**

Create `packages/agent-runtime/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

Create `packages/agent-runtime/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: ".",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Add initial public export**

Create `packages/agent-runtime/src/index.ts`:

```ts
export const agentRuntimePackageName = "@yesimbot/agent-runtime";
```

- [ ] **Step 4: Write package boundary test**

Create `packages/agent-runtime/tests/package-boundary.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { agentRuntimePackageName } from "../src/index.js";

describe("package boundary", () => {
  it("uses the new agent-runtime package identity", () => {
    expect(agentRuntimePackageName).toBe("@yesimbot/agent-runtime");
  });
});
```

- [ ] **Step 5: Run scaffold tests**

Run: `yarn workspace @yesimbot/agent-runtime test`

Expected: Vitest reports 1 passing test.

- [ ] **Step 6: Run package build and typecheck**

Run: `yarn turbo run check-types build --filter=@yesimbot/agent-runtime`

Expected: Turbo reports successful `check-types` and `build` for `@yesimbot/agent-runtime`.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-runtime package.json yarn.lock
git commit -m "feat(agent-runtime): scaffold runtime package"
```

## Task 2: Core Type Surface

**Files:**
- Create: `packages/agent-runtime/src/types.ts`
- Create: `packages/agent-runtime/src/id.ts`
- Create: `packages/agent-runtime/src/message.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Create: `packages/agent-runtime/tests/message.test.ts`
- Create: `packages/agent-runtime/tests/types.test.ts`

**Interfaces:**
- Produces `AgentMessage`, `AgentEntry`, `AgentEvent`, `AgentState`, `TurnResult`, `AgentPlugin`, `AgentPluginHooks`, `AgentStorage`.
- Produces `createUserMessage()`, `createAssistantMessage()`, `createToolMessage()`, `createCustomMessage()`, and `createMessageEntry()`.

- [ ] **Step 1: Write message constructor tests**

Create `packages/agent-runtime/tests/message.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createCustomMessage, createMessageEntry, createUserMessage } from "../src/message.js";

describe("message constructors", () => {
  it("adds required message metadata without forcing entry id to match", () => {
    const message = createUserMessage("hello");

    const entry = createMessageEntry(message);

    expect(message.meta.id).toMatch(/^msg_/);
    expect(Number.isFinite(message.meta.timestamp)).toBe(true);
    expect(entry.id).toMatch(/^entry_/);
    expect(entry.id).not.toBe(message.meta.id);
    expect(entry.type).toBe("message");
    expect(entry.data).toBe(message);
  });

  it("preserves custom message role and type", () => {
    const message = createCustomMessage("compact.summary", "summary");

    expect(message.role).toBe("custom");
    expect(message.type).toBe("compact.summary");
    expect(message.meta.id).toMatch(/^msg_/);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `yarn workspace @yesimbot/agent-runtime exec vitest run tests/message.test.ts`

Expected: FAIL because `../src/message.js` does not exist.

- [ ] **Step 3: Implement public types**

Create `packages/agent-runtime/src/types.ts`:

```ts
import type {
  AssistantModelMessage,
  JSONValue,
  LanguageModel,
  LanguageModelUsage,
  ModelMessage,
  SystemModelMessage,
  Tool,
  ToolSet,
  ToolModelMessage,
  UserModelMessage,
} from "ai";

export type Awaitable<T> = T | Promise<T>;

export interface AgentMessageMeta {
  id: string;
  timestamp: number;
  turnId?: string;
  source?: string;
  visible?: boolean;
  details?: JSONValue;
  parentTurnId?: string;
  retryOf?: string;
}

export interface AgentCustomMessageMap {}
export interface AgentCustomEntryMap {}
export interface AgentCustomState {}
export interface AgentCustomEventMap {}
export interface AgentCustomHookMap {}

export interface AgentUserMessage extends UserModelMessage {
  meta: AgentMessageMeta;
}

export interface AgentSystemMessage extends SystemModelMessage {
  meta: AgentMessageMeta;
}

export interface AgentAssistantMessage extends AssistantModelMessage {
  usage?: Partial<LanguageModelUsage>;
  finishReason?: string;
  meta: AgentMessageMeta;
}

export interface AgentToolMessage extends ToolModelMessage {
  meta: AgentMessageMeta;
}

export interface AgentCustomMessageBase<TType extends string = string, TContent extends JSONValue = JSONValue> {
  role: "custom";
  type: TType;
  content: TContent;
  meta: AgentMessageMeta;
}

export type AgentCustomMessage = AgentCustomMessageMap[keyof AgentCustomMessageMap];

export type AgentMessage =
  | AgentUserMessage
  | AgentSystemMessage
  | AgentAssistantMessage
  | AgentToolMessage
  | AgentCustomMessage;

export interface AgentEntryBase<TType extends string = string, TData = JSONValue> {
  id: string;
  type: TType;
  data: TData;
  timestamp: number;
  parentId?: string;
}

export type AgentMessageEntry = AgentEntryBase<"message", AgentMessage>;
export type AgentStateEntry = AgentEntryBase<"state", AgentState>;
export type AgentEventEntry = AgentEntryBase<"agent-event", AgentEvent>;
export type AgentCustomEntry = AgentCustomEntryMap[keyof AgentCustomEntryMap];
export type AgentEntry = AgentMessageEntry | AgentStateEntry | AgentEventEntry | AgentCustomEntry;

export interface AgentState extends AgentCustomState {
  version: number;
}

export interface AgentEventBase<TName extends string = string, TData extends JSONValue = JSONValue> {
  id: string;
  name: TName;
  timestamp: number;
  turnId?: string;
  pluginName?: string;
  cause?: string;
  data?: TData;
}

export type CoreAgentEvent =
  | AgentEventBase<"agent.init">
  | AgentEventBase<"agent.stop">
  | AgentEventBase<"agent.error">
  | AgentEventBase<"turn.queued">
  | AgentEventBase<"turn.started">
  | AgentEventBase<"turn.step">
  | AgentEventBase<"turn.delta">
  | AgentEventBase<"turn.done">
  | AgentEventBase<"turn.failed">
  | AgentEventBase<"turn.aborted">
  | AgentEventBase<"message.appended">
  | AgentEventBase<"tool.started">
  | AgentEventBase<"tool.done">
  | AgentEventBase<"tool.failed">
  | AgentEventBase<"tool.blocked">
  | AgentEventBase<"plugin.error">
  | AgentEventBase<"plugin.disabled">;

export type AgentEvent = CoreAgentEvent | AgentCustomEventMap[keyof AgentCustomEventMap];

export type TurnStatus = "queued" | "running" | "done" | "failed" | "aborted";

export interface TurnResult {
  turnId: string;
  status: Exclude<TurnStatus, "queued" | "running">;
  messages: AgentMessage[];
  error?: { name: string; message: string; cause?: string };
  usage?: Partial<LanguageModelUsage>;
}

export interface AgentStorage<T extends AgentEntry = AgentEntry> {
  append(...entries: T[]): Awaitable<void>;
  read(): Awaitable<readonly T[]>;
  clear(): Awaitable<void>;
}

export interface AgentChannel {
  emit<TEvent extends AgentEvent>(event: TEvent): void;
  subscribe<TName extends AgentEvent["name"]>(
    name: TName,
    listener: (event: Extract<AgentEvent, { name: TName }>) => void,
  ): () => void;
}

export interface AgentPluginHooks {
  onAppend?(entries: AgentEntry[], context: AppendHookContext): Awaitable<AgentEntry[] | void>;
  transformMessages?(messages: AgentMessage[], context: MessageTransformContext): Awaitable<AgentMessage[]>;
  toModelMessages?(message: AgentMessage, context: ModelMessageContext): Awaitable<ModelMessage[] | void>;
  extendSystemPrompt?(prompt: string, context: PromptHookContext): Awaitable<string | void>;
  extendTools?(tools: ToolSet, context: ToolExtensionContext): Awaitable<ToolSet | void>;
  beforeToolCall?(call: ToolCallContext, context: ToolHookContext): Awaitable<ToolDecision | void>;
  afterToolCall?(result: ToolResultContext, context: ToolHookContext): Awaitable<Partial<ToolResultContext> | void>;
  onTurnFinish?(result: TurnResult, context: TurnFinishContext): Awaitable<void>;
}

export interface AgentPlugin {
  name: string;
  version?: string;
  enforce?: "pre" | "post";
  optional?: boolean;
  init?(runtime: AgentPluginRuntime): Awaitable<void>;
  stop?(): Awaitable<void>;
  hooks?: Partial<AgentPluginHooks & AgentCustomHookMap>;
}

export interface AgentPluginRuntime {
  readonly id: string;
  readonly channel: AgentChannel;
  readonly state: AgentStateManager;
}

export interface HookContextBase {
  readonly runtime: { id: string };
  readonly channel: AgentChannel;
  readonly state: AgentStateManager;
  readonly signal?: AbortSignal;
  readonly pluginName?: string;
}

export interface AppendHookContext extends HookContextBase {
  readonly storage: AgentStorage;
}

export interface MessageTransformContext extends HookContextBase {
  readonly turnId?: string;
}

export interface ModelMessageContext extends HookContextBase {
  readonly turnId?: string;
}

export interface PromptHookContext extends HookContextBase {
  readonly turnId?: string;
}

export interface ToolExtensionContext extends HookContextBase {
  readonly turnId?: string;
}

export interface ToolHookContext extends HookContextBase {
  readonly turnId: string;
}

export interface TurnFinishContext extends HookContextBase {
  readonly turnId: string;
}

export interface ToolCallContext {
  toolCallId: string;
  toolName: string;
  args: JSONValue;
}

export interface ToolResultContext extends ToolCallContext {
  result: JSONValue;
  isError: boolean;
}

export type ToolDecision =
  | { type: "allow" }
  | { type: "block"; reason: string }
  | { type: "replace"; args: JSONValue };

export type AgentTool = Tool<JSONValue, JSONValue>;
export type AgentToolSet = Record<string, AgentTool>;

export interface AgentStateManager {
  get(): AgentState;
  set(next: AgentState): Awaitable<void>;
  update(updater: (current: AgentState) => AgentState): Awaitable<AgentState>;
}

export interface AgentConfig {
  id?: string;
  model: LanguageModel;
  systemPrompt?: string | ((context: PromptHookContext) => Awaitable<string>);
  tools?: AgentToolSet;
  storage?: AgentStorage;
  plugins?: AgentPlugin[];
}
```

- [ ] **Step 4: Implement id helper and message constructors**

Create `packages/agent-runtime/src/id.ts`:

```ts
const counters = new Map<string, number>();

export function createRuntimeId(prefix: string): string {
  const next = (counters.get(prefix) ?? 0) + 1;
  counters.set(prefix, next);
  return `${prefix}_${next.toString(36)}`;
}
```

Create `packages/agent-runtime/src/message.ts`:

```ts
import type { JSONValue } from "ai";
import type {
  AgentAssistantMessage,
  AgentCustomMessageBase,
  AgentEntryBase,
  AgentMessage,
  AgentMessageEntry,
  AgentMessageMeta,
  AgentToolMessage,
  AgentUserMessage,
} from "./types.js";
import { createRuntimeId } from "./id.js";

export function createMessageMeta(meta: Partial<AgentMessageMeta> = {}): AgentMessageMeta {
  return {
    id: meta.id ?? createRuntimeId("msg"),
    timestamp: meta.timestamp ?? Date.now(),
    ...meta,
  };
}

export function createUserMessage(
  content: AgentUserMessage["content"],
  options: { meta?: Partial<AgentMessageMeta> } = {},
): AgentUserMessage {
  return { role: "user", content, meta: createMessageMeta(options.meta) };
}

export function createAssistantMessage(
  content: AgentAssistantMessage["content"],
  options: Omit<Partial<AgentAssistantMessage>, "role" | "content" | "meta"> & {
    meta?: Partial<AgentMessageMeta>;
  } = {},
): AgentAssistantMessage {
  const { meta, ...rest } = options;
  return { role: "assistant", content, meta: createMessageMeta(meta), ...rest };
}

export function createToolMessage(
  content: AgentToolMessage["content"],
  options: { meta?: Partial<AgentMessageMeta> } = {},
): AgentToolMessage {
  return { role: "tool", content, meta: createMessageMeta(options.meta) };
}

export function createCustomMessage<TType extends string, TContent extends JSONValue>(
  type: TType,
  content: TContent,
  options: { meta?: Partial<AgentMessageMeta> } = {},
): AgentCustomMessageBase<TType, TContent> {
  return { role: "custom", type, content, meta: createMessageMeta(options.meta) };
}

export function createEntry<TType extends string, TData>(
  type: TType,
  data: TData,
  options: { id?: string; timestamp?: number; parentId?: string } = {},
): AgentEntryBase<TType, TData> {
  return {
    id: options.id ?? createRuntimeId("entry"),
    type,
    data,
    timestamp: options.timestamp ?? Date.now(),
    parentId: options.parentId,
  };
}

export function createMessageEntry(
  message: AgentMessage,
  options: { id?: string; timestamp?: number; parentId?: string } = {},
): AgentMessageEntry {
  return createEntry("message", message, options);
}
```

- [ ] **Step 5: Export types and helpers**

Replace `packages/agent-runtime/src/index.ts`:

```ts
export * from "./types.js";
export * from "./id.js";
export * from "./message.js";
```

- [ ] **Step 6: Add declaration merging compile test**

Create `packages/agent-runtime/tests/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { AgentCustomMessageMap, AgentMessage } from "../src/index.js";

declare module "../src/types.js" {
  interface AgentCustomMessageMap {
    "example.custom": {
      role: "custom";
      type: "example.custom";
      content: string;
      meta: {
        id: string;
        timestamp: number;
      };
    };
  }
}

describe("public types", () => {
  it("accepts declaration-merged custom messages", () => {
    const message: AgentMessage = {
      role: "custom",
      type: "example.custom",
      content: "ok",
      meta: {
        id: "msg_custom",
        timestamp: 1,
      },
    };

    expect(message.role).toBe("custom");
  });

  it("keeps declaration merge surface importable", () => {
    const keys: Array<keyof AgentCustomMessageMap> = ["example.custom"];
    expect(keys).toEqual(["example.custom"]);
  });
});
```

- [ ] **Step 7: Run tests and typecheck**

Run: `yarn workspace @yesimbot/agent-runtime exec vitest run tests/message.test.ts tests/types.test.ts`

Expected: both test files pass.

Run: `yarn turbo run check-types --filter=@yesimbot/agent-runtime`

Expected: package typecheck succeeds.

- [ ] **Step 8: Commit**

```bash
git add packages/agent-runtime
git commit -m "feat(agent-runtime): define core runtime types"
```

## Task 3: Storage, Channel, and State Primitives

**Files:**
- Create: `packages/agent-runtime/src/storage.ts`
- Create: `packages/agent-runtime/src/channel.ts`
- Create: `packages/agent-runtime/src/state.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Create: `packages/agent-runtime/tests/storage.test.ts`
- Create: `packages/agent-runtime/tests/channel.test.ts`
- Create: `packages/agent-runtime/tests/state.test.ts`

**Interfaces:**
- Consumes `AgentEntry`, `AgentStorage`, `AgentEvent`, `AgentState`.
- Produces `createMemoryStorage()`, `createChannel()`, `createStateManager()`.

- [ ] **Step 1: Write storage tests**

Create `packages/agent-runtime/tests/storage.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createEntry } from "../src/message.js";
import { createMemoryStorage } from "../src/storage.js";

describe("memory storage", () => {
  it("appends, reads, and clears entries", async () => {
    const storage = createMemoryStorage();
    const entry = createEntry("agent-event", {
      id: "event_1",
      name: "turn.failed",
      timestamp: 1,
    });

    await storage.append(entry);
    expect(await storage.read()).toEqual([entry]);

    await storage.clear();
    expect(await storage.read()).toEqual([]);
  });
});
```

- [ ] **Step 2: Write channel tests**

Create `packages/agent-runtime/tests/channel.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createChannel } from "../src/channel.js";

describe("channel", () => {
  it("emits typed events to matching subscribers", () => {
    const channel = createChannel();
    const seen: string[] = [];
    const unsubscribe = channel.subscribe("turn.started", (event) => {
      seen.push(event.turnId ?? "");
    });

    channel.emit({ id: "evt_1", name: "turn.started", timestamp: 1, turnId: "turn_1" });
    unsubscribe();
    channel.emit({ id: "evt_2", name: "turn.started", timestamp: 2, turnId: "turn_2" });

    expect(seen).toEqual(["turn_1"]);
  });
});
```

- [ ] **Step 3: Write state tests**

Create `packages/agent-runtime/tests/state.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createMemoryStorage } from "../src/storage.js";
import { createStateManager } from "../src/state.js";

describe("state manager", () => {
  it("persists JSON state snapshots as state entries", async () => {
    const storage = createMemoryStorage();
    const state = createStateManager({ storage, initialState: { version: 1 } });

    await state.update((current) => ({ ...current, version: current.version + 1 }));

    expect(state.get()).toEqual({ version: 2 });
    expect(await storage.read()).toMatchObject([
      {
        type: "state",
        data: { version: 2 },
      },
    ]);
  });
});
```

- [ ] **Step 4: Implement storage**

Create `packages/agent-runtime/src/storage.ts`:

```ts
import type { AgentEntry, AgentStorage } from "./types.js";

export function createMemoryStorage<T extends AgentEntry = AgentEntry>(
  initialEntries: readonly T[] = [],
): AgentStorage<T> {
  const entries: T[] = [...initialEntries];

  return {
    async append(...nextEntries) {
      entries.push(...nextEntries);
    },
    async read() {
      return [...entries];
    },
    async clear() {
      entries.length = 0;
    },
  };
}
```

- [ ] **Step 5: Implement channel**

Create `packages/agent-runtime/src/channel.ts`:

```ts
import type { AgentChannel, AgentEvent } from "./types.js";

type Listener = (event: AgentEvent) => void;

export function createChannel(): AgentChannel {
  const listeners = new Map<string, Set<Listener>>();

  return {
    emit(event) {
      for (const listener of listeners.get(event.name) ?? []) {
        listener(event);
      }
    },
    subscribe(name, listener) {
      const current = listeners.get(name) ?? new Set<Listener>();
      current.add(listener as Listener);
      listeners.set(name, current);

      return () => {
        current.delete(listener as Listener);
      };
    },
  };
}
```

- [ ] **Step 6: Implement state manager**

Create `packages/agent-runtime/src/state.ts`:

```ts
import { createEntry } from "./message.js";
import type { AgentState, AgentStateManager, AgentStorage } from "./types.js";

export function createStateManager(options: {
  storage: AgentStorage;
  initialState?: AgentState;
}): AgentStateManager {
  let current = options.initialState ?? { version: 1 };

  return {
    get() {
      return current;
    },
    async set(next) {
      current = next;
      await options.storage.append(createEntry("state", next));
    },
    async update(updater) {
      const next = updater(current);
      await this.set(next);
      return next;
    },
  };
}
```

- [ ] **Step 7: Export primitives**

Update `packages/agent-runtime/src/index.ts`:

```ts
export * from "./types.js";
export * from "./id.js";
export * from "./message.js";
export * from "./storage.js";
export * from "./channel.js";
export * from "./state.js";
```

- [ ] **Step 8: Run focused tests**

Run: `yarn workspace @yesimbot/agent-runtime exec vitest run tests/storage.test.ts tests/channel.test.ts tests/state.test.ts`

Expected: all three test files pass.

- [ ] **Step 9: Commit**

```bash
git add packages/agent-runtime
git commit -m "feat(agent-runtime): add storage channel and state primitives"
```

## Task 4: Plugin Lifecycle and Hook Pipeline

**Files:**
- Create: `packages/agent-runtime/src/plugin.ts`
- Create: `packages/agent-runtime/src/errors.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Create: `packages/agent-runtime/tests/plugin.test.ts`

**Interfaces:**
- Consumes `AgentPlugin`, `AgentPluginHooks`, `AgentEvent`.
- Produces `createPluginHost(options)` and hook pipeline helpers.

- [ ] **Step 1: Write lifecycle and error policy tests**

Create `packages/agent-runtime/tests/plugin.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createChannel } from "../src/channel.js";
import { createPluginHost } from "../src/plugin.js";
import { createMemoryStorage } from "../src/storage.js";
import { createStateManager } from "../src/state.js";
import type { AgentPlugin } from "../src/types.js";

function createRuntime() {
  const storage = createMemoryStorage();
  const channel = createChannel();
  return {
    id: "runtime_1",
    channel,
    state: createStateManager({ storage }),
    storage,
  };
}

describe("plugin host", () => {
  it("initializes plugins in order and stops initialized plugins in reverse order on failure", async () => {
    const calls: string[] = [];
    const plugins: AgentPlugin[] = [
      { name: "a", init: () => calls.push("init:a"), stop: () => calls.push("stop:a") },
      { name: "b", init: () => { throw new Error("boom"); } },
    ];

    const host = createPluginHost({ plugins, runtime: createRuntime() });

    await expect(host.init()).rejects.toThrow("boom");
    expect(calls).toEqual(["init:a", "stop:a"]);
  });

  it("disables optional plugins and emits diagnostics", async () => {
    const runtime = createRuntime();
    const seen: string[] = [];
    runtime.channel.subscribe("plugin.disabled", (event) => seen.push(event.pluginName ?? ""));

    const host = createPluginHost({
      plugins: [{ name: "optional", optional: true, init: () => { throw new Error("skip"); } }],
      runtime,
    });

    await host.init();
    expect(seen).toEqual(["optional"]);
  });
});
```

- [ ] **Step 2: Implement runtime errors**

Create `packages/agent-runtime/src/errors.ts`:

```ts
export class AgentRuntimeError extends Error {
  constructor(message: string, readonly cause?: Error | string) {
    super(message);
    this.name = "AgentRuntimeError";
  }
}

export class AgentBusyError extends AgentRuntimeError {
  constructor() {
    super("Agent is busy");
    this.name = "AgentBusyError";
  }
}

export class TurnNotFoundError extends AgentRuntimeError {
  constructor(turnId: string) {
    super(`Turn not found: ${turnId}`);
    this.name = "TurnNotFoundError";
  }
}

export class ToolConflictError extends AgentRuntimeError {
  constructor(toolName: string) {
    super(`Tool conflict: ${toolName}`);
    this.name = "ToolConflictError";
  }
}

export function classifyRuntimeError(error: Error | string): string {
  if (error instanceof Error) return error.name;
  return "UnknownError";
}
```

- [ ] **Step 3: Implement plugin host**

Create `packages/agent-runtime/src/plugin.ts`:

```ts
import { createRuntimeId } from "./id.js";
import type { AgentEntry, AgentEvent, AgentPlugin, AgentPluginRuntime, Awaitable } from "./types.js";

export function orderPlugins(plugins: readonly AgentPlugin[]): AgentPlugin[] {
  const pre = plugins.filter((plugin) => plugin.enforce === "pre");
  const normal = plugins.filter((plugin) => plugin.enforce !== "pre" && plugin.enforce !== "post");
  const post = plugins.filter((plugin) => plugin.enforce === "post");
  return [...pre, ...normal, ...post];
}

export interface PluginHostRuntime extends AgentPluginRuntime {
  storage: { append(...entries: AgentEntry[]): Awaitable<void> };
}

export function createPluginHost(options: {
  plugins: readonly AgentPlugin[];
  runtime: PluginHostRuntime;
}) {
  const plugins = orderPlugins(options.plugins);
  const initialized: AgentPlugin[] = [];
  let didInit = false;

  function emit(event: Omit<AgentEvent, "id" | "timestamp">) {
    options.runtime.channel.emit({
      id: createRuntimeId("event"),
      timestamp: Date.now(),
      ...event,
    } as AgentEvent);
  }

  return {
    plugins,
    async init() {
      if (didInit) return;
      for (const plugin of plugins) {
        try {
          await plugin.init?.(options.runtime);
          initialized.push(plugin);
        } catch (error) {
          if (plugin.optional) {
            emit({ name: "plugin.disabled", pluginName: plugin.name, cause: String(error) });
            continue;
          }

          for (const initializedPlugin of initialized.reverse()) {
            await initializedPlugin.stop?.();
          }
          throw error;
        }
      }
      didInit = true;
    },
    async stop() {
      for (const plugin of [...initialized].reverse()) {
        await plugin.stop?.();
      }
      initialized.length = 0;
      didInit = false;
    },
    emitPluginError(pluginName: string, error: Error | string) {
      emit({ name: "plugin.error", pluginName, cause: String(error) });
    },
  };
}
```

- [ ] **Step 4: Export plugin APIs**

Update `packages/agent-runtime/src/index.ts`:

```ts
export * from "./types.js";
export * from "./id.js";
export * from "./message.js";
export * from "./storage.js";
export * from "./channel.js";
export * from "./state.js";
export * from "./errors.js";
export * from "./plugin.js";
```

- [ ] **Step 5: Run plugin tests**

Run: `yarn workspace @yesimbot/agent-runtime exec vitest run tests/plugin.test.ts`

Expected: plugin lifecycle tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-runtime
git commit -m "feat(agent-runtime): add plugin lifecycle"
```

## Task 5: Append Pipeline and Runtime Shell

**Files:**
- Create: `packages/agent-runtime/src/agent.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Create: `packages/agent-runtime/tests/append.test.ts`

**Interfaces:**
- Consumes primitives from Tasks 2-4.
- Produces `createAgent(config)` with `append()`, `state`, `channel`, `storage`, `setTools()`, `init()`, `stop()`.

- [ ] **Step 1: Write append behavior tests**

Create `packages/agent-runtime/tests/append.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { createAgent } from "../src/agent.js";
import { createUserMessage } from "../src/message.js";
import { createMemoryStorage } from "../src/storage.js";

describe("append", () => {
  it("persists messages without triggering model hooks or turns", async () => {
    const storage = createMemoryStorage();
    const transformMessages = vi.fn();
    const onTurnFinish = vi.fn();

    const agent = createAgent({
      model: {} as never,
      storage,
      plugins: [
        {
          name: "append-only",
          hooks: {
            onAppend(entries) {
              return entries;
            },
            transformMessages,
            onTurnFinish,
          },
        },
      ],
    });

    await agent.append(createUserMessage("observed"));

    const entries = await storage.read();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: "message" });
    expect(transformMessages).not.toHaveBeenCalled();
    expect(onTurnFinish).not.toHaveBeenCalled();
  });

  it("emits message.appended", async () => {
    const agent = createAgent({ model: {} as never });
    const seen: string[] = [];
    agent.channel.subscribe("message.appended", (event) => seen.push(event.name));

    await agent.append(createUserMessage("event"));

    expect(seen).toEqual(["message.appended"]);
  });
});
```

- [ ] **Step 2: Implement runtime shell**

Create `packages/agent-runtime/src/agent.ts`:

```ts
import type { LanguageModel } from "ai";

import { createChannel } from "./channel.js";
import { createRuntimeId } from "./id.js";
import { createMessageEntry, createEntry } from "./message.js";
import { createPluginHost } from "./plugin.js";
import { createStateManager } from "./state.js";
import { createMemoryStorage } from "./storage.js";
import type { AgentConfig, AgentEntry, AgentEvent, AgentMessage, AgentStorage, AgentToolSet } from "./types.js";

export interface AgentRuntime {
  readonly id: string;
  readonly channel: ReturnType<typeof createChannel>;
  readonly storage: AgentStorage;
  readonly state: ReturnType<typeof createStateManager>;
  init(): Promise<void>;
  stop(): Promise<void>;
  append(message: AgentMessage): Promise<void>;
  setTools(tools: AgentToolSet): void;
  getModel(): LanguageModel;
}

export function createAgent(config: AgentConfig): AgentRuntime {
  const id = config.id ?? createRuntimeId("runtime");
  const storage = config.storage ?? createMemoryStorage();
  const channel = createChannel();
  const state = createStateManager({ storage });
  let model = config.model;
  let tools = config.tools ?? {};
  const pluginHost = createPluginHost({
    plugins: config.plugins ?? [],
    runtime: { id, channel, state, storage },
  });

  let initialized = false;

  async function init() {
    if (initialized) return;
    await pluginHost.init();
    emit({ name: "agent.init" });
    initialized = true;
  }

  function emit(event: Omit<AgentEvent, "id" | "timestamp">) {
    channel.emit({
      id: createRuntimeId("event"),
      timestamp: Date.now(),
      ...event,
    } as AgentEvent);
  }

  async function appendEntries(entries: AgentEntry[]) {
    let nextEntries = entries;
    for (const plugin of pluginHost.plugins) {
      try {
        const result = await plugin.hooks?.onAppend?.(nextEntries, {
          runtime: { id },
          channel,
          state,
          storage,
        });
        if (result) nextEntries = result;
      } catch (error) {
        pluginHost.emitPluginError(plugin.name, error);
      }
    }
    await storage.append(...nextEntries);
    for (const entry of nextEntries) {
      if (entry.type === "message") {
        emit({ name: "message.appended" });
      }
    }
  }

  return {
    id,
    channel,
    storage,
    state,
    init,
    async stop() {
      await pluginHost.stop();
      emit({ name: "agent.stop" });
      initialized = false;
    },
    async append(message) {
      await init();
      await appendEntries([createMessageEntry(message)]);
    },
    setTools(nextTools) {
      tools = nextTools;
    },
    getModel() {
      return model;
    },
  };
}
```

- [ ] **Step 3: Export agent**

Update `packages/agent-runtime/src/index.ts`:

```ts
export * from "./types.js";
export * from "./id.js";
export * from "./message.js";
export * from "./storage.js";
export * from "./channel.js";
export * from "./state.js";
export * from "./errors.js";
export * from "./plugin.js";
export * from "./agent.js";
```

- [ ] **Step 4: Run append tests**

Run: `yarn workspace @yesimbot/agent-runtime exec vitest run tests/append.test.ts`

Expected: append tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime
git commit -m "feat(agent-runtime): implement append pipeline"
```

## Task 6: Turn Queue and Result Lifecycle

**Files:**
- Create: `packages/agent-runtime/src/turn.ts`
- Modify: `packages/agent-runtime/src/agent.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Create: `packages/agent-runtime/tests/turn.test.ts`
- Create: `packages/agent-runtime/tests/busy.test.ts`

**Interfaces:**
- Produces `send(message, options?)`, `run(message, options?)`, `waitTurn(turnId, options?)`.
- Produces retained terminal `TurnResult`.
- Produces busy options `{ ifBusy?: "defer" | "join" | "reject" }`.

- [ ] **Step 1: Write retained wait result tests**

Create `packages/agent-runtime/tests/turn.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createAgent } from "../src/agent.js";
import { createUserMessage } from "../src/message.js";

describe("turn lifecycle", () => {
  it("waitTurn resolves retained completed results", async () => {
    const agent = createAgent({ model: {} as never });
    const turnId = agent.send(createUserMessage("hello"));

    const result = await agent.waitTurn(turnId);
    const retained = await agent.waitTurn(turnId);

    expect(result.status).toBe("done");
    expect(retained).toEqual(result);
  });
});
```

- [ ] **Step 2: Write busy behavior tests**

Create `packages/agent-runtime/tests/busy.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { AgentBusyError } from "../src/errors.js";
import { createAgent } from "../src/agent.js";
import { createUserMessage } from "../src/message.js";

describe("busy behavior", () => {
  it("rejects when ifBusy is reject", () => {
    const agent = createAgent({ model: {} as never });
    agent.send(createUserMessage("first"));

    expect(() => agent.send(createUserMessage("second"), { ifBusy: "reject" })).toThrow(AgentBusyError);
  });

  it("persists joined messages with active turn id", async () => {
    const agent = createAgent({ model: {} as never });
    const turnId = agent.send(createUserMessage("first"));

    agent.send(createUserMessage("joined"), { ifBusy: "join" });

    const entries = await agent.storage.read();
    expect(entries.filter((entry) => entry.type === "message")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({ meta: expect.objectContaining({ turnId }) }),
        }),
      ]),
    );
  });
});
```

- [ ] **Step 3: Implement turn controller**

Create `packages/agent-runtime/src/turn.ts`:

```ts
import { AgentBusyError, TurnNotFoundError } from "./errors.js";
import { createRuntimeId } from "./id.js";
import type { AgentMessage, TurnResult } from "./types.js";

export type BusyBehavior = "defer" | "join" | "reject";

export interface TurnRequest {
  turnId: string;
  messages: AgentMessage[];
}

export interface TurnQueueOptions {
  onRun(request: TurnRequest): Promise<TurnResult>;
}

export function createTurnQueue(options: TurnQueueOptions) {
  const queue: TurnRequest[] = [];
  const retained = new Map<string, TurnResult>();
  const waiters = new Map<string, Array<(result: TurnResult) => void>>();
  let active: TurnRequest | undefined;

  function settle(result: TurnResult) {
    retained.set(result.turnId, result);
    for (const resolve of waiters.get(result.turnId) ?? []) resolve(result);
    waiters.delete(result.turnId);
  }

  async function pump() {
    if (active) return;
    const next = queue.shift();
    if (!next) return;
    active = next;
    try {
      settle(await options.onRun(next));
    } finally {
      active = undefined;
      void pump();
    }
  }

  return {
    get activeTurnId() {
      return active?.turnId;
    },
    enqueue(messages: AgentMessage[], behavior: BusyBehavior = "defer") {
      if (active && behavior === "reject") throw new AgentBusyError();
      if (active && behavior === "join") {
        active.messages.push(...messages);
        return active.turnId;
      }

      const request = { turnId: createRuntimeId("turn"), messages };
      queue.push(request);
      void pump();
      return request.turnId;
    },
    wait(turnId: string) {
      const result = retained.get(turnId);
      if (result) return Promise.resolve(result);
      if (active?.turnId !== turnId && !queue.some((request) => request.turnId === turnId)) {
        return Promise.reject(new TurnNotFoundError(turnId));
      }
      return new Promise<TurnResult>((resolve) => {
        waiters.set(turnId, [...(waiters.get(turnId) ?? []), resolve]);
      });
    },
  };
}
```

- [ ] **Step 4: Wire minimal turn API into agent**

Update `packages/agent-runtime/src/agent.ts` so the returned runtime includes:

```ts
send(message: AgentMessage, options?: { ifBusy?: "defer" | "join" | "reject" }): string;
run(message: AgentMessage, options?: { ifBusy?: "defer" | "join" | "reject" }): AsyncIterable<AgentEvent>;
waitTurn(turnId: string): Promise<TurnResult>;
```

Use a minimal `executeTurn` implementation for this task:

```ts
async function executeTurn(request: { turnId: string; messages: AgentMessage[] }): Promise<TurnResult> {
  for (const message of request.messages) {
    message.meta.turnId = request.turnId;
    await appendEntries([createMessageEntry(message)]);
  }
  emit({ name: "turn.done", turnId: request.turnId });
  return { turnId: request.turnId, status: "done", messages: request.messages };
}
```

- [ ] **Step 5: Export turn helpers**

Update `packages/agent-runtime/src/index.ts` to include:

```ts
export * from "./turn.js";
```

- [ ] **Step 6: Run turn tests**

Run: `yarn workspace @yesimbot/agent-runtime exec vitest run tests/turn.test.ts tests/busy.test.ts`

Expected: turn queue and busy tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-runtime
git commit -m "feat(agent-runtime): add turn queue lifecycle"
```

## Task 7: AI SDK Model Execution and Tool Hooks

**Files:**
- Create: `packages/agent-runtime/src/model.ts`
- Create: `packages/agent-runtime/src/tools.ts`
- Modify: `packages/agent-runtime/src/agent.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Create: `packages/agent-runtime/tests/model.test.ts`
- Create: `packages/agent-runtime/tests/tools.test.ts`

**Interfaces:**
- Produces `buildModelMessages()`, `mergeTools()`, `runBeforeToolHooks()`, `runAfterToolHooks()`.
- Replaces Task 6 minimal `executeTurn` with `ai-sdk` `streamText` execution.

- [ ] **Step 1: Write model conversion tests**

Create `packages/agent-runtime/tests/model.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildModelMessages } from "../src/model.js";
import { createUserMessage } from "../src/message.js";

describe("model conversion", () => {
  it("transforms history before adding current turn messages", async () => {
    const history = [createUserMessage("old")];
    const current = [createUserMessage("current")];

    const result = await buildModelMessages({
      history,
      current,
      plugins: [
        {
          name: "prune",
          hooks: {
            transformMessages: async () => [],
          },
        },
      ],
      context: {} as never,
    });

    expect(result).toEqual([expect.objectContaining({ role: "user", content: "current" })]);
  });
});
```

- [ ] **Step 2: Write tool hook tests**

Create `packages/agent-runtime/tests/tools.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { ToolConflictError } from "../src/errors.js";
import { mergeTools, runBeforeToolHooks } from "../src/tools.js";

describe("tools", () => {
  it("throws on duplicate tool names", () => {
    expect(() =>
      mergeTools([{ search: {} as never }, { search: {} as never }]),
    ).toThrow(ToolConflictError);
  });

  it("short-circuits before hooks on block", async () => {
    const calls: string[] = [];
    const decision = await runBeforeToolHooks(
      [
        { name: "a", hooks: { beforeToolCall: () => { calls.push("a"); return { type: "block", reason: "no" }; } } },
        { name: "b", hooks: { beforeToolCall: () => { calls.push("b"); return { type: "allow" }; } } },
      ],
      { toolCallId: "call_1", toolName: "search", args: {} },
      {} as never,
    );

    expect(decision).toEqual({ type: "block", reason: "no" });
    expect(calls).toEqual(["a"]);
  });
});
```

- [ ] **Step 3: Implement model conversion**

Create `packages/agent-runtime/src/model.ts`:

```ts
import type { ModelMessage } from "ai";

import type { AgentMessage, AgentPlugin, ModelMessageContext } from "./types.js";

function isModelRole(role: string): role is "system" | "user" | "assistant" | "tool" {
  return role === "system" || role === "user" || role === "assistant" || role === "tool";
}

export async function buildModelMessages(options: {
  history: AgentMessage[];
  current: AgentMessage[];
  plugins: readonly AgentPlugin[];
  context: ModelMessageContext;
}): Promise<ModelMessage[]> {
  let history = options.history;
  for (const plugin of options.plugins) {
    const transformed = await plugin.hooks?.transformMessages?.(history, options.context);
    if (transformed) history = transformed;
  }

  const allMessages = [...history, ...options.current];
  const result: ModelMessage[] = [];

  for (const message of allMessages) {
    if (message.role === "custom") {
      for (const plugin of options.plugins) {
        const converted = await plugin.hooks?.toModelMessages?.(message, options.context);
        if (converted?.length) {
          result.push(...converted);
          break;
        }
      }
      continue;
    }

    if (isModelRole(message.role)) {
      result.push({ role: message.role, content: message.content } as ModelMessage);
    }
  }

  return result;
}
```

- [ ] **Step 4: Implement tool helpers**

Create `packages/agent-runtime/src/tools.ts`:

```ts
import { ToolConflictError } from "./errors.js";
import type { AgentPlugin, AgentToolSet, ToolCallContext, ToolDecision, ToolHookContext, ToolResultContext } from "./types.js";

export function mergeTools(toolSets: readonly AgentToolSet[]): AgentToolSet {
  const merged: AgentToolSet = {};
  for (const tools of toolSets) {
    for (const [name, tool] of Object.entries(tools)) {
      if (merged[name]) throw new ToolConflictError(name);
      merged[name] = tool;
    }
  }
  return merged;
}

export async function runBeforeToolHooks(
  plugins: readonly AgentPlugin[],
  call: ToolCallContext,
  context: ToolHookContext,
): Promise<ToolDecision> {
  let current = call;
  for (const plugin of plugins) {
    const decision = await plugin.hooks?.beforeToolCall?.(current, context);
    if (!decision || decision.type === "allow") continue;
    if (decision.type === "block") return decision;
    current = { ...current, args: decision.args };
  }
  return { type: "allow" };
}

export async function runAfterToolHooks(
  plugins: readonly AgentPlugin[],
  result: ToolResultContext,
  context: ToolHookContext,
): Promise<ToolResultContext> {
  let current = result;
  for (const plugin of plugins) {
    const patch = await plugin.hooks?.afterToolCall?.(current, context);
    if (patch) current = { ...current, ...patch };
  }
  return current;
}
```

- [ ] **Step 5: Wire streamText execution**

Update `packages/agent-runtime/src/agent.ts`:

- Import `streamText` from `ai`.
- Build model messages from persisted history plus current turn messages.
- Resolve `systemPrompt`.
- Merge base tools and plugin `extendTools` output.
- Emit `turn.started`, `turn.delta`, `turn.step`, `tool.*`, and terminal events.
- Persist complete assistant messages and tool results at step boundaries.
- On failure, persist `turn.failed` as an `agent-event` entry and return `TurnResult` with `status: "failed"`.
- Do not create any automatic retry turn.

The first implementation should keep all tool calls serial by iterating model-emitted tool calls in order.

- [ ] **Step 6: Export model and tool helpers**

Update `packages/agent-runtime/src/index.ts`:

```ts
export * from "./model.js";
export * from "./tools.js";
```

- [ ] **Step 7: Run focused tests**

Run: `yarn workspace @yesimbot/agent-runtime exec vitest run tests/model.test.ts tests/tools.test.ts`

Expected: model and tool helper tests pass.

- [ ] **Step 8: Run broader package tests**

Run: `yarn workspace @yesimbot/agent-runtime test`

Expected: all package tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/agent-runtime
git commit -m "feat(agent-runtime): execute ai sdk turns"
```

## Task 8: Dogfood Plugins, Public API, and Verification

**Files:**
- Create: `packages/agent-runtime/src/plugins/index.ts`
- Create: `packages/agent-runtime/src/plugins/compact.ts`
- Create: `packages/agent-runtime/src/plugins/audit.ts`
- Modify: `packages/agent-runtime/README.md`
- Create: `packages/agent-runtime/tests/compact-plugin.test.ts`
- Create: `packages/agent-runtime/tests/audit-plugin.test.ts`

**Interfaces:**
- Produces `compactPlugin(options)` and `auditPlugin(options)`.
- Produces public plugin export path `@yesimbot/agent-runtime/plugins`.

- [ ] **Step 1: Write compact plugin tests**

Create `packages/agent-runtime/tests/compact-plugin.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createAgent } from "../src/agent.js";
import { createUserMessage } from "../src/message.js";
import { compactPlugin } from "../src/plugins/compact.js";

describe("compactPlugin", () => {
  it("persists compact custom entries and projects summaries to model messages", async () => {
    const agent = createAgent({
      model: {} as never,
      plugins: [compactPlugin({ threshold: 2, summarize: async () => "short summary" })],
    });

    await agent.append(createUserMessage("one"));
    await agent.append(createUserMessage("two"));

    const entries = await agent.storage.read();
    expect(entries.some((entry) => entry.type === "compact.summary")).toBe(true);
  });
});
```

- [ ] **Step 2: Write audit plugin tests**

Create `packages/agent-runtime/tests/audit-plugin.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createAgent } from "../src/agent.js";
import { createUserMessage } from "../src/message.js";
import { auditPlugin } from "../src/plugins/audit.js";
import { createMemoryStorage } from "../src/storage.js";

describe("auditPlugin", () => {
  it("persists selected channel events for development diagnostics", async () => {
    const storage = createMemoryStorage();
    const agent = createAgent({
      model: {} as never,
      storage,
      plugins: [auditPlugin({ storage, persist: ["message.appended"] })],
    });

    await agent.append(createUserMessage("audit"));

    const entries = await agent.storage.read();
    expect(entries.some((entry) => entry.type === "audit.event")).toBe(true);
  });
});
```

- [ ] **Step 3: Implement compact plugin**

Create `packages/agent-runtime/src/plugins/compact.ts`:

```ts
import { createCustomMessage, createEntry } from "../message.js";
import type { AgentEntry, AgentPlugin, AgentMessage } from "../types.js";

export interface CompactPluginOptions {
  threshold: number;
  summarize(messages: AgentMessage[]): Promise<string>;
}

export function compactPlugin(options: CompactPluginOptions): AgentPlugin {
  let visibleMessages: AgentMessage[] = [];
  let latestSummary: string | undefined;

  return {
    name: "compact",
    hooks: {
      async onAppend(entries, context) {
        const nextEntries: AgentEntry[] = [...entries];
        for (const entry of entries) {
          if (entry.type === "message") visibleMessages.push(entry.data);
        }

        if (visibleMessages.length >= options.threshold) {
          latestSummary = await options.summarize(visibleMessages);
          nextEntries.push(createEntry("compact.summary", { summary: latestSummary }));
          visibleMessages = [];
        }

        return nextEntries;
      },
      async transformMessages(messages) {
        if (!latestSummary) return messages;
        return [
          createCustomMessage("compact.summary", latestSummary),
          ...messages.slice(-options.threshold),
        ];
      },
      async toModelMessages(message) {
        if (message.role !== "custom" || message.type !== "compact.summary") return;
        return [{ role: "system", content: `Conversation summary: ${message.content}` }];
      },
    },
  };
}
```

- [ ] **Step 4: Implement audit plugin**

Create `packages/agent-runtime/src/plugins/audit.ts`:

```ts
import { createEntry } from "../message.js";
import type { AgentEvent, AgentPlugin, AgentStorage } from "../types.js";

export interface AuditPluginOptions {
  storage: AgentStorage;
  persist: AgentEvent["name"][];
}

export function auditPlugin(options: AuditPluginOptions): AgentPlugin {
  const unsubscribers: Array<() => void> = [];

  return {
    name: "audit",
    init(runtime) {
      for (const eventName of options.persist) {
        unsubscribers.push(
          runtime.channel.subscribe(eventName, async (event) => {
            await options.storage.append(createEntry("audit.event", event));
          }),
        );
      }
    },
    stop() {
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
    },
  };
}
```

- [ ] **Step 5: Add plugin export barrel**

Create `packages/agent-runtime/src/plugins/index.ts`:

```ts
export * from "./compact.js";
export * from "./audit.js";
```

- [ ] **Step 6: Document public API**

Create `packages/agent-runtime/README.md`:

```md
# @yesimbot/agent-runtime

Experimental Athena agent runtime package.

## Core API

- `append(message)`: persist an observation without triggering model execution.
- `send(message)`: enqueue a turn and return `turnId`.
- `run(message)`: stream one turn.
- `waitTurn(turnId)`: resolve retained terminal `TurnResult`.

## Boundaries

- Uses `ai-sdk` directly for model/provider compatibility.
- Does not use `xsai`.
- Does not read or migrate old `packages/agent` session data.
- Keeps compact and audit as plugins.
- Keeps retry policy outside runtime core.
```

- [ ] **Step 7: Run plugin tests**

Run: `yarn workspace @yesimbot/agent-runtime exec vitest run tests/compact-plugin.test.ts tests/audit-plugin.test.ts`

Expected: compact and audit plugin tests pass.

- [ ] **Step 8: Run package verification**

Run: `yarn turbo run check-types test build --filter=@yesimbot/agent-runtime`

Expected: package typecheck, tests, and build pass.

- [ ] **Step 9: Run OpenSpec validation**

Run: `openspec validate redesign-agent-runtime --json`

Expected: the `redesign-agent-runtime` change reports `"valid": true`.

- [ ] **Step 10: Commit**

```bash
git add packages/agent-runtime openspec/changes/redesign-agent-runtime
git commit -m "feat(agent-runtime): add compact and audit plugins"
```

## Self-Review Checklist

- [ ] `agent-runtime-core` requirements map to Tasks 2, 5, 6, and 7.
- [ ] `agent-plugin-system` requirements map to Tasks 4, 7, and 8.
- [ ] `agent-storage-session` requirements map to Tasks 3, 5, 6, and 8.
- [ ] `AgentUserMessage`, `AgentAssistantMessage`, `AgentSystemMessage`, and `AgentToolMessage` extend `ai-sdk` model message types instead of re-declaring their content/provider fields.
- [ ] Public event types are named `AgentEventBase`, `CoreAgentEvent`, and `AgentEvent`; no public `RuntimeEvent` type is introduced.
- [ ] Public message APIs do not introduce `AgentMessageInput` or any other `*Input*` type.
- [ ] Message creation uses explicit constructors such as `createUserMessage()` and does not expose `normalizeAgentMessage()`.
- [ ] Optional plugins are declared with `optional: true`; no `optionalPlugin()` helper is introduced.
- [ ] No task requires changes to `core`.
- [ ] No task requires migration from old `packages/agent` data.
- [ ] No task introduces HITL.
- [ ] No task introduces automatic core retry policy.
- [ ] No task introduces parallel tool execution.
