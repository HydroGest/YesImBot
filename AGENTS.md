# Athena Agent Guide

## Project Overview

Athena / YesImBot v4 is a Yarn 4 monorepo for Koishi-based LLM chat agents. The current codebase is centered on a message-first `@yesimbot/agent-runtime` and a slim Koishi core service.

- `core/` is the main `koishi-plugin-yesimbot` package: Koishi integration, model registry, message routing, prompt files, JSONL channel storage, and per-channel agent creation.
- `packages/agent-runtime/` is the generic runtime core: `createAgent`, turn queue, message storage, plugin hooks, tools, state, channel events, and dogfood plugins.
- `platforms/*` are platform-input adapters. They register `Platform.Adapter` instances through `ctx.yesimbot.platform` and keep platform-specific Session refinement and bounded input preparation outside core.
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
yarn workspace koishi-plugin-yesimbot exec vitest run tests/message-flow.test.ts
yarn workspace koishi-plugin-yesimbot-memos-client exec vitest run tests/tools.test.ts
```

- Root `yarn test` runs workspaces with a `test` script; Turbo task `test` depends on `build`.
- Run package-scoped `build` first if test resolution fails on workspace references.
- For docs-only changes, a readback or targeted markdown inspection is usually sufficient.

## Current Architecture

- `core/src/index.ts` is the Koishi entrypoint. It registers `PlatformService`, `ModelService`, and `YesImBotService` in that order.
- `core/src/runtime/service.ts` owns the public `ctx.yesimbot` service and its `platform` property. It handles `yesimbot.reset`, Koishi middleware, per-channel runtime cache, plugin factory registration, and `createAgent()` wiring.
- Channel runtime keys are `platform:selfId:channelId`; JSONL history lives under `<basePath>/sessions/<platform-selfId-channelId>.jsonl`.
- `PlatformService` collects a Session once, selects and runs one adapter refiner, and retains an admitted `Platform.Message` only for that Session. It publishes only `Platform.Event` values to subscribers through `ctx.yesimbot.platform`.
- The message pipeline is: Session collection and refinement -> per-channel FIFO classification -> adapter image preparation and sealing -> channel Agent resolution -> append, busy `send(join)`, or `run`. The final busy read occurs after preparation; stream consumption occurs outside the FIFO. Reset queues `interrupt`, `stop`, storage clear, asset clear, and runtime-cache deletion in that order.
- Runtime prompt composition starts with `buildCoreSystemPrompt()` and then optionally appends runtime prompt files from the configured data `basePath`: `AGENTS.md` and `PERSONA.md`. Do not confuse those runtime prompt files with this repository developer guide.
- `core/src/model/` owns `ctx["yesimbot.model"]`, `models.json` loading, aliases/defaults, Koishi schema refresh, and provider registration.
- Provider packages use `createProviderPlugin()` from `koishi-plugin-yesimbot/model` and AI SDK provider packages.
- `packages/agent-runtime/src/agent.ts` owns the turn lifecycle: `append()`, `send()`, `run()`, idle `wait()`, interruption, storage serialization, tool wrapping, streamed model execution, and terminal events.
- `packages/agent-runtime/src/plugin.ts` owns ordered plugin hooks: append/message transforms, model projection, prompt/tool extension, tool call hooks, and turn finish hooks.
- Optional plugins should register agent behavior via `ctx.yesimbot.registerAgentPlugin(factory)`. The old `core/src/extension/*` files are currently empty placeholders and are not the active plugin lifecycle.

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

- `core/src/platform/` — public platform contracts, adapter selection/refinement, event publication, image asset storage, message sealing, and projection.
- `core/src/runtime/service.ts` — public YesImBot service, channel FIFO, routing, per-channel Agent creation, reset/stop lifecycle.
- `core/src/runtime/` — channel key/path, platform message conversion, prompt file loading, JSONL storage, output rendering.
- `core/src/model/` — model config, provider contracts, schema helpers, model resolution.
- `packages/agent-runtime/src/` — runtime core, plugin host, tools, storage, messages, events, turn queue, state.
- `plugins/*/src/index.ts` — Koishi optional plugin entrypoints and `registerAgentPlugin()` usage.
- `platforms/*/src/index.ts` — platform adapter entrypoints and `ctx.yesimbot.platform.register()` usage.
- `providers/*/src/index.ts` — provider plugin definitions and default model schemas.

## Reporting

When finishing a coding task, summarize:

- What changed and where.
- How KISS / YAGNI / DRY / SOLID affected the implementation.
- What verification ran, with failures or skipped checks called out clearly.
- Any remaining risk or focused next step directly tied to the request.
