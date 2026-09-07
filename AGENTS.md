# Athena Agent Guide

## Project Overview

Athena / YesImBot v4 is a Yarn 4 monorepo for Koishi-based LLM chat agents. The current codebase is centered on a message-first `@yesimbot/agent-runtime` and a slim Koishi core service.

- `core/` is the main `koishi-plugin-yesimbot` package: Koishi integration, model registry, `messengers/`, Channels/Resources, Conversations, Agents, Runtimes, and built-in platform registration.
- `packages/agent-runtime/` is the generic runtime core: `createAgent`, turn queue, message storage, plugin hooks, tools, state, channel events, and dogfood plugins.
- `core/src/messengers/index.ts` implements the built-in Messenger. Translators register through `ctx.yesimbot.messenger.use()` and own platform-specific live-Session input resolution and resource persistence.
- `plugins/*` are optional Koishi integrations that register named `AgentPlugin` or `WillPlugin` objects through `ctx.yesimbot.agent.use()` / `agent.will()`.
- `providers/*` are model provider plugins built on AI SDK providers and registered into `ctx["yesimbot.model"]`.

## Working Rules

- 默认用中文沟通；代码、标识符、日志和错误信息保持原文。
- Follow KISS / YAGNI / DRY / SOLID: keep changes direct, scoped, justified by current requirements, and easy to verify.
- This repo uses Yarn 4 with `nodeLinker: node-modules`; use `yarn`, not `pnpm` or `npm`.
- `dist/`, caches, and generated outputs are not source of truth.
- `references/` and `node_modules/` are `.gitignore`-excluded. If you must inspect them, use absolute paths and do not let them dominate source-based decisions.
- Do not overwrite or revert user changes unless explicitly asked.
- Keep edits local to the requested behavior. Do not mix unrelated refactors, style churn, or speculative extension points into the same change.

## Search And Context

- Use `rg` / `rg --files` for exact identifiers, known strings, and fast file discovery.
- Use subagents for independent research or risky parallel work, and always wait for them before yielding.

## Build And Verification

Use the narrowest command that proves the change. Type verification runs through the build; there is no separate root `check-types` step.

```bash
# full pipeline (CI order)
yarn lint
yarn format:check
yarn build

# direct package checks (run from repo root)
npx tsc --noEmit -p packages/agent-runtime/tsconfig.json
npx tsc --noEmit -p core/tsconfig.json
npx vitest run packages/agent-runtime

# single test files
npx vitest run packages/agent-runtime/tests/turn.test.ts
npx vitest run core/tests/messengers.test.ts
npx vitest run core/tests/resources.test.ts
npx vitest run core/tests/runtimes.test.ts
npx vitest run plugins/memos-client/tests/tools.test.ts
```

- `yarn build` runs `yakumo build`, which compiles (`yakumo tsc`) and bundles (`yakumo esbuild`) every workspace; TS type errors surface here.
- Root `yarn test` runs `yakumo vitest` across workspaces.
- Prefer `npx tsc` / `npx vitest` from the repo root with explicit paths; do not call `node_modules/.bin` directly.
- Run package-scoped `build` first if test resolution fails on workspace references.
- For docs-only changes, a readback or targeted markdown inspection is usually sufficient.

## Code Organization

- 模块级声明顺序：imports → 常量 → 类型 → 接口 → class → function → 重新导出；同类声明（interface 与 interface、type 与 type）保持相邻。
- 导入分组：外部依赖在前，仓库内部模块在后；类型导入遵循项目既有约定，不为排序改变导入方式或产生循环依赖。
- 各声明类别内部：对外导出优先于局部声明；运行时依赖的声明保持安全且等价的初始化顺序。
- class 成员顺序：公共静态字段/方法 → 所有实例字段（public → protected → private）→ constructor → 公共实例方法 → protected 方法 → private 方法。
- 可见性显式化：所有公开方法、公开字段（含静态）必须显式 `public`；protected/private 同理显式标注。
- `declare module` 类型增强置于顶层类型区（类型定义之后、class 之前）。
- 重新导出（`export { ... }` / `export * from ...`）统一置于文件末尾。
- 同一领域/数据流的常量、类型、辅助函数集中放置，辅助函数靠近使用位置。
- 例外以语义安全与项目既有约定（如 Koishi `Config` 接口+Schema 同名字对、vitest `vi.hoisted` 前置）优先，并注明原因。

## Current Architecture

