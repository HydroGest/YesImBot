# Athena Agent Guide

## Project Overview

Athena / YesImBot v4 is a Yarn 4 monorepo for Koishi-based LLM chat agents. The current codebase is centered on a message-first `@yesimbot/agent-runtime` and a slim Koishi core service.

- `core/` is the main `koishi-plugin-yesimbot` package: Koishi integration, model registry, `gateway.ts`, channel storage, `asset.ts`, and RuntimeManager/ChannelRuntime ownership.
- `packages/agent-runtime/` is the generic runtime core: `createAgent`, turn queue, message storage, plugin hooks, tools, state, channel events, and dogfood plugins.
- `core/src/platforms/` contains built-in platform Resolvers. They register through `ctx.yesimbot.registerResolver()` and own platform-specific input resolution and image persistence.
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

- `core/src/index.ts` is the Koishi entrypoint. It registers `ModelService`, `YesImBotService`, and built-in platform registration; Database is a required injection.
- `core/src/service.ts` owns the public `ctx.yesimbot` facade: `model`, `assets`, Resolver/Agent-plugin registration, `getStoragePath(scope)`, reset, and stop. It has no public identity, storage namespace, or reload API. Gateway, RuntimeManager, ChannelRuntime, ChannelStorage, concrete AssetStore, and assignee admission stay private.
- `core/src/gateway.ts` owns Koishi middleware and `internal/session` admission. It checks allowlist and shared assignee before creating the Resolver-owned `AssetStore`, invokes the one registered Resolver, assembles host-owned records, and sends passively through `Session.send()`. Unregistered platforms have no fallback.
- `core/src/runtime/manager.ts` owns RuntimeManager creation, replacement, reset, and global stop. It uses a private persistent-tuple key. When the Bot for a shared scope changes, it stops the old Runtime, deletes it, creates the new Runtime, and handles the current record. `runtime/channel.ts` owns one channel FIFO, Agent, WillEngine, JSONL, prompt/plugin assembly, model input, output queue, and stop. `runtime/prompt.ts` owns Constitution version 3 and package resource loading; `runtime/index.ts` exports RuntimeManager, AgentPluginFactory, ChannelRuntime, and their option/result types only.
- `core/src/channel.ts` keeps the public raw `ChannelScope` and private tuple, directory, Manifest, and ChannelStorage helpers. Shared storage derives from `platform + channelId`; direct storage includes `selfId`. No public or persistent channel identity exists. Readable `shared-*` / `direct-*` channel roots hold versionless `channel.json`, `sessions/`, `assets/`, and plugin-selected child directories.
- `core/src/input.ts` owns versionless public Message/Event records and Drafts. `runtime/storage.ts` reads JSONL with `JSON.parse`, warns and skips invalid JSON syntax, and does no semantic validation on successfully parsed lines.
- `core/src/asset.ts` implements the public `AssetService` / `AssetStore` interfaces exposed at `ctx.yesimbot.assets`. Resolver code owns image downloads and decides which bytes to persist; `runtime/model-input.ts` projects persisted asset images for model calls.
- The input pipeline is: allowlist -> shared assignee admission -> channel AssetStore -> registered Resolver -> host-owned InputRecord -> RuntimeManager -> ChannelRuntime FIFO -> wait, join, or one output consumer -> passive Gateway delivery. A delivery failure returns through the producing Runtime.
- Reset stops a cached Runtime and clears only `sessions/` and `assets`, preserving the Manifest, workspace, and plugin-selected children. Global stop closes admission, stops runtimes, waits active Gateway handlers, and preserves data. Old layouts and JSONL remain unread; no migration, dual read, alias, or fallback exists.
- ChannelRuntime initialization uses Constitution version 3, optional `<agents>`, exactly one `<persona>`, and `<runtime_context>` from ChannelScope plus Bot selfId before plugin instructions, native tools, and model. Do not confuse runtime `AGENTS.md` and `PERSONA.md` prompt files with this repository developer guide.
- `core/src/model/` owns `ctx["yesimbot.model"]`, `models.json` loading, aliases/defaults, Koishi schema refresh, and provider registration.
- Provider packages use `createProviderPlugin()` from `koishi-plugin-yesimbot/model` and AI SDK provider packages.
- `packages/agent-runtime/src/agent.ts` owns the turn lifecycle: `append()`, `send()`, `run()`, idle `wait()`, interruption, storage serialization, tool wrapping, streamed model execution, and terminal events. `Agent.setModel()` and `Agent.setTools()` no longer exist; runtime replacement activates stable resource changes.
- `packages/agent-runtime/src/plugin.ts` owns ordered plugin hooks: append/message transforms, model projection, prompt/tool extension, tool call hooks, and turn finish hooks.
- Optional plugins register Agent behavior through `ctx.yesimbot.registerAgentPlugin(factory)`; trusted plugins use `getStoragePath(scope)` and select their own channel-root child paths.

## Workspace Package Names

| Directory                 | npm name                                     |
| ------------------------- | -------------------------------------------- |
| `core/`                   | `koishi-plugin-yesimbot`                     |
| `packages/agent-runtime/` | `@yesimbot/agent-runtime`                    |
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

- `core/src/service.ts` — public YesImBot facade, assets, reset command, storage ownership, and Gateway/RuntimeManager composition.
- `core/src/gateway.ts` — Session admission, registered Resolver selection, private shared-assignee admission, passive delivery, and Session lifetime.
- `core/src/input.ts` — declaration-mergeable EventMap, versionless Message/Event records, Drafts, and Agent custom-message helpers.
- `core/src/channel.ts` — raw ChannelScope plus private tuple, Manifest, safe channel paths, and storage.
- `core/src/asset.ts` — AssetService/AssetStore interfaces and private content-addressed implementation.
- `core/src/runtime/manager.ts` — RuntimeManager lifecycle and runtime construction.
- `core/src/runtime/channel.ts` — ChannelRuntime FIFO, Agent assembly, model input, output ownership, and delivery feedback.
- `core/src/runtime/prompt.ts` — package prompt resources and core system-prompt construction.
- `core/src/runtime/storage.ts` — JSONL append and parse-only read-back.
- `core/src/runtime/{will,reply,output-queue,model-input}.ts` — ChannelRuntime-internal decision, output, and model projection helpers.
- `core/src/model/` — model config, provider contracts, schema helpers, and model resolution.
- `core/src/platforms/*/` — built-in Resolver entrypoints.
- `plugins/*/src/index.ts` — Koishi optional plugin entrypoints and `registerAgentPlugin()` usage.
- `providers/*/src/index.ts` — provider plugin definitions and default model schemas.

## Reporting

When finishing a coding task, summarize:

- What changed and where.
- What verification ran, with failures or skipped checks called out clearly.
- Any remaining risk or focused next step directly tied to the request.
