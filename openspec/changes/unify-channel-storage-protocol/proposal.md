## Why

Core, Session storage, Asset storage, Workspace, and memos-client derive channel identifiers or paths through different rules. The split scatters one channel's data across unrelated roots, forces plugins to understand Core path internals, and gives operators no reliable way to map opaque directories back to a channel. A single Core-owned protocol will keep identity, storage layout, runtime ownership, and operator lookup consistent across modules and operating systems.

## What Changes

**Channel identity and Key**
- From: `ChannelScope` contains `platform`, `selfId`, and `channelId`, and existing IDs use module-specific or historical encodings.
- To: `ChannelScope` also records `isDirect`; shared channels derive identity from `platform + channelId`, while direct channels also include `selfId`. Core emits one 26-character lowercase Base32 Key from a versioned canonical tuple.
- Reason: Koishi assigns one bot to a shared channel, while direct conversations have no assignee and still need bot isolation.
- Impact: Breaking identity and path change.

**Channel-first storage**
- From: Session, Asset, and Workspace data use separate roots and path rules.
- To: Core owns `<basePath>/channels/<key>/`, an authoritative `channel.json`, a rebuildable `channels.json`, and registered module namespaces beneath each channel directory.
- Reason: Operators should locate every local resource for one channel through one catalog lookup.
- Impact: Breaking local layout change; existing data is not migrated.

**Shared-channel admission and handover**
- From: Runtime identity includes `selfId`, and Gateway can process a Session before Koishi assignee filtering.
- To: Core requires Koishi Database, admits shared events only for the current database assignee, and gracefully rebuilds a cached Runtime when the assignee changes without changing storage.
- Reason: Runtime ownership must match Koishi's channel assignment model and preserve one responder per shared channel.
- Impact: Core gains a required database dependency and new Runtime lifecycle behavior.

**Consumer APIs**
- From: plugins compute identifiers or append path components from local configuration.
- To: `YesImBotService` exposes Key generation, namespace registration, safe storage resolution, and channel listing. Workspace and memos-client consume these Core capabilities.
- Reason: Consumers should depend on stable methods instead of path-generation details.
- Impact: Workspace root configuration and plugin-local channel hashes become obsolete.

## Capabilities

### New Capabilities
- `channel-storage-protocol`: Defines the versioned Channel Key, channel-first directory layout, Manifest and Catalog rules, namespace registration, safe path resolution, recovery, and data ownership boundaries.

### Modified Capabilities
- `channel-scope-identity`: Adds direct/shared classification and replaces the historical scope ID contract with the tagged Channel Key protocol.
- `platform-message-ingestion`: Requires database-backed assignee admission before shared Session resolution and persistence.
- `core-runtime-integration`: Keys Runtime ownership by the new Channel Key, adds graceful online assignee handover, and moves Session storage into the channel-first layout.
- `workspace-sandbox-tools`: Resolves the workspace through the Core storage namespace instead of a plugin-owned channel root.
- `memos-cloud-memory`: Uses the Core Channel Key as `channel_hash` while retaining plugin-owned MemOS identities.

## Impact

- Core public API, dependency injection, Gateway admission, RuntimeManager coordination, ChannelRuntime draining, JSONL path construction, Asset paths, Catalog persistence, and reset behavior.
- Workspace configuration, cache keys, and directory resolution.
- memos-client channel metadata derivation.
- Tests for Key vectors, path validation, crash recovery, assignee rejection, backpressure, and online handover.
- Existing `channel_v2_*`, `workspace_v2_*`, `ch_v1_*`, and old JSONL data remain untouched and unread.
