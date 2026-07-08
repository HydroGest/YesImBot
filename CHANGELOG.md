# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **agent-runtime**: New `@yesimbot/agent-runtime` package — standalone agent runtime with createAgent, turn queue, message storage, plugin hooks, tool registry, channel events, and state management
- **workspace**: bash-tool sandbox integration with virtual filesystem mounts, channel-scoped workspace, and AbortSignal timeout bridge
- **memos-client**: New `koishi-plugin-yesimbot-memos-client` plugin — MemOS Cloud memory integration with CRUD operations, identity generation, QQ chat memory import script, and debug channel memory search
- **tool-observer**: New `koishi-plugin-yesimbot-tool-observer` plugin — per-call tool execution notifications with payload formatting and configurable compression
- **onebot-utils**: Channel platform context extraction and platform-aware message handling
- **sticker**: New `koishi-plugin-yesimbot-sticker` plugin for sticker message handling
- **core**: New `runtime/` layer, `platform.ts`, `channel.ts`, restructured `model/` with schema and middleware

### Changed

- **core**: Migrated from legacy `packages/agent/` to `@yesimbot/agent-runtime` as the foundation; rebuilt `service.ts` as slim Koishi wrapper; removed `internal/` and `services/extension/` legacy modules
- **workspace**: Replaced custom tool implementations (`edit-file`, `execute-command`, `glob`, `grep`, `read-file`, `write-file`) with just-bash sandbox
- **mcp-client**: Tool refresh support and transport configuration updates
- **search-service**: Backend updates for searxng and tavily
- **skill**: Refactored plugin registration with typed contracts
- **providers**: Updated anthropic, deepseek, google, openai providers with new model configuration schema
- **docs**: Updated AGENTS.md and README.md to reflect current architecture

### Fixed

- **agent-runtime**: Deduplicate tool messages in multi-step loops

### Removed

- **agent**: Removed deprecated `packages/agent/` package (replaced by `@yesimbot/agent-runtime`)
- **core**: Removed legacy `core/src/internal/`, `core/src/services/extension/`, `core/src/shared/platform-event.ts`
- **workspace**: Removed legacy custom tools directory and associated tests
- **docs**: Removed `CONTEXT.md`, `NOTICE`, `ROADMAP.md`
