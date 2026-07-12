<!--
Raw capture of superpowers:brainstorming output.

This file captures the agreed design discussion directly in the OpenSpec change
instead of writing to docs/superpowers/specs/.
-->

# Brainstorm: Unify Channel Scope Identity

## Background

The current codebase has several independently defined but semantically similar
channel identity concepts:

- `core/src/shared/types.ts` defines `ChannelRuntimeTarget` with
  `platform`, `selfId`, and `channelId`.
- `plugins/workspace/src/mounts.ts` defines `WorkspaceChannelTarget` with the
  same fields.
- `core/src/runtime/key.ts` derives runtime keys and session paths from those
  fields.
- `plugins/workspace/src/mounts.ts` derives channel workspace directory IDs by
  sanitizing the same fields and appending a short SHA-256 digest.
- `plugins/memos-client/src/identity.ts` derives MemOS channel hashes from the
  same channel fields.

This creates repeated type definitions, repeated string concatenation/hash
logic, and inconsistent privacy/collision/path-safety behavior across core and
plugins.

## Current Duplicate Points

`ChannelRuntimeTarget` and `WorkspaceChannelTarget` are the same domain concept:
a channel-level isolation boundary identified by the platform name, the bot
identity (`selfId`), and the platform channel identity (`channelId`).

The ID generation logic is also overlapping, but not every generated ID has the
same semantic role:

- Runtime key: internal in-memory key for one channel-scoped runtime instance.
- Session file ID/path: persistent storage location for that channel's message
  history.
- Workspace directory ID/path: persistent storage location for that channel's
  sandbox workspace.
- MemOS identity/channel hash: external memory-service identity, also scoped by
  the channel but carrying MemOS-specific user/conversation/agent semantics.

## Design Alternatives Considered

### Option 1: Share Type Only

Create one shared channel type in core, but leave runtime/session/workspace/MemOS
ID derivation in each package.

Pros:
- Smallest change.
- Lowest risk of touching unrelated behavior.

Cons:
- Leaves repeated hashing/sanitizing/string concatenation in plugins.
- Does not fix inconsistent path-safety and privacy behavior.
- Does not establish a canonical channel ID usable across packages.

### Option 2: Core-Owned Channel Scope and Canonical ID

Create a core-owned `ChannelScope` type and a canonical `ChannelScopeId`.
Plugins use core APIs for channel scope normalization, ID generation, metadata
record creation, reverse lookup, and channel-scoped path generation.

Pros:
- Removes real duplication.
- Gives runtime, sessions, workspace, and MemOS a common channel-scope anchor.
- Keeps raw platform IDs out of directory names.
- Makes reverse lookup explicit through metadata files rather than reversible
  path names.

Cons:
- Changes existing storage paths and MemOS identities.
- Requires touching several packages at once.

Accepted for this change because the project is still experimental and there
are no public compatibility requirements.

### Option 3: New Shared Package

Create a separate package such as `@yesimbot/channel-identity`.

Pros:
- Decouples channel identity from the Koishi core package.
- Could be consumed by future non-Koishi packages.

Cons:
- Adds package and release complexity before a real independent consumer exists.
- The current concept is still core-owned and Koishi-derived.

Rejected as YAGNI for now.

## Decisions

### D1: Use `ChannelScope` as the canonical type name

Use:

```ts
export interface ChannelScope {
  readonly platform: string;
  readonly selfId: string;
  readonly channelId: string;
}
```

Rationale:
- The object represents a channel-level isolation boundary, not an action target.
- `Target` is overloaded and too action-oriented.
- `Scope` matches runtime/session/workspace/memory isolation semantics.

### D2: Use `ChannelScopeId` for canonical IDs

Use:

```ts
export type ChannelScopeId = `ch_v1_${string}`;
```

The generated format is:

```text
ch_v1_<16-char-hash>
```

The hash should be derived from a stable canonical serialization of
`platform/selfId/channelId`. The ID must be deterministic, path-safe, and
irreversible.

### D3: Use 16 lowercase base32 hash characters

The ID keeps the explicit `ch_v1_` prefix and uses a 16-character lowercase
base32 digest. This corresponds to 80 bits when encoding SHA-256 digest bytes.

Rationale:
- Short enough for path names and logs.
- Lowercase avoids case-insensitive filesystem surprises.
- 80 bits is a stronger collision boundary than the current 12 hex workspace
  suffix while keeping the visible ID compact.

### D4: Reverse lookup is metadata-backed, not encoded into the ID

The canonical ID is irreversible. Core provides APIs that store and read a
metadata file under the channel directory so code can resolve a
`ChannelScopeId` back to its `ChannelScope` when the metadata exists.

Accepted metadata shape:

```ts
export interface ChannelScopeRecord {
  readonly version: 1;
  readonly id: ChannelScopeId;
  readonly scope: ChannelScope;
  readonly createdAt: string;
}
```

### D5: No backward compatibility, aliases, or migration

Existing session files, workspace directories, and MemOS identities are treated
as experimental data. The change does not need to read old paths, preserve old
workspace IDs, preserve old MemOS identities, provide migration tools, or add
compatibility tests.

### D6: Core owns shared APIs; plugins do not reimplement channel hash/sanitize

Core should expose channel-scope helpers through a public API surface. Workspace
and MemOS plugins should call those helpers instead of constructing their own
channel hashes, sanitized path segments, or runtime keys from raw fields.

## Proposed API Shape

```ts
export interface ChannelScope {
  readonly platform: string;
  readonly selfId: string;
  readonly channelId: string;
}

export type ChannelScopeId = `ch_v1_${string}`;

export interface ChannelScopeRecord {
  readonly version: 1;
  readonly id: ChannelScopeId;
  readonly scope: ChannelScope;
  readonly createdAt: string;
}

export function normalizeChannelScope(input: ChannelScope): ChannelScope;
export function createChannelScopeId(scope: ChannelScope): ChannelScopeId;

export function ensureChannelScopeRecord(
  basePath: string,
  scope: ChannelScope,
): Promise<ChannelScopeRecord>;

export function readChannelScopeRecord(
  basePath: string,
  id: ChannelScopeId,
): Promise<ChannelScopeRecord | undefined>;

export function resolveChannelScope(
  basePath: string,
  id: ChannelScopeId,
): Promise<ChannelScope | undefined>;

export function createChannelPath(
  basePath: string,
  id: ChannelScopeId,
  ...segments: string[]
): string;
```

Implementation detail to preserve in design: pure ID generation must not perform
I/O. Metadata APIs perform the filesystem work.

## Directory Layout

Recommended core data layout:

```text
data/yesimbot/
  channels/
    ch_v1_mf2xq7j9k4p6t8zd/
      scope.json
      sessions/
        messages.jsonl
  plugins/
    yesimbot-workspace/
      channels/
        ch_v1_mf2xq7j9k4p6t8zd/
          workspace/
```

Plugin-specific roots may still be configured separately, but channel-scoped
segments should use the same `ChannelScopeId`.

## Acceptance Criteria

- Core exposes one shared `ChannelScope` type and one `ChannelScopeId` type.
- Runtime, session storage, workspace storage, and MemOS channel identity derive
  from core-owned channel scope helpers.
- Directory names do not expose raw `selfId` or `channelId`.
- Core can resolve a known `ChannelScopeId` back to `ChannelScope` using
  metadata.
- No legacy path, ID, alias, or migration behavior is implemented.

## Open Questions

No blocking product questions remain. Implementation can decide exact file
placement inside core as long as the public API is stable and package exports are
clear.
