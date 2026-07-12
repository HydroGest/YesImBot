# Reimplement Core With Agent Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reimplement `koishi-plugin-yesimbot` as a thin Koishi adapter over `@yesimbot/agent-runtime` with per-channel JSONL history, prompt file injection, plugin factory registration, reset, and runtime interrupt semantics.

**Architecture:** Runtime-owned behavior is implemented first in `packages/agent-runtime`, then `core` composes it through a `ctx.yesimbot` service. `core` owns Koishi lifecycle, message conversion, JSONL storage selection, prompt file loading, reset command, and reply rendering; it does not expose runtime handles to external plugins.

**Tech Stack:** TypeScript, Koishi 4, Vercel AI SDK, Vitest, Yarn 4, `@yesimbot/agent-runtime`, OpenSpec.

## Global Constraints

- Use `yarn`, not `npm` or `pnpm`.
- Keep `core` first-version config limited to `basePath`, `chatModel`, and `logLevel`.
- Resolve relative `basePath` against Koishi `ctx.baseDir`.
- Preserve Koishi `session.content` exactly, including message element strings.
- Use one JSONL storage file per `platform + selfId + channelId`.
- Do not migrate legacy core extensions or old session data.
- Do not expose `getRuntime`, `createRuntime`, `send`, or `append` through `ctx.yesimbot`.
- Do not introduce `developer` role or a prompt preamble API in this change.
- Use append-only ordering; do not reorder messages by timestamp.

---

## File Structure

- Modify `packages/agent-runtime/src/types.ts`: add `interrupt(reason?: string): Promise<void>` to `AgentRuntime`.
- Modify `packages/agent-runtime/src/agent.ts`: wire abort control, interrupt settlement, active-turn appended observation visibility.
- Modify `packages/agent-runtime/src/turn.ts`: add active request interruption and observation drain support if the implementation fits queue ownership better there.
- Add or modify `packages/agent-runtime/tests/interrupt.test.ts`: tests for interrupt.
- Add or modify `packages/agent-runtime/tests/append.test.ts` or `packages/agent-runtime/tests/busy.test.ts`: tests for active-turn append visibility.
- Modify `core/src/config.ts`: keep minimal config and document unified `basePath`.
- Replace or split `core/src/index.ts`: keep Koishi plugin entrypoint small.
- Create `core/src/service.ts`: `YesImBotService`, runtime cache, registration API, reset, dispose.
- Create `core/src/runtime/key.ts`: channel target, key, path helpers.
- Create `core/src/runtime/jsonl-storage.ts`: JSONL `AgentStorage`.
- Create `core/src/runtime/channel-message.ts`: channel message type, custom message declaration, conversion helper, model projection plugin.
- Create `core/src/runtime/prompt.ts`: prompt file loading and transform plugins.
- Create `core/src/runtime/render.ts`: assistant text extraction.
- Create `core/src/runtime/message-flow.ts`: Koishi session routing helpers.
- Create `core/tests/*.test.ts`: core-scoped tests for storage, service registration, message flow, prompt, reset, render, and path helpers.

---

### Task 1: Runtime Interrupt API

**Files:**

- Modify: `packages/agent-runtime/src/types.ts`
- Modify: `packages/agent-runtime/src/agent.ts`
- Modify: `packages/agent-runtime/src/turn.ts`
- Test: `packages/agent-runtime/tests/interrupt.test.ts`

**Interfaces:**

- Produces: `AgentRuntime.interrupt(reason?: string): Promise<void>`
- Produces: interrupted active turns settle as `TurnResult.status === "aborted"`
- Consumes: existing `waitTurn(turnId): Promise<TurnResult>`

- [ ] **Step 1: Add failing interrupt tests**

Create `packages/agent-runtime/tests/interrupt.test.ts` with tests covering:

```ts
import { describe, expect, it } from "vitest";
import { createAgent, createUserMessage } from "../src/index.js";
import { createTestModel } from "./support/test-model.js";

describe("interrupt", () => {
  it("settles an active turn as aborted", async () => {
    const agent = createAgent({ model: createTestModel({ delayMs: 1000 }) });
    const turnId = agent.send(createUserMessage("hello"));

    await agent.interrupt("reset");
    const result = await agent.waitTurn(turnId);

    expect(result.status).toBe("aborted");
  });

  it("is a no-op without an active turn", async () => {
    const agent = createAgent({ model: createTestModel({ text: "ok" }) });
    await expect(agent.interrupt()).resolves.toBeUndefined();
  });

  it("allows later turns after interrupt", async () => {
    const agent = createAgent({ model: createTestModel({ text: "after" }) });
    const first = agent.send(createUserMessage("first"));

    await agent.interrupt("test");
    expect((await agent.waitTurn(first)).status).toBe("aborted");

    const second = agent.send(createUserMessage("second"));
    expect((await agent.waitTurn(second)).status).toBe("done");
  });
});
```

