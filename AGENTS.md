# Athena Agent Guide

## Project Overview

Athena / YesImBot v4 is a Yarn 4 monorepo for Koishi-based LLM chat agents. The current codebase is centered on a message-first `@yesimbot/agent-runtime` and a slim Koishi core service.

- `core/` is the main `koishi-plugin-yesimbot` package: Koishi integration, model registry, message routing, prompt files, JSONL channel storage, and per-channel agent creation.
- `packages/agent-runtime/` is the generic runtime core: `createAgent`, turn queue, message storage, plugin hooks, tools, state, channel events, and dogfood plugins.
- `plugins/*` are optional Koishi integrations that register `@yesimbot/agent-runtime` `AgentPlugin`s through `ctx.yesimbot.registerAgentPlugin()`.
- `providers/*` are model provider plugins built on AI SDK providers and registered into `ctx["yesimbot.model"]`.

## Working Rules

- 默认用中文沟通；代码、标识符、日志和错误信息保持原文。
- Follow KISS / YAGNI / DRY / SOLID: keep changes direct, scoped, justified by current requirements, and easy to verify.
- This repo uses Yarn 4 with `nodeLinker: node-modules`; use `yarn`, not `pnpm` or `npm`.
- Shell commands should follow `~/.agents/RTK.md` when available: prefix commands with `rtk` (`rtk yarn test`, `rtk git status`). Use `rtk proxy <cmd>` only when raw command output is needed.
- Pre-commit runs `npx lint-staged`, which applies `oxlint --fix` and `oxfmt --write` to staged JS/TS and JSON files.
- `dist/`, `.turbo/`, caches, and generated outputs are not source of truth.
- `references/` and `node_modules/` are `.gitignore`-excluded. If you must inspect them, use absolute paths and do not let them dominate source-based decisions.
- Do not overwrite or revert user changes unless explicitly asked.
- Keep edits local to the requested behavior. Do not mix unrelated refactors, style churn, or speculative extension points into the same change.

## Search And Context

- Use `mcp__augment_context_engine.codebase_retrieval` first for semantic codebase understanding or when file locations are uncertain.
- Use `rg` / `rg --files` for exact identifiers, known strings, and fast file discovery.
- Use subagents for independent research or risky parallel work, and always wait for them before yielding.

## Build And Verification

Use the narrowest command that proves the change.

```bash
# full pipeline (CI order)
rtk yarn lint
rtk yarn fmt:check
rtk yarn check-types
rtk yarn build
rtk yarn test

# package-scoped checks
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
rtk yarn turbo run test --filter=koishi-plugin-yesimbot
rtk yarn turbo run check-types --filter=@yesimbot/agent-runtime
rtk yarn turbo run test --filter=@yesimbot/agent-runtime
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-workspace
rtk yarn turbo run test --filter=koishi-plugin-yesimbot-workspace
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-skills
rtk yarn turbo run test --filter=koishi-plugin-yesimbot-skills
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-mcp-client
rtk yarn turbo run test --filter=koishi-plugin-yesimbot-mcp-client
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-memos-client
rtk yarn turbo run test --filter=koishi-plugin-yesimbot-memos-client

# single test files
rtk yarn workspace @yesimbot/agent-runtime exec vitest run tests/turn.test.ts
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/message-flow.test.ts
rtk yarn workspace koishi-plugin-yesimbot-memos-client exec vitest run tests/tools.test.ts
```

- Root `yarn test` runs workspaces with a `test` script; Turbo task `test` depends on `build`.
- Run package-scoped `build` first if test resolution fails on workspace references.
- For docs-only changes, a readback or targeted markdown inspection is usually sufficient.

## Current Architecture

- `core/src/index.ts` is the Koishi entrypoint. It registers `ModelService` and `YesImBotService`.
- `core/src/service.ts` owns the public `ctx.yesimbot` service. It handles `yesimbot.reset`, Koishi middleware, per-channel runtime cache, plugin factory registration, and `createAgent()` wiring.
- Channel runtime keys are `platform:selfId:channelId`; JSONL history lives under `<basePath>/sessions/<platform-selfId-channelId>.jsonl`.
- Message routing is intentionally small: self messages are ignored; non-private/non-mention messages are appended as observation; private or mention messages start a turn; busy channels join the active turn.
- Runtime prompt composition starts with `buildCoreSystemPrompt()` and then optionally appends runtime prompt files from the configured data `basePath`: `AGENTS.md` and `PERSONA.md`. Do not confuse those runtime prompt files with this repository developer guide.
- `core/src/model/` owns `ctx["yesimbot.model"]`, `models.json` loading, aliases/defaults, Koishi schema refresh, and provider registration.
- Provider packages use `createProviderPlugin()` from `koishi-plugin-yesimbot/model` and AI SDK provider packages.
- `packages/agent-runtime/src/agent.ts` owns the turn lifecycle: `append()`, `send()`, `run()`, `waitTurn()`, interruption, storage serialization, tool wrapping, streamed model execution, and terminal events.
- `packages/agent-runtime/src/plugin.ts` owns ordered plugin hooks: append/message transforms, model projection, prompt/tool extension, tool call hooks, and turn finish hooks.
- Optional plugins should register agent behavior via `ctx.yesimbot.registerAgentPlugin(factory)`. The old `core/src/extension/*` files are currently empty placeholders and are not the active plugin lifecycle.

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

- `core/src/service.ts` — Koishi service, channel routing, per-channel agent creation, reset/stop lifecycle.
- `core/src/runtime/` — channel key/path, platform message conversion, prompt file loading, JSONL storage, output rendering.
- `core/src/model/` — model config, provider contracts, schema helpers, model resolution.
- `packages/agent-runtime/src/` — runtime core, plugin host, tools, storage, messages, events, turn queue, state.
- `plugins/*/src/index.ts` — Koishi optional plugin entrypoints and `registerAgentPlugin()` usage.
- `providers/*/src/index.ts` — provider plugin definitions and default model schemas.

## Reporting

When finishing a coding task, summarize:

- What changed and where.
- How KISS / YAGNI / DRY / SOLID affected the implementation.
- What verification ran, with failures or skipped checks called out clearly.
- Any remaining risk or focused next step directly tied to the request.
