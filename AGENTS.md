# Athena Agent Guide

## Project Overview

Athena / YesImBot v4 is a Yarn 4 monorepo for Koishi-based LLM chat agents. The current codebase is centered on a message-first `@yesimbot/agent-runtime` and a slim Koishi core service.

- `core/` is the main `koishi-plugin-yesimbot` package: Koishi integration, model registry, Session Gateway, split Message/Event routing, RuntimeManager/ChannelRuntime ownership, channel storage, prompt files, and JSONL history.
- `packages/agent-runtime/` is the generic runtime core: `createAgent`, turn queue, message storage, plugin hooks, tools, state, channel events, and dogfood plugins.
- `platforms/*` are platform-input adapters. They register one `SessionResolver` per platform through `ctx.yesimbot.registerResolver()` and keep platform-specific Session resolution outside Core.
- `plugins/*` are optional Koishi integrations that register `@yesimbot/agent-runtime` `AgentPlugin`s through `ctx.yesimbot.registerAgentPlugin()`.
- `providers/*` are model provider plugins built on AI SDK providers and registered into `ctx["yesimbot.model"]`.

## Working Rules

- 默认用中文沟通；代码、标识符、日志和错误信息保持原文。
- Follow KISS / YAGNI / DRY / SOLID: keep changes direct, scoped, justified by current requirements, and easy to verify.
- This repo uses Yarn 4 with `nodeLinker: node-modules`; use `yarn`, not `pnpm` or `npm`.
- Shell commands should follow rtk instructions when available: prefix commands with `rtk` (`rtk yarn test`, `rtk git status`). Use `rtk proxy <cmd>` only when raw command output is needed.
- `dist/`, `.turbo/`, caches, and generated outputs are not source of truth.
- `references/` and `node_modules/` are `.gitignore`-excluded. If you must inspect them, use absolute paths and do not let them dominate source-based decisions.
- Do not overwrite or revert user changes unless explicitly asked.
- Keep edits local to the requested behavior. Do not mix unrelated refactors, style churn, or speculative extension points into the same change.

## Search And Context

- Use `codegraph_explore` first for semantic codebase understanding or when file locations are uncertain.
- Use `rg` / `rg --files` for exact identifiers, known strings, and fast file discovery.
- Use subagents for independent research or risky parallel work, and always wait for them before yielding.

## Build And Verification

Use the narrowest command that proves the change.

```bash
# full pipeline (CI order)
yarn lint
yarn fmt:check
yarn check-types
yarn build
yarn test

# package-scoped checks
yarn turbo run check-types --filter=<package>
yarn turbo run test --filter=<package>

# single test files
yarn workspace @yesimbot/agent-runtime exec vitest run tests/turn.test.ts
yarn workspace koishi-plugin-yesimbot exec vitest run tests/gateway.test.ts
yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel-runtime.test.ts
yarn workspace koishi-plugin-yesimbot exec vitest run tests/runtime-manager.test.ts
yarn workspace koishi-plugin-yesimbot exec vitest run tests/storage.test.ts
yarn workspace koishi-plugin-yesimbot exec vitest run tests/gateway-delivery.test.ts
yarn workspace koishi-plugin-yesimbot-memos-client exec vitest run tests/tools.test.ts
```

- Root `yarn test` runs workspaces with a `test` script; Turbo task `test` depends on `build`.
- Run package-scoped `build` first if test resolution fails on workspace references.
- For docs-only changes, a readback or targeted markdown inspection is usually sufficient.

## Current Architecture