If no shared `createTestModel` helper exists, add a local helper in the test file using the same fake model pattern already used by `packages/agent-runtime/tests/model.test.ts`.

- [ ] **Step 2: Run the failing test**

Run:

```bash
yarn workspace @yesimbot/agent-runtime exec vitest run tests/interrupt.test.ts
```

Expected: FAIL because `interrupt` is not implemented on `AgentRuntime`.

- [ ] **Step 3: Add the public runtime method type**

In `packages/agent-runtime/src/agent.ts`, update the exported `AgentRuntime` interface:

```ts
interrupt(reason?: string): Promise<void>;
```

If `AgentRuntime` is also exported from `packages/agent-runtime/src/types.ts`, add the same method there or keep the single source of truth used by the package.

- [ ] **Step 4: Implement minimal interruption**

Add active turn abort ownership near the turn execution path. The implementation must:

- create an `AbortController` per active turn;
- pass `signal` through hook contexts where supported;
- abort the active controller in `interrupt()`;
- make the active turn resolve with `status: "aborted"`;
- preserve already appended entries.

Use the existing aborted classification path in `executeTurn()` where possible:

```ts
if (error instanceof DOMException && error.name === "AbortError") {
  status = "aborted";
}
```

- [ ] **Step 5: Run interrupt tests**

Run:

```bash
yarn workspace @yesimbot/agent-runtime exec vitest run tests/interrupt.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add packages/agent-runtime/src packages/agent-runtime/tests/interrupt.test.ts
git commit -m "feat(agent-runtime): add turn interrupt"
```

---

### Task 2: Active-Turn Append Observation Visibility

**Files:**

- Modify: `packages/agent-runtime/src/agent.ts`
- Modify: `packages/agent-runtime/src/turn.ts`
- Test: `packages/agent-runtime/tests/append.test.ts`

**Interfaces:**

- Consumes: `AgentRuntime.append(message)`
- Produces: appended observations are drained at safe model boundaries without becoming joined input.

- [ ] **Step 1: Add failing observation visibility test**

Extend `packages/agent-runtime/tests/append.test.ts` with a test that:

- starts a turn that produces a tool call;
- appends an observation while the turn is active;
- lets the runtime reach the next model boundary;
- asserts the second model request includes the appended observation in storage order.

Use this assertion shape:

```ts
expect(modelRequests[1].messages.map((message) => message.content)).toEqual([
  "trigger",
  "observed while busy",
  expect.anything(),
  expect.anything(),
]);
```

The two trailing entries represent assistant tool-call and tool-result messages.

- [ ] **Step 2: Run the failing append test**

Run:

```bash
yarn workspace @yesimbot/agent-runtime exec vitest run tests/append.test.ts -t "active turn"
```

Expected: FAIL because active-turn `append()` is persisted but not drained into the active turn boundary.

- [ ] **Step 3: Add pending observation tracking**

Implement a runtime-owned pending observation list for messages appended while a turn is active. Keep these observations distinct from joined input:

```ts
type PendingObservation = AgentMessage;
```

The append path should:

- persist through the existing append pipeline;
- record persisted messages for the active turn boundary;
- never enqueue a new turn;
- never force an extra model call by itself.

- [ ] **Step 4: Drain observations at the safe boundary**

At the boundary where joined input is drained, also drain pending observations into the next model context. Preserve storage order by collecting history from storage after persistence and before building the next model request.

The boundary must keep this difference:

```text
append observation -> history/context only
join input -> explicit current batch
```

- [ ] **Step 5: Run runtime regression tests**

Run:

```bash
yarn workspace @yesimbot/agent-runtime test
```

