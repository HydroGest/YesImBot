## Context

Athena currently treats a Koishi channel runtime as the combination of
`platform`, `selfId`, and `channelId`, but this concept is represented and
serialized in several places. Core uses `ChannelRuntimeTarget` and
`platform:selfId:channelId` runtime keys. The workspace plugin defines
`WorkspaceChannelTarget` and a readable sanitized directory ID. The MemOS plugin
derives a channel hash from the same fields for memory identity.

The project is still experimental. Existing data paths and MemOS identities are
not public compatibility contracts, so this change can replace old layouts
directly instead of carrying migration or alias code.

## Goals / Non-Goals

**Goals:**

- Introduce one shared `ChannelScope` type for channel-level isolation.
- Introduce one canonical `ChannelScopeId` format:
  `ch_v1_<16-char-lowercase-base32-hash>`.
- Keep raw `selfId` and `channelId` out of directory names by default.
- Provide metadata-backed reverse lookup from `ChannelScopeId` to
  `ChannelScope`.
- Use the canonical ID for runtime cache keys, session storage paths, workspace
  isolation paths, and MemOS channel-scoped identity.
- Remove plugin-local channel target types and channel hash/sanitize logic.

**Non-Goals:**

- No compatibility with existing experimental session files, workspace
  directories, or MemOS identities.
- No migration command or old-format reader.
- No separate shared package for channel identity.
- No support for guild/thread-specific scope semantics beyond the existing
  `platform/selfId/channelId` boundary.

## Decisions

### D1: Use `ChannelScope` for the shared value object

- **Choice:** Replace target-like channel value types with:

  ```ts
  export interface ChannelScope {
    readonly platform: string;
    readonly selfId: string;
    readonly channelId: string;
  }
  ```

- **Rationale:** The value object represents an isolation scope shared by
  runtime, storage, workspace, and memory. `Target` reads like an action
  destination and is overloaded.
- **Alternatives considered:** `ChannelTarget`, `ChannelAddress`,
  `ChannelLocator`, and `ChannelIdentity`. `ChannelScope` best matches the
  isolation boundary semantics.

### D2: Use `ChannelScopeId` with a stable versioned prefix

- **Choice:** Define `ChannelScopeId` as:

  ```ts
  export type ChannelScopeId = `ch_v1_${string}`;
  ```

  The concrete value is `ch_v1_` plus 16 lowercase base32 characters.

- **Rationale:** The prefix keeps the ID recognizable and versioned. The
  lowercase base32 digest is path-safe, compact, and avoids case-insensitive
  filesystem issues.
- **Alternatives considered:** Shorter `ch1_` prefix, hex, base64url, and
  readable-prefix-plus-hash IDs. The chosen format balances explicit versioning,
  compactness, and path safety.

### D3: Derive the hash from canonical serialization

- **Choice:** `createChannelScopeId(scope)` uses a deterministic canonical
  serialization of `platform`, `selfId`, and `channelId`, then hashes it with
  SHA-256 and encodes the first 80 bits as 16 lowercase base32 characters.
- **Rationale:** Delimiter-based concatenation is ambiguous when source fields
  contain delimiters. Canonical serialization keeps the hash stable and
  unambiguous.
- **Alternatives considered:** Raw string concatenation and JSON object
  serialization. A tuple or length-prefixed representation is preferred because
  field order is fixed and easy to keep stable.

### D4: Keep ID generation pure and metadata I/O explicit

- **Choice:** Pure helpers create IDs and paths without filesystem side effects.
  Separate record helpers create/read `scope.json`.
- **Rationale:** This keeps responsibilities small and avoids hidden I/O in
  utility functions.
- **Alternatives considered:** A single `resolveChannelScope()` helper that both
  creates IDs and writes metadata. Rejected because it mixes derivation and
  persistence.

### D5: Core owns shared APIs

- **Choice:** Core exposes channel scope APIs from a public import path such as
  `koishi-plugin-yesimbot/channel` or the root package if the export surface
  stays small.
- **Rationale:** Current consumers already depend on the core plugin, and the
  concept is derived from Koishi channel runtime context. A new package would
  add release complexity without an independent consumer.
- **Alternatives considered:** A new `@yesimbot/channel-identity` package.
  Rejected as premature.

### D6: MemOS reuses channel scope identity only for channel identity

- **Choice:** MemOS uses the shared channel scope ID/hash for channel-scoped
  identity, while retaining plugin-local rules for author, message, agent,
  memory-scope selection, and MemOS request fields.
- **Rationale:** Channel identity is shared infrastructure; MemOS user/agent
  semantics are plugin domain logic.
- **Alternatives considered:** Moving all MemOS identity derivation into core.
  Rejected because it would couple core to one optional integration.

## Risks / Trade-offs

[Risk] A 16-character base32 hash is shorter than a full cryptographic digest.
→ Mitigation: It still represents 80 bits, which is sufficient for channel
scope directory and identity use in this project. The `ch_v1_` prefix allows a
future format version if requirements change.

[Risk] Metadata-backed reverse lookup only works when `scope.json` has been
created. → Mitigation: Runtime/session/workspace entry points that create
channel-scoped data should call the record writer before relying on reverse
lookup.

[Trade-off] The change is intentionally breaking for experimental data. →
Accepted because there are no public users or compatibility commitments, and
compatibility logic would add complexity without current value.

[Risk] Exposing raw scope fields in `scope.json` can reveal IDs to local
operators. → Mitigation: Raw IDs are not exposed in path names. The metadata
file is local application data and exists specifically to support reverse
lookup.

## Migration Plan

No migration is required. Existing experimental session files, workspace
directories, and MemOS identities are ignored after this change.

Implementation order:

1. Add core channel scope types and pure ID/path helpers.
2. Add metadata record read/write helpers.
3. Switch core runtime keys and session paths to `ChannelScopeId`.
4. Switch workspace isolation to core channel scope APIs.
5. Switch MemOS channel identity derivation to shared channel scope helpers.
6. Update tests and docs to describe the new layout and the absence of legacy
   compatibility.

Rollback during development is a normal git revert of this experimental change.

## Open Questions

None. The user explicitly selected `ChannelScope`, `ChannelScopeId`,
`ch_v1_` prefix, and a 16-character hash, and explicitly rejected legacy
compatibility, aliases, migration, and compatibility gate tests.
