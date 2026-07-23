# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **platform-onebot**: New `koishi-plugin-yesimbot-platform-onebot` adapter registers OneBot input through `ctx.yesimbot.registerResolver()`
- **agent-runtime**: New `@yesimbot/agent-runtime` package — standalone agent runtime with createAgent, turn queue, message storage, plugin hooks, tool registry, channel events, and state management
- **workspace**: bash-tool sandbox integration with virtual filesystem mounts, channel-scoped workspace, and AbortSignal timeout bridge
- **memos-client**: New `koishi-plugin-yesimbot-memos-client` plugin — MemOS Cloud memory integration with CRUD operations, identity generation, QQ chat memory import script, and debug channel memory search
- **onebot-utils**: Channel platform context extraction and platform-aware message handling
- **sticker**: New `koishi-plugin-yesimbot-sticker` plugin for sticker message handling
- **core**: Added canonical 26-character Channel Keys, authoritative channel Manifests, a rebuildable Catalog, and registered per-channel storage namespaces
- **core**: Added Database-backed shared-channel admission and bounded online Runtime handover when the Koishi assignee changes

### Changed

- **core**: **Breaking**: Replaced the public Platform and Delivery services with one Session Gateway, declaration-mergeable EventRecords, and a slim `ctx.yesimbot` facade
- **core**: **Breaking**: Moved all local channel data to `<basePath>/channels/<key>/`; legacy `channel_v2_*`, `workspace_v2_*`, `ch_v1_*`, and old JSONL layouts are not read or migrated
- **core**: Moved per-channel FIFO, Agent/Will ownership, JSONL, stream consumption, delivery completion, reset, and stop behind internal RuntimeManager and ChannelRuntime modules
- **core**: Added independent direct, group-mention, and ordinary-group routing policies while keeping self-message ignore fixed
- **core**: Stores only verified, channel-local inbound image assets; preparation permits four images, 5 MiB per image, 10 MiB per message, two concurrent downloads, and a 10-second timeout
- **onebot-utils**: `onebot_get_forward_message` now returns sanitized, bounded, paginated text from raw or structured OneBot forward payloads without URLs, raw fields, child IDs, media bytes, or asset IDs
- **core**: Migrated from legacy `packages/agent/` to `@yesimbot/agent-runtime` as the foundation; rebuilt `service.ts` as slim Koishi wrapper; removed `internal/` and `services/extension/` legacy modules
- **workspace**: Replaced custom tool implementations (`edit-file`, `execute-command`, `glob`, `grep`, `read-file`, `write-file`) with just-bash sandbox
- **workspace**: Removed the plugin-local `root` and channel hash; the default writable workspace now uses Core's registered `workspace` namespace
- **memos-client**: Uses the Core Channel Key for `channel_hash` while retaining plugin-owned user, conversation, agent, author, and message identities
- **mcp-client**: Tool refresh support and transport configuration updates
- **search-service**: Backend updates for searxng and tavily
- **skill**: Refactored plugin registration with typed contracts
- **providers**: Updated anthropic, deepseek, google, openai providers with new model configuration schema
- **docs**: Updated AGENTS.md and README.md to reflect current architecture

### Fixed

- **memos-client**: Read sender and message IDs from the current EventRecord resources
- **agent-runtime**: Deduplicate tool messages in multi-step loops
- **core**: Preserve direct-message classification as `ChannelScope.isDirect` from the live Session and reject resolver classification mismatches
- **core**: Reject storage namespace and path symlink escapes before creating external directories

### Removed

- **agent**: Removed deprecated `packages/agent/` package (replaced by `@yesimbot/agent-runtime`)
- **core**: Removed legacy `core/src/internal/`, `core/src/services/extension/`, `core/src/shared/platform-event.ts`
- **workspace**: Removed legacy custom tools directory and associated tests
- **docs**: Removed `CONTEXT.md`, `NOTICE`, `ROADMAP.md`
