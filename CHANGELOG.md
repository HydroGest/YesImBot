# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **agent-runtime**: Added the standalone `@yesimbot/agent-runtime` package for turn lifecycle, message storage, ordered plugins, tools, and streamed model execution.
- **plugins**: Added optional workspace, MCP, skills, MemOS, search, OneBot utilities, and sticker integrations around the named AgentPlugin boundary.

### Changed

- **core**: **Breaking**: Converged `ctx.yesimbot` to `model`, `messenger`, `agent`, and `resource`; `messenger.post()` replaces the old forced-trigger entry and supports `trigger:false` plus defer/join/reject busy policies.
- **core**: **Breaking**: Replaced resolver and factory registration with named `Translator`, `ChannelPlugin`, and `WillPlugin` objects registered through `messenger.use()`, `agent.use()`, and `agent.will()`.
- **core**: **Breaking**: Replaced public storage and asset facades with `resource.get(scope)` and stable ChannelResources owners. Shared storage uses `platform + channelId`; direct storage also includes `selfId`.
- **core**: Messenger now owns live Session admission and passive/active delivery; delivery failures return to the producing runtime as one `delivery.failed` event.
- **core**: Runtime, prompt, model, tool, and plugin resources are snapshotted when a ChannelRuntime is created and take effect after runtime replacement.
- **core**: Channel roots are readable versionless `shared-*` / `direct-*` directories with authoritative `channel.json`, conversation history, assets, and plugin-selected children. Prior layouts and JSONL are not read or migrated.

### Removed

- **core**: Removed public `ChannelKey`, channel identity, storage registration, `getStoragePath`, reset/reload, DeliveryService, Gateway/RuntimeManager facades, resolver/factory registration, and compatibility aliases.
- **core**: Removed generic Satori fallback, image freezer/media policy, legacy formatter modules, and JSONL semantic validation.
- **core**: Removed compatibility readers and migrations for old channel directories, asset IDs, records, and JSONL formats.
