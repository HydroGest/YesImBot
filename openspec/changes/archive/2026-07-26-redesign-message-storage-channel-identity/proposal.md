## Why

Ordinary messages shared the `yesimbot.event` payload with non-message events, while Channel Key also named the storage directory. The verified implementation separates these contracts so persisted input, stable identity, and readable storage each have one authority.

## What Changes

- **BREAKING** Persist ordinary input as `yesimbot.message` and reserve `yesimbot.event` for `eventType`-discriminated non-message input.
- **BREAKING** Rename the stable 26-character hash API to `channelIdentity`; use readable v1 directory names backed by `channel.json`.
- **BREAKING** remove `channels.json` and reject all old payload, Manifest, and directory formats without migration or fallback.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `platform-event-contract`: Split message and event custom-message contracts.
- `platform-message-ingestion`: Admit and seal message records separately from events.
- `platform-message-formatting`: Project both persisted input variants from frozen text.
- `channel-scope-identity`: Expose the renamed stable logical identity.
- `channel-storage-protocol`: Use readable Manifest-backed channel directories.
- `core-runtime-integration`: Route the input union through identity-keyed runtimes.
- `message-delivery`: Persist delivery failures as non-message events.
- `memos-cloud-memory`: Source channel metadata from `channelIdentity`.
- `workspace-sandbox-tools`: Separate logical workspace cache identity from storage paths.

## Impact

Core, platform adapters, storage, runtime, delivery, Workspace, and MemOS use the new contracts. Existing JSONL, hash directories, Manifests, and Catalogs remain on disk but are unread.