- `core/src/index.ts` is the Koishi entrypoint. It registers `ModelService` and `YesImBotService`; Database is a required injection.
- `core/src/service.ts` owns the public `ctx.yesimbot` facade: model, resolver/Agent plugin registration, `channelIdentity`/storage methods, non-destructive `reload(scope)`, reset, and stop. Gateway, RuntimeManager, ChannelRuntime, ChannelStorage, AssetStore, and assignee helpers stay private.
- `core/src/gateway/index.ts` owns Koishi middleware and `internal/session` admission, one Resolver call, bounded image freezing, passive `Session.send()`, and same-channel `delivery.failed` feedback. A Session never leaves its active Gateway handle.
- `core/src/runtime/manager.ts` owns RuntimeManager: one Runtime entry per `channelIdentity`, per-identity lifecycle coordination, Database assignee revalidation, reset, global stop, and explicit reload. `runtime/channel.ts` owns ChannelRuntime: one channel FIFO, Agent, WillEngine, JSONL storage, prompt/plugin assembly, atomic append/join/run submission, one stream consumer, graceful drain, and stop. `runtime/delivery.ts` owns delivery state; `runtime/serial-queue.ts` owns rejection-safe FIFO scheduling; `runtime/index.ts` is the barrel.
- `core/src/media/index.ts` owns the unified multimedia policy consumers: Gateway image freezing, AssetStore persistence, MIME detection, and model-call image selection. `reload(scope)` refreshes Gateway and AssetStore from the current policy after draining the scoped runtime.
- Channel runtime identities are unified 26-character lowercase Base32 `channelIdentity` values derived from a versioned canonical tuple. Shared identity = `platform + channelId`; direct identity = `platform + selfId + channelId`. JSONL history lives under `<basePath>/channels/v1-shared-*/` or `v1-direct-*/sessions/messages.jsonl`.
- The storage layout is channel-first: each readable `v1-shared-<platform>-<channelId>` or `v1-direct-<platform>-<channelId>-<selfId>` directory has an authoritative `channel.json`. Startup scans valid Manifests into memory; `channels.json` is not created. Session storage lives under `sessions/`, assets under `assets/`, workspace under `workspace/`, and registered module namespaces are isolated per channel.
- Ordinary inputs persist as `yesimbot.message` with `elements` as the sole structured message field, frozen `text`, and `messageId`. Non-message inputs persist as `yesimbot.event` with `eventType` and frozen `text`. Database is a required injection (`"database"`); shared-channel admission queries the Koishi Channel row by `(platform, channelId)` and requires `assignee === session.selfId`. Direct events skip assignee lookup.
- After a shared assignee change, the old Runtime is drained via explicit `reload(scope)`. The next admitted event lazily creates a new Runtime for the current assignee without changing `channelIdentity`, JSONL, assets, or workspace.
- The message pipeline is: Session admission -> Resolver or Satori fallback -> sealed MessageRecord/EventRecord -> RuntimeManager -> ChannelRuntime persist/observe/WillEngine FIFO -> idle run or busy join -> one internal stream consumer -> Gateway passive delivery. Delivery failure is persisted through the producing Runtime's completion lane.
- Reset checks assignment, stops the matching Runtime, clears only `sessions` and `assets`, and preserves the Manifest, workspace, and other namespaces. Global stop rejects new admission, tears down runtimes, waits active Gateway handlers, and preserves persisted data. Old hash directories and old JSONL remain on disk but are unread; no migration, dual read, alias, or fallback exists.
- ChannelRuntime initialization freezes Constitution version 1, optional `<agents>`, exactly one `<persona>`, `<runtime_context>`, plugin instructions, native tools, model, and provider in that order. Do not confuse runtime `AGENTS.md` and `PERSONA.md` prompt files with this repository developer guide.
- `core/src/model/` owns `ctx["yesimbot.model"]`, `models.json` loading, aliases/defaults, Koishi schema refresh, and provider registration.
- Provider packages use `createProviderPlugin()` from `koishi-plugin-yesimbot/model` and AI SDK provider packages.
- `packages/agent-runtime/src/agent.ts` owns the turn lifecycle: `append()`, `send()`, `run()`, idle `wait()`, interruption, storage serialization, tool wrapping, streamed model execution, and terminal events. `Agent.setModel()` and `Agent.setTools()` no longer exist; runtime replacement activates stable resource changes.
- `packages/agent-runtime/src/plugin.ts` owns ordered plugin hooks: append/message transforms, model projection, prompt/tool extension, tool call hooks, and turn finish hooks.
- Optional plugins register Agent behavior through `ctx.yesimbot.registerAgentPlugin(factory)` and channel storage through a unique `registerStorage(namespace)` registration.

