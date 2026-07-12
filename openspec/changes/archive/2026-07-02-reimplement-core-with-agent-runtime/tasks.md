## 1. Runtime Semantics

- [x] 1.1 Add focused tests for `agent.interrupt()` covering active turn abort, no-op without active turn, retained aborted `TurnResult`, and post-interrupt runtime reuse.
- [x] 1.2 Implement `agent.interrupt(reason?)` in `@yesimbot/agent-runtime` with best-effort active turn cancellation and stable aborted settlement.
- [x] 1.3 Add focused tests for active-turn `append()` observation visibility at the next safe model boundary while preserving append-only order.
- [x] 1.4 Implement active-turn appended observation draining so observations can enter later model requests in the same active turn without becoming joined explicit input.
- [x] 1.5 Verify existing `append`, `send`, `run`, `waitTurn`, busy `join`, and tool execution tests still pass after the runtime changes.

## 2. Core Storage and Channel Identity

- [x] 2.1 Add core tests for channel runtime key generation using `platform + selfId + channelId` and excluding channel type from the key.
- [x] 2.2 Implement safe channel runtime key helpers and sanitized JSONL filename generation under `basePath/sessions/`.
- [x] 2.3 Add tests for JSONL storage `append`, `read`, and `clear`, including restart-style read from an existing file.
- [x] 2.4 Implement the core-owned JSONL `AgentStorage` adapter with append-only writes and simple full-file reads.
- [x] 2.5 Ensure relative `basePath` values resolve against Koishi `ctx.baseDir` and absolute values are used as-is.

## 3. Core Service API

- [x] 3.1 Add tests for `ctx.yesimbot.registerAgentPlugin(factory)` registration, disposal, registration order, and future-runtime-only behavior.
- [x] 3.2 Implement the `ctx.yesimbot` service with `registerAgentPlugin(factory)` and `resetChannel(target)`.
- [x] 3.3 Define `AgentPluginFactory`, `ChannelAgentContext`, and `ChannelRuntimeTarget` exports from the core-owned API surface.
- [x] 3.4 Keep `ctx["yesimbot.model"]` as the provider registry service and avoid exposing runtime handles through `ctx.yesimbot`.

## 4. Built-In Runtime Plugins and Prompt Injection

- [x] 4.1 Add tests for `athena.channel.message` model projection that preserves Koishi content and formats sender display consistently.
- [x] 4.2 Implement the built-in channel message runtime plugin.
- [x] 4.3 Add tests for `AGENTS.md` and `PERSONA.md` loading from unified `basePath` and injection order through `transformMessages()`.
- [x] 4.4 Implement built-in prompt injection plugins for `AGENTS.md` and optional `PERSONA.md`, accepting the documented transform-pipeline side effect.
- [x] 4.5 Add tests proving core built-in plugins are placed before externally registered plugins.

## 5. Koishi Message Flow

- [x] 5.1 Add core tests for ignoring bot self messages.
- [x] 5.2 Add core tests for ordinary group messages calling `append()` without triggering a reply.
- [x] 5.3 Add core tests for direct messages and bot mentions calling `send()` and rendering all non-empty assistant text replies.
- [x] 5.4 Add core tests for busy direct or mentioned messages using join behavior.
- [x] 5.5 Implement the Koishi middleware routing rules for self-ignore, ordinary group append, direct send, mentioned send, and busy join.
- [x] 5.6 Implement assistant reply extraction for all non-empty assistant text messages while ignoring tool messages and empty output.

## 6. Reset, Disposal, and Error Behavior

- [x] 6.1 Add tests for `resetChannel(target)` interrupting, stopping, clearing JSONL, and removing the cached runtime.
- [x] 6.2 Add tests for the reset command resetting only the current channel and requiring administrator authority.
- [x] 6.3 Implement `resetChannel(target)` and the minimal current-channel Koishi reset command.
- [x] 6.4 Add tests for Koishi dispose interrupting and stopping all cached runtimes.
- [x] 6.5 Implement dispose cleanup for all known channel runtimes.
- [x] 6.6 Add tests for generic development-time error replies on direct or mentioned turn failures and log-only behavior for ordinary append failures.
- [x] 6.7 Implement minimal error handling and logger wiring for runtime, plugin, tool, provider, storage, and message-routing diagnostics.

## 7. Verification

- [x] 7.1 Run `yarn workspace @yesimbot/agent-runtime test` after runtime changes.
- [x] 7.2 Run core-scoped tests for `koishi-plugin-yesimbot`.
- [x] 7.3 Run `yarn turbo run check-types --filter=@yesimbot/agent-runtime --filter=koishi-plugin-yesimbot`.
- [x] 7.4 Run `yarn turbo run build --filter=@yesimbot/agent-runtime --filter=koishi-plugin-yesimbot`.
- [x] 7.5 Run `openspec validate reimplement-core-with-agent-runtime --json`.