Expected: all agent-runtime tests pass.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add packages/agent-runtime/src packages/agent-runtime/tests
git commit -m "fix(agent-runtime): surface appended observations during active turns"
```

---

### Task 3: Core JSONL Storage and Channel Key Helpers

**Files:**

- Create: `core/src/runtime/key.ts`
- Create: `core/src/runtime/jsonl-storage.ts`
- Test: `core/tests/runtime-key.test.ts`
- Test: `core/tests/jsonl-storage.test.ts`
- Modify: `core/package.json`

**Interfaces:**

- Produces: `ChannelRuntimeTarget`
- Produces: `createChannelRuntimeKey(target: ChannelRuntimeTarget): string`
- Produces: `createChannelSessionPath(basePath: string, target: ChannelRuntimeTarget): string`
- Produces: `createJsonlStorage(filePath: string): AgentStorage`

- [ ] **Step 1: Add `sanitize-filename` dependency**

Modify `core/package.json`:

```json
"dependencies": {
  "@yesimbot/agent-runtime": "workspace:^",
  "sanitize-filename": "^1.6.3",
  "zod": "^3.25.76"
}
```

Then run:

```bash
yarn install
```

Expected: `yarn.lock` updates successfully.

- [ ] **Step 2: Write key helper tests**

Create `core/tests/runtime-key.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createChannelRuntimeKey, createChannelSessionPath } from "../src/runtime/key.js";

describe("channel runtime key", () => {
  it("uses platform, selfId, and channelId", () => {
    expect(
      createChannelRuntimeKey({
        platform: "onebot",
        selfId: "bot",
        channelId: "room",
      }),
    ).toBe("onebot:bot:room");
  });

  it("creates a sanitized jsonl session path", () => {
    const path = createChannelSessionPath("/data/yesimbot", {
      platform: "one/bot",
      selfId: "bot:1",
      channelId: "room*2",
    });

    expect(path).toContain("/data/yesimbot/sessions/");
    expect(path.endsWith(".jsonl")).toBe(true);
    expect(path).not.toContain("*");
  });
});
```

- [ ] **Step 3: Implement key helpers**

Create `core/src/runtime/key.ts`:

```ts
import { join } from "node:path";
import sanitize from "sanitize-filename";

export interface ChannelRuntimeTarget {
  platform: string;
  selfId: string;
  channelId: string;
}

export function createChannelRuntimeKey(target: ChannelRuntimeTarget): string {
  return `${target.platform}:${target.selfId}:${target.channelId}`;
}

export function createChannelSessionPath(basePath: string, target: ChannelRuntimeTarget): string {
  const raw = `${target.platform}-${target.selfId}-${target.channelId}.jsonl`;
  const filename = sanitize(raw) || "channel.jsonl";
  return join(basePath, "sessions", filename);
}
```

- [ ] **Step 4: Write JSONL storage tests**

Create `core/tests/jsonl-storage.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createUserMessage } from "@yesimbot/agent-runtime";
import { describe, expect, it } from "vitest";
import { createJsonlStorage } from "../src/runtime/jsonl-storage.js";

