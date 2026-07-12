## Why

Channel identity is currently duplicated across core, workspace, and MemOS integration code. Each package derives keys, paths, or hashes from `platform`, `selfId`, and `channelId` with different algorithms and privacy properties. A shared channel scope model will reduce repeated implementation, keep raw platform IDs out of paths, and give plugins one stable API for channel-scoped isolation.

## What Changes

**Channel Scope Type and ID**
- From: Core and plugins define local target-like types and derive IDs independently.
- To: Core exposes `ChannelScope`, `ChannelScopeId`, and helpers for canonical ID generation, metadata persistence, reverse lookup, and channel-scoped path creation.
- Reason: Runtime, session, workspace, and memory integrations share the same channel-level isolation boundary.
- Impact: Breaking for experimental data paths and MemOS identities; no legacy compatibility is required.

**Channel-Scoped Storage Layout**
- From: Core sessions live under `basePath/sessions/<sanitized-name>.jsonl`, and workspace data uses a plugin-owned readable directory ID.
- To: Channel data uses `channels/<ChannelScopeId>/...`, with `scope.json` metadata for reverse lookup and `sessions/messages.jsonl` for core session storage.
- Reason: One canonical path-safe ID should anchor all channel-scoped data.
- Impact: Existing experimental session and workspace directories are ignored.

**MemOS Channel Identity**
- From: MemOS derives its channel hash locally from raw platform fields.
- To: MemOS channel-scoped identities reuse core channel scope ID/hash helpers for channel identity while keeping MemOS-specific author, agent, message, and memory-scope rules local to the MemOS plugin.
- Reason: Channel hash generation should not be duplicated, while MemOS domain rules should remain plugin-owned.
- Impact: Existing experimental MemOS identities are not preserved.

## Capabilities

### New Capabilities
- `channel-scope-identity`: Defines shared channel scope types, canonical channel scope ID generation, metadata-backed reverse lookup, and channel-scoped path rules.

### Modified Capabilities
- `core-runtime-integration`: Core runtime identity and JSONL session storage move from raw target keys and sanitized filenames to canonical `ChannelScopeId` and channel directories.
- `workspace-sandbox-tools`: Workspace isolation uses core-provided `ChannelScopeId` instead of plugin-local target types and workspace ID generation.
- `memos-cloud-memory`: MemOS channel identity uses the shared channel scope ID/hash mechanism while preserving MemOS-specific user, author, agent, and message identity semantics.

## Impact

- Affected code: `core/src/shared/types.ts`, `core/src/runtime/key.ts`, `core/src/runtime/message.ts`, `core/src/service.ts`, public core exports, workspace plugin mounts/lifecycle, MemOS identity derivation, and related tests.
- Affected APIs: `ChannelRuntimeTarget` and `WorkspaceChannelTarget` are replaced by `ChannelScope`; channel key/session path helpers are replaced or narrowed around `ChannelScopeId`.
- Data impact: Existing experimental session files, workspace directories, and MemOS identities are not read, migrated, or aliased.
- Dependencies: No new runtime package is planned; core owns the shared API surface.
