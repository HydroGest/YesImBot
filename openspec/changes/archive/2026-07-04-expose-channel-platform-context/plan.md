# Expose Channel Platform Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a core-owned `platform` section with `unsafeBot` to `ChannelAgentContext` and migrate OneBot utility tools as the first adapter-specific consumer without changing `agent-runtime`.

**Architecture:** This change stays in `koishi-plugin-yesimbot`. Core captures stable platform context from the first Koishi session that creates a channel runtime, passes it to registered `AgentPluginFactory` functions, and keeps Koishi objects out of `@yesimbot/agent-runtime` tool and hook contexts.

**Tech Stack:** TypeScript, Koishi, `@yesimbot/agent-runtime`, Vitest, OpenSpec.

## Global Constraints

- Use Yarn 4 commands; prefer scoped Turbo commands for verification.
- Do not modify `@yesimbot/agent-runtime` public APIs for this change.
- Do not expose Koishi `Context` or Koishi `Session` through `ChannelAgentContext`.
- Do not store `platform`, `selfId`, `channelId`, or `unsafeBot` in `agent.state`.
- `unsafeBot` is a raw, high-authority Koishi `Bot` escape hatch and must be named exactly `unsafeBot`.
- Migrate only completed legacy OneBot tools: `onebot_get_forward_message`, `onebot_create_reaction`, and `onebot_set_essence`.
- Do not expose the incomplete legacy `onebot_get_message_id` tool.

---

### Task 1: Extend Core Context Types

**Files:**
- Modify: `core/src/shared/types.ts`
- Modify: `core/tests/service.test.ts`

**Interfaces:**
- Consumes: existing `ChannelRuntimeTarget`.
- Produces:
  ```ts
  export interface ChannelAgentContext {
    readonly channel: ChannelRuntimeTarget & {
      readonly type: "private" | "group";
    };
    readonly platform: {
      readonly name: string;
      readonly unsafeBot?: Bot;
    };
  }
  ```

- [ ] **Step 1: Write the failing fixture update in `core/tests/service.test.ts`**

  Update the local `createChannelContext()` helper so all existing tests compile against the future required context shape:

  ```ts
  function createChannelContext(): ChannelAgentContext {
    return {
      channel: {
        platform: "discord",
        selfId: "bot",
        channelId: "channel",
        type: "group",
      },
      platform: {
        name: "discord",
      },
    };
  }
  ```

- [ ] **Step 2: Run type check and observe the current type failure**

  Run: `rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot`

  Expected before implementation: TypeScript reports that `ChannelAgentContext` does not allow or require the new `platform` section.

- [ ] **Step 3: Implement the type in `core/src/shared/types.ts`**

  Replace the file content with:

  ```ts
  import type { Bot } from "koishi";

  export interface ChannelRuntimeTarget {
    platform: string;
    selfId: string;
    channelId: string;
  }

  export interface ChannelAgentContext {
    readonly channel: ChannelRuntimeTarget & {
      readonly type: "private" | "group";
    };
    readonly platform: {
      readonly name: string;
      readonly unsafeBot?: Bot;
    };
  }
  ```

- [ ] **Step 4: Run type check and confirm the fixture compiles**

  Run: `rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot`

  Expected after implementation: no errors from `core/src/shared/types.ts` or `core/tests/service.test.ts`.

- [ ] **Step 5: Commit Task 1**

  ```bash
  git add core/src/shared/types.ts core/tests/service.test.ts
  git commit -m "feat(core): extend channel agent context"
  ```

---

### Task 2: Populate Platform Context From Koishi Session

**Files:**
- Modify: `core/src/service.ts`

**Interfaces:**
- Consumes:
  ```ts
  private createChannelContext(session: Session): ChannelAgentContext
  ```
- Produces: a `ChannelAgentContext` whose `platform.name` is `session.platform` and whose `platform.unsafeBot` is `session.bot`.

- [ ] **Step 1: Write the intended implementation shape**

  In `core/src/service.ts`, `createChannelContext(session)` should return this shape:

  ```ts
  private createChannelContext(session: Session): ChannelAgentContext {
    return {
      channel: {
        ...getChannelRuntimeTarget(session),
        type: getChannelType(session),
      },
      platform: {
        name: session.platform,
        unsafeBot: session.bot,
      },
    };
  }
  ```