describe("jsonl storage", () => {
  it("appends and reads entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yesimbot-jsonl-"));
    try {
      const storage = createJsonlStorage(join(dir, "session.jsonl"));
      await storage.append({
        id: "entry_1",
        type: "message",
        timestamp: 1,
        data: createUserMessage("hello", { meta: { id: "msg_1", timestamp: 1 } }),
      });

      expect(await storage.read()).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("clears the file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yesimbot-jsonl-"));
    try {
      const storage = createJsonlStorage(join(dir, "session.jsonl"));
      await storage.append({
        id: "entry_1",
        type: "message",
        timestamp: 1,
        data: createUserMessage("hello", { meta: { id: "msg_1", timestamp: 1 } }),
      });

      await storage.clear();
      expect(await storage.read()).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 5: Implement JSONL storage**

Create `core/src/runtime/jsonl-storage.ts` with:

```ts
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentEntry, AgentStorage } from "@yesimbot/agent-runtime";

export function createJsonlStorage(filePath: string): AgentStorage {
  return {
    async append(...entries: AgentEntry[]) {
      if (entries.length === 0) return;
      await mkdir(dirname(filePath), { recursive: true });
      const lines = entries.map((entry) => JSON.stringify(entry)).join("\n");
      await writeFile(filePath, `${lines}\n`, { flag: "a" });
    },
    async read() {
      try {
        const content = await readFile(filePath, "utf8");
        return content
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line) as AgentEntry);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    },
    async clear() {
      await rm(filePath, { force: true });
    },
  };
}
```

- [ ] **Step 6: Run storage tests**

Run:

```bash
yarn workspace koishi-plugin-yesimbot exec vitest run tests/runtime-key.test.ts tests/jsonl-storage.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add core/package.json yarn.lock core/src/runtime/key.ts core/src/runtime/jsonl-storage.ts core/tests/runtime-key.test.ts core/tests/jsonl-storage.test.ts
git commit -m "feat(core): add per-channel jsonl storage"
```

---

### Task 4: Core Service API and Runtime Factory Registration

**Files:**

- Create: `core/src/service.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/service.test.ts`

**Interfaces:**

- Produces: `YesImBotService`
- Produces: `registerAgentPlugin(factory: AgentPluginFactory): () => void`
- Produces: `resetChannel(target: ChannelRuntimeTarget): Promise<void>`

- [ ] **Step 1: Write service registration tests**

Create `core/tests/service.test.ts` with tests that instantiate the service class or a testable service factory and verify:

```ts
const dispose = service.registerAgentPlugin(factory);
expect(service.getAgentPluginFactoriesForTest()).toEqual([factory]);
dispose();
expect(service.getAgentPluginFactoriesForTest()).toEqual([]);
```

If private state prevents direct inspection, expose a test-only method from a local test subclass rather than exporting test-only production APIs.

- [ ] **Step 2: Implement service types**

Create `core/src/service.ts` with:

```ts
import type { AgentPlugin } from "@yesimbot/agent-runtime";
import { Service, type Context } from "koishi";
import type { ChannelRuntimeTarget } from "./runtime/key.js";

export interface ChannelAgentContext {
  channel: ChannelRuntimeTarget & { type: "private" | "group" };
  logger: ReturnType<Context["logger"]>;
}

export type AgentPluginFactory = (context: ChannelAgentContext) => AgentPlugin;

declare module "koishi" {
  interface Context {
    yesimbot: YesImBotService;
  }
}

export class YesImBotService extends Service {
  private readonly agentPluginFactories: AgentPluginFactory[] = [];

  constructor(ctx: Context) {
    super(ctx, "yesimbot", true);
  }

  registerAgentPlugin(factory: AgentPluginFactory): () => void {
    this.agentPluginFactories.push(factory);
    return () => {
      const index = this.agentPluginFactories.indexOf(factory);
      if (index >= 0) this.agentPluginFactories.splice(index, 1);
    };
  }

  async resetChannel(_target: ChannelRuntimeTarget): Promise<void> {
    throw new Error("resetChannel is wired in a later task");
  }
}
```

- [ ] **Step 3: Wire service registration in `core/src/index.ts`**

Modify the plugin apply path so `YesImBotService` is registered as `ctx.yesimbot` and `ModelService` remains registered as `ctx["yesimbot.model"]`.

- [ ] **Step 4: Run service tests**

Run:

```bash
yarn workspace koishi-plugin-yesimbot exec vitest run tests/service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add core/src/service.ts core/src/index.ts core/tests/service.test.ts
git commit -m "feat(core): expose yesimbot service"
```

---

### Task 5: Built-In Channel Message and Prompt Plugins

**Files:**

- Create: `core/src/runtime/channel-message.ts`
- Create: `core/src/runtime/prompt.ts`
- Test: `core/tests/channel-message.test.ts`
- Test: `core/tests/prompt.test.ts`

**Interfaces:**

- Produces: `createChannelMessage(sessionLike): ChannelMessage`
- Produces: `channelMessagePlugin`
- Produces: `createPromptPlugins(options): AgentPlugin[]`

- [ ] **Step 1: Write channel message projection tests**

Create `core/tests/channel-message.test.ts` asserting:

```ts
const modelMessage = await plugin.hooks?.toModelMessages?.(
  createCustomMessage("athena.channel.message", {
    version: 1,
    kind: "message",
    id: "m1",
    timestamp: 1,
    author: { id: "u1", name: "Alice" },
    message: { id: "m1", content: '<at id="bot"/> hello' },
  }),
  context,
);

expect(modelMessage).toEqual({
  role: "user",
  content: '[Alice]: <at id="bot"/> hello',
});
```

- [ ] **Step 2: Implement channel message plugin**

Create `core/src/runtime/channel-message.ts` with the `ChannelMessage` interface, module declaration for `AgentCustomMessages`, and an `AgentPlugin` whose `toModelMessages` handles only `athena.channel.message`.

- [ ] **Step 3: Write prompt plugin tests**

Create `core/tests/prompt.test.ts` with temporary `AGENTS.md` and `PERSONA.md` files. Assert transform output order:

```text
AGENTS system message
PERSONA system message
existing history
```

- [ ] **Step 4: Implement prompt plugins**

Create `core/src/runtime/prompt.ts`:

- read prompt files from unified `basePath`;
- log missing files;
- create stable system message ids such as `prompt:agents` and `prompt:persona`;
- inject through `transformMessages()`.

- [ ] **Step 5: Run plugin tests**

Run:

```bash
yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel-message.test.ts tests/prompt.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add core/src/runtime/channel-message.ts core/src/runtime/prompt.ts core/tests/channel-message.test.ts core/tests/prompt.test.ts
git commit -m "feat(core): add built-in runtime plugins"
```

---

### Task 6: Koishi Message Flow and Reply Rendering

**Files:**

- Create: `core/src/runtime/render.ts`
- Create: `core/src/runtime/message-flow.ts`
- Modify: `core/src/service.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/render.test.ts`
- Test: `core/tests/message-flow.test.ts`

**Interfaces:**

- Produces: `extractAssistantTexts(messages: AgentMessage[]): string[]`
- Produces: routing helpers for self-ignore, append, send, and busy join.

- [ ] **Step 1: Write render tests**

Create `core/tests/render.test.ts` with assistant string content, assistant content parts, empty text, and tool messages. Assert only non-empty assistant text strings are returned in order.

- [ ] **Step 2: Implement reply renderer**

Create `core/src/runtime/render.ts`:

```ts
import type { AgentMessage } from "@yesimbot/agent-runtime";

export function extractAssistantTexts(messages: readonly AgentMessage[]): string[] {
  const texts: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    if (typeof message.content === "string") {
      if (message.content.trim().length > 0) texts.push(message.content);
      continue;
    }
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
    if (text.trim().length > 0) texts.push(text);
  }
  return texts;
}
```

- [ ] **Step 3: Write message flow tests**

Create `core/tests/message-flow.test.ts` with fake sessions and fake agent runtime methods. Verify:

- self messages are ignored;
- ordinary group messages call `append`;
- direct messages call `send`;
- mentioned group messages call `send`;
- busy direct or mentioned messages use `{ ifBusy: "join" }`.

- [ ] **Step 4: Implement message flow**

In `core/src/runtime/message-flow.ts`, implement small pure helpers:

- `isSelfMessage(session): boolean`
- `isBotMentioned(session): boolean`
- `getChannelType(session): "private" | "group"`
- `createChannelTarget(session): ChannelRuntimeTarget`
- `routeSessionMessage(session, runtime): Promise<void>`

Keep Koishi-specific middleware wiring in `core/src/index.ts` or `core/src/service.ts`.

- [ ] **Step 5: Wire runtime creation**

Update `YesImBotService` so it:

- resolves the chat model through `ModelService`;
- creates JSONL storage per channel;
- creates built-in plugins first;
- appends externally registered factory plugins after built-ins;
- caches runtimes by channel key.

- [ ] **Step 6: Run message flow tests**

Run:

```bash
yarn workspace koishi-plugin-yesimbot exec vitest run tests/render.test.ts tests/message-flow.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

Run:

```bash
git add core/src core/tests/render.test.ts core/tests/message-flow.test.ts
git commit -m "feat(core): route koishi messages through agent runtime"
```

---

### Task 7: Reset Command, Disposal, and Error Handling

**Files:**

- Modify: `core/src/service.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/reset.test.ts`
- Test: `core/tests/error-handling.test.ts`

**Interfaces:**

- Consumes: `AgentRuntime.interrupt(reason?: string): Promise<void>`
- Produces: `resetChannel(target: ChannelRuntimeTarget): Promise<void>`

- [ ] **Step 1: Write reset service tests**

Create `core/tests/reset.test.ts` with a cached fake runtime and fake storage. Assert `resetChannel(target)` calls:

```text
interrupt
stop
storage.clear
cache delete
```

- [ ] **Step 2: Implement reset service**

In `core/src/service.ts`, implement:

```ts
async resetChannel(target: ChannelRuntimeTarget): Promise<void> {
  const key = createChannelRuntimeKey(target);
  const cached = this.runtimes.get(key);
  if (cached) {
    await cached.agent.interrupt("reset");
    await cached.agent.stop();
    await cached.storage.clear();
    this.runtimes.delete(key);
    return;
  }
  await createJsonlStorage(createChannelSessionPath(this.basePath, target)).clear();
}
```

Adapt property names to the runtime cache shape implemented in Task 6.

- [ ] **Step 3: Add reset command tests or command wiring check**

Add a test or focused integration check that the reset command:

- derives target from the current session;
- calls `ctx.yesimbot.resetChannel(target)`;
- requires administrator authority;
- does not accept another channel target.

- [ ] **Step 4: Implement reset command**

In `core/src/index.ts`, register a minimal command such as:

```ts
ctx
  .command("yesimbot.reset", "Reset YesImBot state for the current channel", { authority: 4 })
  .action(async ({ session }) => {
    if (!session?.channelId) return;
    await ctx.yesimbot.resetChannel({
      platform: session.platform,
      selfId: session.selfId,
      channelId: session.channelId,
    });
    return "Reset complete.";
  });
```

- [ ] **Step 5: Write disposal tests**

Test that service disposal interrupts and stops all cached runtimes and clears the cache.

- [ ] **Step 6: Implement disposal cleanup**

Hook Koishi dispose or service stop lifecycle to:

```text
for each cached runtime:
  interrupt("dispose")
  stop()
clear cache
```

- [ ] **Step 7: Write error behavior tests**

Create `core/tests/error-handling.test.ts` covering:

- direct or mentioned failure logs and sends a generic development-time error;
- ordinary append failure logs only.

- [ ] **Step 8: Implement error behavior**

Wrap message handling so:

- append failures use logger only;
- direct or mentioned send failures use logger and generic channel reply;
- detailed runtime diagnostics go to logger subscriptions.

- [ ] **Step 9: Run reset and error tests**

Run:

```bash
yarn workspace koishi-plugin-yesimbot exec vitest run tests/reset.test.ts tests/error-handling.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit Task 7**

Run:

```bash
git add core/src core/tests/reset.test.ts core/tests/error-handling.test.ts
git commit -m "feat(core): add reset and lifecycle cleanup"
```

---

### Task 8: Package Verification and OpenSpec Validation

**Files:**

- Modify as needed: `core/src/index.ts`
- Modify as needed: `core/src/model/index.ts`
- Modify as needed: `packages/agent-runtime/src/index.ts`

**Interfaces:**

- Consumes: all previous tasks.
- Produces: buildable, typed, validated change.

- [ ] **Step 1: Run agent-runtime tests**

Run:

```bash
yarn workspace @yesimbot/agent-runtime test
```

Expected: all tests pass.

- [ ] **Step 2: Run core tests**

Run:

```bash
yarn workspace koishi-plugin-yesimbot test
```

Expected: all core tests pass.

- [ ] **Step 3: Run scoped type checks**

Run:

```bash
yarn turbo run check-types --filter=@yesimbot/agent-runtime --filter=koishi-plugin-yesimbot
```

Expected: both packages type-check.

- [ ] **Step 4: Run scoped builds**

Run:

```bash
yarn turbo run build --filter=@yesimbot/agent-runtime --filter=koishi-plugin-yesimbot
```

Expected: both packages build.

- [ ] **Step 5: Validate OpenSpec change**

Run:

```bash
openspec validate reimplement-core-with-agent-runtime --json
```

Expected: `valid: true` for the change.

- [ ] **Step 6: Commit verification fixes**

If verification required fixes, run:

```bash
git add packages/agent-runtime core openspec/changes/reimplement-core-with-agent-runtime
git commit -m "test: verify core runtime integration"
```

If no fixes were needed after the previous commits, do not create an empty commit.

---

## Self-Review

- Spec coverage: runtime interrupt is covered by Task 1; active-turn append visibility by Task 2; core service and plugin factory registration by Task 4; channel key and JSONL by Task 3; prompt and message projection by Task 5; message routing and reply rendering by Task 6; reset, disposal, and error handling by Task 7; verification by Task 8.
- Placeholder scan: the plan contains no deferred implementation markers or unspecified task bodies.
- Type consistency: `ChannelRuntimeTarget`, `AgentPluginFactory`, `ChannelAgentContext`, `createChannelRuntimeKey`, `createChannelSessionPath`, `createJsonlStorage`, `extractAssistantTexts`, and `resetChannel` are introduced before later tasks consume them.
