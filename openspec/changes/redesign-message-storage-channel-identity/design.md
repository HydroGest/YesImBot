## Context

The verified implementation follows the approved message-storage and channel-identity design at `docs/superpowers/specs/2026-07-25-message-storage-channel-identity-design.md`. This change restores the missing OpenSpec record of that implemented clean break.

## Goals / Non-Goals

**Goals:** define split persisted input variants, preserve frozen message data, retain the stable hash as a logical identity, and use readable Manifest-backed directories.

**Non-Goals:** migration, dual-read, aliases, directory collision allocation, reverse directory decoding, or changes to the generic AgentEntry envelope.

## Decisions

### D1: Persist two input variants

`yesimbot.message` owns `elements`, `messageId`, and frozen `text`; `yesimbot.event` owns `eventType` and frozen `text`. Both require `schemaVersion: 1`. This prevents ordinary-message data from competing with event discriminants.

### D2: Separate identity from directory naming

`channelIdentity(scope)` keeps the existing canonical tuple, SHA-256 truncation, and lowercase Base32 output. Storage derives readable `v1-shared-*` or `v1-direct-*` names independently, with `channel.json` as authority.

### D3: Make the break explicit

Core scans valid Manifests and creates no `channels.json`. Old payloads and layouts are preserved but unread; no migration or fallback path exists.

## Risks / Trade-offs

- [Lossy element serialization] Native JSON serialization can reject unsupported JavaScript values. -> Preserve native semantics and fail that append.
- [Directory slug collision] Encoded components are not injective. -> Reject Manifest identity or directory mismatches without allocating an alternate path.
- [Historical data unavailable] Old data remains unread. -> Accept the clean break and retain files without modifying them.

## Migration Plan

Deploy the verified clean-break implementation. No data migration or rollback compatibility layer is provided; rollback requires restoring the prior release.

## Open Questions

None.