- [ ] **Step 2: Apply the minimal implementation**

  Modify only `createChannelContext(session)` in `core/src/service.ts`. Do not change `AgentPluginFactory`, `createAgent()` arguments, `AgentToolExecuteContext`, or any `@yesimbot/agent-runtime` files.

- [ ] **Step 3: Run type check**

  Run: `rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot`

  Expected: PASS. If TypeScript reports that `Session` lacks `bot`, inspect Koishi's `Session` type and use the narrowest type-safe access available in this codebase.

- [ ] **Step 4: Commit Task 2**

  ```bash
  git add core/src/service.ts
  git commit -m "feat(core): pass unsafe bot to plugin factories"
  ```

---

### Task 3: Add Core Boundary Tests

**Files:**
- Modify: `core/tests/service.test.ts`
- Create: `core/tests/channel-context.test.ts`

**Interfaces:**
- Consumes: `ctx.yesimbot.registerAgentPlugin(factory)` and `YesImBotService.handleSession(session)`.
- Produces: tests proving factories can observe `platform.name` and `unsafeBot`, and that runtime handles remain unexposed.

- [ ] **Step 1: Add a factory observation assertion to `core/tests/service.test.ts`**

  Add this test inside `describe("yesimbot service", () => { ... })`:

  ```ts
  it("passes platform metadata through external plugin factories", () => {
    const service = new TestYesImBotService(new Context(), config);
    const seen: ChannelAgentContext[] = [];

    service.registerAgentPlugin((context) => {
      seen.push(context);
      return { name: "observer" };
    });

    expect(service.buildExternalPlugins(createChannelContext()).map((plugin) => plugin.name)).toEqual([
      "observer",
    ]);
    expect(seen[0].platform.name).toBe("discord");
    expect(seen[0].platform.unsafeBot).toBeUndefined();
  });
  ```

- [ ] **Step 2: Create `core/tests/channel-context.test.ts` with runtime mocks**

  Add this file to test the actual session-to-factory path:

  ```ts
  import { Context } from "@koishijs/core";
  import { describe, expect, it, vi } from "vitest";

  vi.mock("koishi", async () => import("@koishijs/core"));

  const runtimeMocks = vi.hoisted(() => ({
    createAgent: vi.fn(() => ({
      id: "runtime_1",
      channel: {
        emit: vi.fn(),
        subscribe: vi.fn(() => () => undefined),
      },
      storage: {} as never,
      state: {} as never,
      init: vi.fn(),
      stop: vi.fn(async () => undefined),
      append: vi.fn(async () => undefined),
      send: vi.fn(() => "turn_1"),
      run: vi.fn(),
      waitTurn: vi.fn(async () => ({ turnId: "turn_1", status: "done", messages: [] })),
      interrupt: vi.fn(async () => undefined),
      setTools: vi.fn(),
      getModel: vi.fn(),
      setModel: vi.fn(),
      clear: vi.fn(async () => undefined),
      getActiveTurnId: vi.fn(() => undefined),
      isIdle: vi.fn(() => true),
    })),
  }));

  vi.mock("@yesimbot/agent-runtime", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@yesimbot/agent-runtime")>();
    return {
      ...actual,
      createAgent: runtimeMocks.createAgent,
    };
  });

  import type { Config } from "../src/config.js";
  import type { ChannelAgentContext } from "../src/service.js";
  import { YesImBotService } from "../src/service.js";

  const config: Config = {
    basePath: "data/yesimbot-core",
    chatModel: "mock:model",
    logLevel: 2,
  };

  function createContext() {
    const ctx = new Context();
    ctx.baseDir = "/tmp/athena";
    (ctx as Context & {
      "yesimbot.model": { resolveChatModel(): { model: { modelId: string } } };
    })["yesimbot.model"] = {
      resolveChatModel() {
        return { model: { modelId: "mock:model" } };
      },
    };
    return ctx;
  }

  describe("channel agent context", () => {
    it("captures the raw Koishi bot from the first channel session", async () => {
      const service = new YesImBotService(createContext(), config);
      const unsafeBot = { selfId: "bot", internal: { protocol: "onebot" } };
      let seen: ChannelAgentContext | undefined;

      service.registerAgentPlugin((context) => {
        seen = context;
        return { name: "observer" };
      });

      await service.handleSession({
        platform: "onebot",
        selfId: "bot",
        channelId: "group",
        userId: "user",
        content: "ordinary message",
        bot: unsafeBot,
        send: vi.fn(async () => undefined),
      } as never);

      expect(seen?.channel).toEqual({
        platform: "onebot",
        selfId: "bot",
        channelId: "group",
        type: "group",
      });
      expect(seen?.platform.name).toBe("onebot");
      expect(seen?.platform.unsafeBot).toBe(unsafeBot);
      expect(runtimeMocks.createAgent).toHaveBeenCalledTimes(1);
    });
  });
  ```

