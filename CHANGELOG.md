# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **platform-onebot**: New `koishi-plugin-yesimbot-platform-onebot` adapter registers OneBot platform input handling through `ctx.yesimbot.platform`
- **agent-runtime**: New `@yesimbot/agent-runtime` package — standalone agent runtime with createAgent, turn queue, message storage, plugin hooks, tool registry, channel events, and state management
- **workspace**: bash-tool sandbox integration with virtual filesystem mounts, channel-scoped workspace, and AbortSignal timeout bridge
- **memos-client**: New `koishi-plugin-yesimbot-memos-client` plugin — MemOS Cloud memory integration with CRUD operations, identity generation, QQ chat memory import script, and debug channel memory search
- **tool-observer**: New `koishi-plugin-yesimbot-tool-observer` plugin — per-call tool execution notifications with payload formatting and configurable compression
- **onebot-utils**: Channel platform context extraction and platform-aware message handling
- **sticker**: New `koishi-plugin-yesimbot-sticker` plugin for sticker message handling
- **core**: New `runtime/` layer, `platform.ts`, `channel.ts`, restructured `model/` with schema and middleware
- **core**: New Koishi-first `DeliveryService` for ordered passive replies and target sends, conservative receipts, and process-local delivery status events

### Changed

- **core**: **Breaking**: Replaced the Platform message contract with `Platform.Message` (`Element[]`), persisted `Platform.MessageRecord`, typed publish-only `Platform.Event`, and flat `Adapter.refine()` / `prepare()` contracts; legacy platform-message JSONL is unsupported and must be cleared or replaced before upgrade
- **core**: Exposed the single plugin-facing platform service path as `ctx.yesimbot.platform`; canonical classification, preparation, final busy-state routing, initial submission, and reset now use a per-channel FIFO
- **core**: Moved channel classification, Agent cache/storage, atomic append/join/run submission, stream ownership, delivery integration, reset, and stop behind `ChannelRuntime`; `YesImBotService` is now a Koishi composition and delegation facade
- **core**: Added independent direct, group-mention, and ordinary-group routing policies while keeping self-message ignore fixed
- **core**: Stores only verified, channel-local inbound image assets; preparation permits four images, 5 MiB per image, 10 MiB per message, two concurrent downloads, and a 10-second timeout
- **onebot-utils**: `onebot_get_forward_message` now returns sanitized, bounded, paginated text from raw or structured OneBot forward payloads without URLs, raw fields, child IDs, media bytes, or asset IDs
- **core**: Migrated from legacy `packages/agent/` to `@yesimbot/agent-runtime` as the foundation; rebuilt `service.ts` as slim Koishi wrapper; removed `internal/` and `services/extension/` legacy modules
- **workspace**: Replaced custom tool implementations (`edit-file`, `execute-command`, `glob`, `grep`, `read-file`, `write-file`) with just-bash sandbox
- **mcp-client**: Tool refresh support and transport configuration updates
- **search-service**: Backend updates for searxng and tavily
- **skill**: Refactored plugin registration with typed contracts
- **providers**: Updated anthropic, deepseek, google, openai providers with new model configuration schema
- **docs**: Updated AGENTS.md and README.md to reflect current architecture

### Fixed

- **memos-client**: Read platform custom-message sender and message IDs from the current `Platform.MessageRecord` payload
- **agent-runtime**: Deduplicate tool messages in multi-step loops
- **core**: Preserve accessor-backed direct-message classification by recording canonical `scope.channelType` from the real Session instead of routing through a reconstructed Session

### Removed

- **agent**: Removed deprecated `packages/agent/` package (replaced by `@yesimbot/agent-runtime`)
- **core**: Removed legacy `core/src/internal/`, `core/src/services/extension/`, `core/src/shared/platform-event.ts`
- **workspace**: Removed legacy custom tools directory and associated tests
- **docs**: Removed `CONTEXT.md`, `NOTICE`, `ROADMAP.md`
