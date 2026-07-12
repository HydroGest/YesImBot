## 1. Core Channel Scope API

- [x] 1.1 Add core-owned `ChannelScope`, `ChannelScopeId`, and `ChannelScopeRecord` public types.
- [x] 1.2 Implement deterministic `ChannelScopeId` generation with `ch_v1_` plus 16 lowercase base32 hash characters.
- [x] 1.3 Add metadata-backed record helpers for ensuring, reading, and resolving `scope.json`.
- [x] 1.4 Add canonical channel path helpers rooted at `channels/<ChannelScopeId>/`.
- [x] 1.5 Export the channel scope API from a stable core public import path.

## 2. Core Runtime Integration

- [x] 2.1 Replace `ChannelRuntimeTarget` usage with `ChannelScope` while preserving channel type metadata separately.
- [x] 2.2 Use `ChannelScopeId` for runtime cache keys, active turn keys, and agent IDs.
- [x] 2.3 Move JSONL session storage to `basePath/channels/<ChannelScopeId>/sessions/messages.jsonl`.
- [x] 2.4 Ensure `scope.json` exists before core uses channel-scoped storage.
- [x] 2.5 Update reset behavior to accept `ChannelScope` and clear canonical channel storage only.

## 3. Workspace Plugin Integration

- [x] 3.1 Remove plugin-local `WorkspaceChannelTarget` and channel workspace ID generation.
- [x] 3.2 Use core channel scope helpers to derive workspace channel directories.
- [x] 3.3 Update workspace documentation and prompts so they describe channel isolation without promising raw channel path names.

## 4. MemOS Identity Integration

- [x] 4.1 Replace plugin-local channel hash derivation with core channel scope identity helpers for channel-scoped memory.
- [x] 4.2 Keep MemOS author, agent, message, and memory-scope rules plugin-owned.
- [x] 4.3 Update MemOS identity tests for the new channel scope ID format and no legacy identity compatibility.

## 5. Verification

- [x] 5.1 Update core tests for channel scope ID generation, metadata reverse lookup, session paths, runtime key behavior, and reset.
- [x] 5.2 Update workspace tests for canonical channel directory isolation.
- [x] 5.3 Run package-scoped type checks and tests for core, workspace, and MemOS.
- [x] 5.4 Run OpenSpec validation for the new change artifacts.