- `core/src/index.ts` is the Koishi entrypoint. It registers `ModelService`, `YesImBotService`, and built-in platform registration; Database is a required injection.
- `core/src/service.ts` owns the public `ctx.yesimbot` facade: `model`, `messenger`, `agent`, `resource`, and `stop`. It has no public identity, storage namespace, reload, or reset API. Gateway admission, Messenger, RuntimeManager, ChannelRuntime, ChannelResources, and assignee admission stay private.
- `core/src/messengers/index.ts` owns Koishi middleware and live Session admission. It checks allowlist and shared assignee before resolving ChannelResources, invokes one Translator or built-in pass-through, and sends passively through the originating `Session.send()`.
- `core/src/messages/index.ts` owns versionless public Message/Event records and `RecordBase`/`assembleEvent`. `resources/input.ts` persists inbound resources while Session is live; no Runtime or plugin stores Session references.
- `core/src/resources/index.ts` owns public `Resources`, `ChannelResources`, AssetStore, ArtifactStore, ResourceReader, and the `resource.get/use` facade.
- `core/src/service.ts` composes `ModelService`, `Channels`, `Agents`, `Runtimes`, and Messenger. Optional plugins register named behavior through `ctx.yesimbot.agent.use()` / `agent.will()` and resource readers through `ctx.yesimbot.resource.use()`.

## Workspace Package Names

| Directory                  | npm name                                     |
| -------------------------- | -------------------------------------------- |
| `core/`                    | `koishi-plugin-yesimbot`                     |
| `packages/agent-runtime/`  | `@yesimbot/agent-runtime`                    |
| `plugins/chat-learning/`   | `koishi-plugin-yesimbot-chat-learning`       |
| `plugins/command-bridge/`  | `koishi-plugin-yesimbot-command-bridge`      |
| `plugins/console/`         | `koishi-plugin-yesimbot-console`             |
| `plugins/global-brain/`    | `koishi-plugin-yesimbot-global-brain`        |
| `plugins/mcp-client/`      | `koishi-plugin-yesimbot-mcp-client`          |
| `plugins/memorizer/`       | `koishi-plugin-yesimbot-memorizer`           |
| `plugins/memos-client/`    | `koishi-plugin-yesimbot-memos-client`        |
| `plugins/onebot-utils/`    | `koishi-plugin-yesimbot-onebot-utils`        |
| `plugins/quota/`           | `koishi-plugin-yesimbot-quota`               |
| `plugins/roleplay/`        | `koishi-plugin-yesimbot-roleplay`            |
| `plugins/schedule/`        | `koishi-plugin-yesimbot-schedule`            |
| `plugins/search-service/`  | `koishi-plugin-yesimbot-search-service`      |
| `plugins/sticker-manager/` | `koishi-plugin-yesimbot-sticker-manager`     |
| `plugins/usage/`           | `koishi-plugin-yesimbot-usage`               |
| `plugins/will-policy/`     | `koishi-plugin-yesimbot-will-policy`         |
| `plugins/workspace/`       | `koishi-plugin-yesimbot-workspace`           |
| `providers/openai/`        | `@yesimbot/koishi-plugin-provider-openai`    |
| `providers/anthropic/`     | `@yesimbot/koishi-plugin-provider-anthropic` |
| `providers/deepseek/`      | `@yesimbot/koishi-plugin-provider-deepseek`  |
| `providers/google/`        | `@yesimbot/koishi-plugin-provider-google`    |

## Context Files

Load these on demand when deeper context is needed:

- `core/src/service.ts` — public four-entry facade and composition of ModelService, Channels, Agents, Runtimes, and Messenger.
- `core/src/messengers/index.ts` — live Session admission, allowlist, shared assignee check, Translator selection, passive/active delivery, pacing, and failure feedback.
- `core/src/messages/index.ts` — declaration-mergeable EventMap, versionless Message/Event records, RecordBase, event assembly, formatter, and model projection helpers.
- `core/src/channels/index.ts` — ChannelScope, Channel, Channels manifest scan, persistent channel roots, and stable ChannelResources ownership.
- `core/src/resources/{index,asset,artifact,input}.ts` — resource contracts, separate Asset/Artifact stores, safe readers, and Session-live inbound persistence.
- `core/src/conversations/{index,compact}.ts` — one AgentStorage writer, active JSONL conversation, archive/list/status, and compact behavior.
- `core/src/agents/{index,will,tools}.ts` — named Agent/WillPlugin registration, fixed default Will, plugin snapshots, and approved Core Tool creators.
- `core/src/runtimes/{index,channel,output,prompt}.ts` — private runtime cache, ChannelRuntime FIFO/post semantics, output ownership, and prompt composition.
- `core/src/models/` — model config, provider contracts, schema helpers, and model resolution.
- `core/src/platforms/` — built-in platform registration and Translator wiring.
- `docs/athena-v4-vision-and-evolution-notes.md` — stable product direction and accepted engineering boundaries; it is not an implementation specification.
- `docs/athena-development-log.md` — dated architectural decisions and evidence; do not add task progress, review process, test runs, or ordinary fixes.

## Reporting

When finishing a coding task, summarize:

- What changed and where.
- What verification ran, with failures or skipped checks called out clearly.
- Any remaining risk or focused next step directly tied to the request.

### Commit 规范

- 格式：`<type>(scope): <summary>`
- `scope` 可选
- `summary` 使用中文、动词开头、长度 ≤ 50 字、不加句号
- 常用 `type`：`feat` / `fix` / `refactor` / `docs` / `test` / `chore`