## Workspace Package Names

| Directory                 | npm name                                     |
| ------------------------- | -------------------------------------------- |
| `core/`                   | `koishi-plugin-yesimbot`                     |
| `packages/agent-runtime/` | `@yesimbot/agent-runtime`                    |
| `platforms/onebot/`       | `koishi-plugin-yesimbot-platform-onebot`     |
| `plugins/workspace/`      | `koishi-plugin-yesimbot-workspace`           |
| `plugins/skills/`         | `koishi-plugin-yesimbot-skills`              |
| `plugins/mcp-client/`     | `koishi-plugin-yesimbot-mcp-client`          |
| `plugins/memos-client/`   | `koishi-plugin-yesimbot-memos-client`        |
| `plugins/onebot-utils/`   | `koishi-plugin-yesimbot-onebot-utils`        |
| `plugins/search-service/` | `koishi-plugin-yesimbot-search-service`      |
| `plugins/sticker/`        | `koishi-plugin-yesimbot-sticker`             |
| `providers/openai/`       | `@yesimbot/koishi-plugin-provider-openai`    |
| `providers/anthropic/`    | `@yesimbot/koishi-plugin-provider-anthropic` |
| `providers/deepseek/`     | `@yesimbot/koishi-plugin-provider-deepseek`  |
| `providers/google/`       | `@yesimbot/koishi-plugin-provider-google`    |

## Context Files

Load these on demand when deeper context is needed:

- `core/src/service.ts` — public YesImBot facade, reset command, storage ownership, and Gateway/RuntimeManager composition.
- `core/src/gateway/index.ts` — Session admission, Resolver selection, Satori fallback, image freezing, passive delivery, and Session lifetime.
- `core/src/event/` — declaration-mergeable EventMap/EventRecord contracts, message sealing, and model formatting.
- `core/src/runtime/manager.ts` — RuntimeManager lifecycle and runtime construction.
- `core/src/runtime/channel.ts` — ChannelRuntime FIFO, Agent assembly, prompt and JSONL ownership.
- `core/src/runtime/delivery.ts` — delivery leases, abort signals, and output queue state.
- `core/src/runtime/serial-queue.ts` — rejection-safe FIFO scheduling.
- `core/src/runtime/index.ts` — runtime barrel; `core/src/runtime/prompts/` and `core/src/runtime/storage.ts` provide prompt and JSONL support.
- `core/src/storage/` and `core/src/channel/` — canonical `channelIdentity`, readable Manifest-backed directories, namespace registry, and safe channel paths.
- `core/src/media/index.ts` — internal AssetStore, image freezing, MIME detection, and model-call image selection; `core/src/event/element.ts` and `core/src/runtime/index.ts` provide element helpers and Database assignee assertion.
- `core/src/model/` — model config, provider contracts, schema helpers, model resolution.
- `packages/agent-runtime/src/` — runtime core, plugin host, tools, storage, messages, events, turn queue, state.
- `plugins/*/src/index.ts` — Koishi optional plugin entrypoints and `registerAgentPlugin()` usage.
- `platforms/*/src/index.ts` — platform Resolver entrypoints and `ctx.yesimbot.registerResolver()` usage.
- `providers/*/src/index.ts` — provider plugin definitions and default model schemas.

## Reporting

When finishing a coding task, summarize:

- What changed and where.
- What verification ran, with failures or skipped checks called out clearly.
- Any remaining risk or focused next step directly tied to the request.