- [ ] **Step 3: Run the targeted tests**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/service.test.ts tests/channel-context.test.ts`

  Expected: PASS for service factory tests and channel context capture test.

- [ ] **Step 4: Confirm `agent-runtime` stayed Koishi-free**

  Run: `rtk rg -n "koishi|unsafeBot|Session|Bot" packages/agent-runtime/src`

  Expected: no matches for Koishi-specific host context additions. Existing unrelated text should be inspected before changing anything.

- [ ] **Step 5: Commit Task 3**

  ```bash
  git add core/tests/service.test.ts core/tests/channel-context.test.ts
  git commit -m "test(core): cover channel platform context"
  ```

---

### Task 4: Migrate OneBot Utils Plugin

**Files:**
- Create: `plugins/onebot-utils/package.json`
- Create: `plugins/onebot-utils/tsconfig.json`
- Create: `plugins/onebot-utils/src/index.ts`
- Create: `plugins/onebot-utils/src/types.ts`
- Create: `plugins/onebot-utils/tests/onebot-utils.test.ts`

**Interfaces:**
- Consumes:
  ```ts
  import type { AgentPluginFactory } from "koishi-plugin-yesimbot";
  type ChannelAgentContext = Parameters<AgentPluginFactory>[0];
  ```
- Produces:
  ```ts
  export default class OnebotUtilsPlugin {
    static name = "yesimbot-onebot-utils";
    static inject = ["yesimbot"];
  }
  ```

- [ ] **Step 1: Create the package manifest**

  Create `plugins/onebot-utils/package.json`:

  ```json
  {
    "name": "koishi-plugin-yesimbot-onebot-utils",
    "version": "0.0.1",
    "files": [
      "dist"
    ],
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
        "zh": "OneBot 工具插件",
        "en": "OneBot utility tools plugin"
      }
    }
  }
  ```

- [ ] **Step 2: Create TypeScript config**

  Create `plugins/onebot-utils/tsconfig.json`:

  ```json
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
      "outDir": "./dist",
      "rootDir": "./src",
      "esModuleInterop": true
    },
    "include": ["src", "src/**/*.json", "tests"]
  }
  ```

- [ ] **Step 3: Create local OneBot types**

  Create `plugins/onebot-utils/src/types.ts`:

  ```ts
  export interface ForwardMessage {
    self_id: number;
    user_id: number;
    time: number;
    message_id: number;
    message_seq: number;
    real_id: number;
    real_seq: string;
    message_type: string;
    sender: Sender;
    raw_message: string;
    font: number;
    sub_type: string;
    message: Message[];
    message_format: string;
    post_type: string;
    group_id: number;
    group_name: string;
  }

  export interface OneBotInternal {
    getForwardMsg(messageId: string): Promise<ForwardMessage[] | unknown>;
    setEssenceMsg(messageId: string): Promise<unknown>;
    _request?(action: string, params: Record<string, unknown>): Promise<unknown>;
  }

  export interface OneBotCapableBot {
    internal?: OneBotInternal;
  }

  interface Message {
    type: string;
    data: Data;
  }

  interface Data {
    summary: string;
    file: string;
    sub_type: number;
    url: string;
    file_size: string;
  }

  interface Sender {
    user_id: number;
    nickname: string;
    card: string;
  }
  ```

- [ ] **Step 4: Write failing tests for registration and tool gating**

  Create `plugins/onebot-utils/tests/onebot-utils.test.ts` with the test scaffold:

  ```ts
  import type { AgentPlugin, AgentTool } from "@yesimbot/agent-runtime";
  import { describe, expect, it, vi } from "vitest";

  vi.mock("koishi", () => ({
    Context: class Context {},
    Logger: class Logger {},
    Schema: {
      object: vi.fn(() => ({})),
    },
  }));

  import OnebotUtilsPlugin from "../src/index";

  function createContext() {
    const factories: Array<(context: never) => AgentPlugin> = [];
    const dispose = vi.fn<() => void>();
    const ctx = {
      logger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      })),
      on: vi.fn<(event: string, handler: () => unknown) => void>(),
      yesimbot: {
        registerAgentPlugin: vi.fn((factory: (context: never) => AgentPlugin) => {
          factories.push(factory);
          return dispose;
        }),
      },
    };
    return { ctx, factories, dispose };
  }

  function createChannelContext(overrides: Record<string, unknown> = {}) {
    return {
      channel: {
        platform: "onebot",
        selfId: "bot",
        channelId: "group",
        type: "group",
      },
      platform: {
        name: "onebot",
        unsafeBot: undefined,
      },
      ...overrides,
    };
  }

  function getTools(plugin: AgentPlugin): AgentTool[] {
    return Array.isArray(plugin.tools) ? plugin.tools : [];
  }

  describe("onebot-utils plugin", () => {
    it("registers and disposes an agent plugin factory", async () => {
      const { ctx, dispose } = createContext();
      const plugin = new OnebotUtilsPlugin(ctx as never, {});

      await plugin.start();
      expect(ctx.yesimbot.registerAgentPlugin).toHaveBeenCalledOnce();

      await plugin.stop();
      expect(dispose).toHaveBeenCalledOnce();
    });

    it("does not expose tools for non-OneBot channels", async () => {
      const { ctx, factories } = createContext();
      const plugin = new OnebotUtilsPlugin(ctx as never, {});
      await plugin.start();

      const agentPlugin = factories[0]!(
        createChannelContext({
          channel: {
            platform: "discord",
            selfId: "bot",
            channelId: "group",
            type: "group",
          },
          platform: { name: "discord" },
        }) as never,
      );

      expect(getTools(agentPlugin)).toEqual([]);
    });
  });
  ```

  Run: `rtk yarn workspace koishi-plugin-yesimbot-onebot-utils exec vitest run tests/onebot-utils.test.ts`

  Expected before implementation: FAIL because `../src/index` does not exist.

- [ ] **Step 5: Implement plugin registration and platform gating**

  Create `plugins/onebot-utils/src/index.ts`:

  ```ts
  import { type AgentPlugin, type AgentTool, jsonSchema } from "@yesimbot/agent-runtime";
  import type { Context, Logger } from "koishi";
  import { Schema } from "koishi";
  import type { AgentPluginFactory } from "koishi-plugin-yesimbot";

  import type { OneBotCapableBot, OneBotInternal } from "./types.js";

  export interface OnebotUtilsConfig {}

  type ChannelAgentContext = Parameters<AgentPluginFactory>[0];

  const ONEBOT_UNSUPPORTED = "当前频道的机器人适配器不支持 OneBot 协议";
  const ONEBOT_REQUEST_UNSUPPORTED = "当前频道的机器人适配器不支持发送 OneBot 请求";

  function getOneBotInternal(context: ChannelAgentContext): OneBotInternal {
    const bot = context.platform.unsafeBot as OneBotCapableBot | undefined;
    const internal = bot?.internal;
    if (!internal) {
      throw new Error(ONEBOT_UNSUPPORTED);
    }
    return internal;
  }

  function createOnebotTools(context: ChannelAgentContext): AgentTool[] {
    return [
      {
        name: "onebot_get_forward_message",
        description: "获取合并转发消息的原始消息列表",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            messageId: { type: "string", description: "合并转发消息的 ID" },
          },
          required: ["messageId"],
          additionalProperties: false,
        }),
        async execute(input: { messageId: string }) {
          return await getOneBotInternal(context).getForwardMsg(input.messageId);
        },
      },
      {
        name: "onebot_create_reaction",
        description: "对消息进行表态",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            messageId: { type: "string", description: "要表态的消息 ID" },
            emojiId: { type: "string", description: "表情 ID" },
          },
          required: ["messageId", "emojiId"],
          additionalProperties: false,
        }),
        async execute(input: { messageId: string; emojiId: string }) {
          const internal = getOneBotInternal(context);
          if (!internal._request) {
            throw new Error(ONEBOT_REQUEST_UNSUPPORTED);
          }
          return await internal._request("set_msg_emoji_like", {
            message_id: input.messageId,
            emoji_id: input.emojiId,
          });
        },
      },
      {
        name: "onebot_set_essence",
        description: "将消息设置为精华",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            messageId: { type: "string", description: "要设置为精华的消息 ID" },
          },
          required: ["messageId"],
          additionalProperties: false,
        }),
        async execute(input: { messageId: string }) {
          await getOneBotInternal(context).setEssenceMsg(input.messageId);
          return { success: true };
        },
      },
    ];
  }

  export default class OnebotUtilsPlugin {
    static name = "yesimbot-onebot-utils";
    static inject = ["yesimbot"];
    static Config: Schema<OnebotUtilsConfig> = Schema.object({});

    public readonly ctx: Context;
    public readonly config: OnebotUtilsConfig;
    public readonly logger: Logger;
    private disposeAgentPlugin?: () => void;

    constructor(ctx: Context, config: OnebotUtilsConfig) {
      this.ctx = ctx;
      this.config = config;
      this.logger = ctx.logger("yesimbot.onebot-utils");
      ctx.on("ready", this.start.bind(this));
      ctx.on("dispose", this.stop.bind(this));
    }

    async start(): Promise<void> {
      this.disposeAgentPlugin?.();
      this.disposeAgentPlugin = this.ctx.yesimbot.registerAgentPlugin((context) => {
        const tools = context.channel.platform === "onebot" ? createOnebotTools(context) : [];
        return {
          name: "onebot-utils",
          tools,
        } satisfies AgentPlugin;
      });
    }

    async stop(): Promise<void> {
      this.disposeAgentPlugin?.();
      this.disposeAgentPlugin = undefined;
    }
  }
  ```

- [ ] **Step 6: Run registration and gating tests**

  Run: `rtk yarn workspace koishi-plugin-yesimbot-onebot-utils exec vitest run tests/onebot-utils.test.ts`

  Expected: PASS for registration and non-OneBot gating tests.

- [ ] **Step 7: Add tests for tool names and adapter calls**

  Extend `plugins/onebot-utils/tests/onebot-utils.test.ts` with:

  ```ts
  it("exposes only completed migrated tools for OneBot channels", async () => {
    const { ctx, factories } = createContext();
    const plugin = new OnebotUtilsPlugin(ctx as never, {});
    await plugin.start();

    const agentPlugin = factories[0]!(createChannelContext() as never);
    expect(getTools(agentPlugin).map((tool) => tool.name)).toEqual([
      "onebot_get_forward_message",
      "onebot_create_reaction",
      "onebot_set_essence",
    ]);
  });

  it("fetches forward messages through OneBot internal", async () => {
    const { ctx, factories } = createContext();
    const forwardMessages = [{ message_id: 1 }];
    const internal = {
      getForwardMsg: vi.fn(async () => forwardMessages),
      setEssenceMsg: vi.fn(async () => undefined),
      _request: vi.fn(async () => ({ ok: true })),
    };
    const plugin = new OnebotUtilsPlugin(ctx as never, {});
    await plugin.start();

    const agentPlugin = factories[0]!(
      createChannelContext({ platform: { name: "onebot", unsafeBot: { internal } } }) as never,
    );
    const tool = getTools(agentPlugin).find((item) => item.name === "onebot_get_forward_message")!;

    await expect(tool.execute?.({ messageId: "abc" }, {} as never)).resolves.toBe(forwardMessages);
    expect(internal.getForwardMsg).toHaveBeenCalledWith("abc");
  });

  it("creates reactions through OneBot request API", async () => {
    const { ctx, factories } = createContext();
    const internal = {
      getForwardMsg: vi.fn(async () => []),
      setEssenceMsg: vi.fn(async () => undefined),
      _request: vi.fn(async () => ({ ok: true })),
    };
    const plugin = new OnebotUtilsPlugin(ctx as never, {});
    await plugin.start();

    const agentPlugin = factories[0]!(
      createChannelContext({ platform: { name: "onebot", unsafeBot: { internal } } }) as never,
    );
    const tool = getTools(agentPlugin).find((item) => item.name === "onebot_create_reaction")!;

    await expect(
      tool.execute?.({ messageId: "100", emojiId: "66" }, {} as never),
    ).resolves.toEqual({ ok: true });
    expect(internal._request).toHaveBeenCalledWith("set_msg_emoji_like", {
      message_id: "100",
      emoji_id: "66",
    });
  });

  it("sets essence messages through OneBot internal", async () => {
    const { ctx, factories } = createContext();
    const internal = {
      getForwardMsg: vi.fn(async () => []),
      setEssenceMsg: vi.fn(async () => ({ ok: true })),
      _request: vi.fn(async () => ({ ok: true })),
    };
    const plugin = new OnebotUtilsPlugin(ctx as never, {});
    await plugin.start();

    const agentPlugin = factories[0]!(
      createChannelContext({ platform: { name: "onebot", unsafeBot: { internal } } }) as never,
    );
    const tool = getTools(agentPlugin).find((item) => item.name === "onebot_set_essence")!;

    await expect(tool.execute?.({ messageId: "200" }, {} as never)).resolves.toEqual({
      success: true,
    });
    expect(internal.setEssenceMsg).toHaveBeenCalledWith("200");
  });
  ```

- [ ] **Step 8: Add tests for missing internal errors**

  Extend `plugins/onebot-utils/tests/onebot-utils.test.ts` with:

  ```ts
  it("fails clearly when OneBot internal is unavailable", async () => {
    const { ctx, factories } = createContext();
    const plugin = new OnebotUtilsPlugin(ctx as never, {});
    await plugin.start();

    const agentPlugin = factories[0]!(createChannelContext() as never);
    const tool = getTools(agentPlugin).find((item) => item.name === "onebot_get_forward_message")!;

    await expect(tool.execute?.({ messageId: "abc" }, {} as never)).rejects.toThrow(
      "当前频道的机器人适配器不支持 OneBot 协议",
    );
  });

  it("fails clearly when OneBot request API is unavailable", async () => {
    const { ctx, factories } = createContext();
    const internal = {
      getForwardMsg: vi.fn(async () => []),
      setEssenceMsg: vi.fn(async () => undefined),
    };
    const plugin = new OnebotUtilsPlugin(ctx as never, {});
    await plugin.start();

    const agentPlugin = factories[0]!(
      createChannelContext({ platform: { name: "onebot", unsafeBot: { internal } } }) as never,
    );
    const tool = getTools(agentPlugin).find((item) => item.name === "onebot_create_reaction")!;

    await expect(
      tool.execute?.({ messageId: "100", emojiId: "66" }, {} as never),
    ).rejects.toThrow("当前频道的机器人适配器不支持发送 OneBot 请求");
  });
  ```

- [ ] **Step 9: Run OneBot tests and type checks**

  Run: `rtk yarn workspace koishi-plugin-yesimbot-onebot-utils exec vitest run tests/onebot-utils.test.ts`

  Expected: PASS.

  Run: `rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-onebot-utils`

  Expected: PASS.

- [ ] **Step 10: Commit Task 4**

  ```bash
  git add plugins/onebot-utils
  git commit -m "feat(onebot-utils): migrate tools to agent runtime"
  ```

---

### Task 5: Final Verification

**Files:**
- Read: `openspec/changes/expose-channel-platform-context/specs/core-runtime-integration/spec.md`
- Read: `openspec/changes/expose-channel-platform-context/specs/onebot-utils/spec.md`
- Read: `openspec/changes/expose-channel-platform-context/tasks.md`

**Interfaces:**
- Consumes: completed implementation from Tasks 1-4.
- Produces: verified change ready for review.

- [ ] **Step 1: Run the scoped core test suite**

  Run: `rtk yarn turbo run test --filter=koishi-plugin-yesimbot`

  Expected: PASS.

- [ ] **Step 2: Run scoped core type checks**

  Run: `rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot`

  Expected: PASS.

- [ ] **Step 3: Validate the OpenSpec change**

  Run: `rtk openspec validate expose-channel-platform-context --strict`

  Expected: `Change 'expose-channel-platform-context' is valid`.

- [ ] **Step 4: Run OneBot utility plugin checks**

  Run: `rtk yarn turbo run test --filter=koishi-plugin-yesimbot-onebot-utils`

  Expected: PASS.

  Run: `rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-onebot-utils`

  Expected: PASS.

- [ ] **Step 5: Review the final diff for boundary creep**

  Run: `rtk git diff -- core packages/agent-runtime plugins/onebot-utils openspec/changes/expose-channel-platform-context`

  Expected: core type/service/test changes, new `plugins/onebot-utils` package, and OpenSpec artifacts only; no `packages/agent-runtime` API changes.

- [ ] **Step 6: Commit verification updates if task checkboxes or verification notes were edited**

  ```bash
  git add openspec/changes/expose-channel-platform-context/tasks.md openspec/changes/expose-channel-platform-context/plan.md
  git commit -m "docs(openspec): plan channel platform context"
  ```
