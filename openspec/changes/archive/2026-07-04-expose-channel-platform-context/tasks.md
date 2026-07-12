## 1. Core Context API

- [x] 1.1 Extend `ChannelAgentContext` in `core/src/shared/types.ts` with readonly `platform.name` and optional readonly `platform.unsafeBot`.
- [x] 1.2 Import Koishi `Bot` as a type-only dependency for the context shape.
- [x] 1.3 Keep `AgentPluginFactory` unchanged so external plugins still receive one context object and return one `AgentPlugin`.

## 2. Runtime Context Population

- [x] 2.1 Update `YesImBotService.createChannelContext(session)` to populate `platform.name` from `session.platform`.
- [x] 2.2 Populate `platform.unsafeBot` from `session.bot` when available.
- [x] 2.3 Confirm `createAgent()` calls and `AgentToolExecuteContext` remain unchanged, with no Koishi objects added to `agent-runtime`.

## 3. Tests

- [x] 3.1 Update existing `ChannelAgentContext` test fixtures with the new `platform` section.
- [x] 3.2 Add service coverage showing registered factories can observe `platform.name`.
- [x] 3.3 Add service coverage showing registered factories can receive the raw `unsafeBot` captured from the channel creation session when available.
- [x] 3.4 Add or update boundary assertions that `ctx.yesimbot` still does not expose runtime handles and `agent-runtime` tool context remains Koishi-free.

## 4. Verification

- [x] 4.1 Run scoped core tests for service/runtime integration.
- [x] 4.2 Run scoped core type checks.
- [x] 4.3 Run `openspec validate expose-channel-platform-context --strict`.

## 5. OneBot Utils Migration

- [x] 5.1 Create `plugins/onebot-utils` package following current `plugins/*` package conventions.
- [x] 5.2 Migrate legacy forward-message, reaction, and essence tools to `AgentTool` definitions using `context.platform.unsafeBot`.
- [x] 5.3 Exclude the incomplete legacy `onebot_get_message_id` tool from the first migration.
- [x] 5.4 Register the plugin through `ctx.yesimbot.registerAgentPlugin` and gate tools to `context.channel.platform === "onebot"`.
- [x] 5.5 Add tests for non-OneBot gating, missing internal errors, and adapter call shapes for each migrated tool.
- [x] 5.6 Run scoped onebot-utils type checks and tests.
