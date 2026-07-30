# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **agent-runtime**: Added the standalone `@yesimbot/agent-runtime` package for turn lifecycle, message storage, ordered plugins, tools, and streamed model execution.
- **core**: Added public scoped `AssetService` / `AssetStore` access through `ctx.yesimbot.assets`.
- **plugins**: Added optional workspace, MCP, skills, MemOS, search, OneBot utilities, and sticker integrations around the AgentPlugin boundary.

### Changed

- **core**: **Breaking**: Replaced public channel identity and storage-namespace APIs with raw `ChannelScope` and `getStoragePath(scope)`. Shared storage uses `platform + channelId`; direct storage also includes `selfId`.
- **core**: **Breaking**: Replaced PlatformService and DeliveryService with one Session Gateway, per-platform `SessionResolver`, host-owned Message/Event records, and passive `Session.send()` delivery.
- **core**: Resolver-owned image persistence now writes scoped assets during live Session resolution. Model input later reads local image assets in history-then-current order under `imageInput` call budgets.
- **core**: RuntimeManager replaces a shared channel Runtime when its current Bot changes. Core has no `reload()`; stable model, prompt, tool, and plugin resources apply on Runtime replacement.
- **core**: Channel roots are readable versionless `shared-*` / `direct-*` directories with authoritative `channel.json`, `sessions/`, `assets/`, and plugin-selected children. Prior layouts and JSONL are not read or migrated.
- **onebot-utils**: `onebot_get_forward_message` returns sanitized, bounded, paginated forward records.

### Removed

- **core**: Removed public `ChannelKey`, channel identity, storage registration, `ensureStorage()`, reload, Will factory registration, and channel listing APIs.
- **core**: Removed generic Satori fallback, PlatformService, DeliveryService, image freezer/media policy, legacy formatter modules, and JSONL semantic validation.
- **core**: Removed compatibility readers, aliases, and migrations for old channel directories, asset IDs, records, and JSONL formats.
