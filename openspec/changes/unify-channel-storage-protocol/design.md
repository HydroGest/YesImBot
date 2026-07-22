## Context

The current system has one runtime-level `ChannelScope`, but local consumers do not share one persistence contract. Core stores JSONL and assets under a full SHA-256/Base64URL-derived identifier, Workspace uses a separately configured root and a shorter plugin-derived digest, and memos-client derives another channel hash. Operators must inspect several trees and cannot identify an opaque path without module-specific knowledge.

Koishi already defines shared Channel ownership through a database row keyed by `(platform, id)` with `assignee` as the active bot. Direct conversations do not use this assignment. The storage protocol must match that distinction, preserve the current Session-free Runtime boundary, and support an online assignee change without allowing two Runtime instances to mutate one history.

The repository intentionally provides no legacy path or JSONL compatibility. The new protocol can make a clean break, but its first published Key version must remain stable because external systems may persist it.

## Goals / Non-Goals

**Goals:**

- Define one deterministic, path-safe, opaque Channel Key across Core and plugins.
- Group all local data for one channel beneath one Core-owned directory.
- Give operators a readable, rebuildable channel catalog.
- Hide Key and root-path construction behind `YesImBotService` methods.
- Match shared-channel runtime ownership to Koishi Database assignee state.
- Preserve one Runtime, FIFO, Agent history, and Workspace across an online assignee handover.
- Detect collisions, malformed metadata, path traversal, stale Catalog state, and unsupported versions without deleting data.

**Non-Goals:**

- Protect predictable channel identifiers from offline enumeration.
- Provide reversible Keys, keyed HMAC, or secret rotation.
- Read or migrate existing storage layouts or legacy JSONL.
- Wrap generic filesystem operations.
- Let Core clear or purge module-owned data.
- Configure Koishi assignee state or duplicate it in local metadata.
- Build a generic migration framework before a concrete format upgrade exists.

## Decisions

### D1: Extend `ChannelScope` with a flat direct/shared discriminator

- **Choice:** Add `isDirect: boolean` to the existing `ChannelScope`. Derive it from `session.isDirect` and require sealed `EventRecord.channel.type` to agree.
- **Rationale:** Shared and direct channels need different identity participation for `selfId`. Extending the existing value object avoids a parallel identity algebra.
- **Alternatives considered:** Treat every channel as shared, which can merge direct conversations across bots; keep `selfId` for every channel, which prevents Koishi assignee handover from reusing storage.

### D2: Use one tagged canonical tuple

- **Choice:** Serialize compact JSON tuples with ECMAScript `JSON.stringify`:

  ```text
  shared: ["yesimbot.channel",1,"shared",platform,null,channelId]
  direct: ["yesimbot.channel",1,"direct",platform,selfId,channelId]
  ```

  All identifier strings must be non-empty and remain byte-distinct after UTF-8 encoding. Core performs no trimming, case conversion, Unicode normalization, numeric parsing, or leading-zero removal.
- **Rationale:** Fixed ordered tuples give explicit field boundaries, namespace separation, and protocol versioning without depending on object property order or locale.
- **Alternatives considered:** Ad hoc delimiters can collide; canonical object formats add machinery without improving this fixed schema; per-channel identity configuration would create two incompatible path protocols.

### D3: Emit a 128-bit lowercase Base32 Key

- **Choice:** Hash the canonical UTF-8 bytes with SHA-256, retain the first 16 bytes, encode with RFC 4648 Base32, lowercase the result, and omit padding. A canonical Key matches `^[a-z2-7]{25}[aeimquy4]$`.
- **Rationale:** The 26-character result is shorter than full SHA-256/Base64URL, works on case-insensitive filesystems, and leaves negligible accidental collision probability at expected scale. The restricted final alphabet enforces the two zero padding bits.
- **Alternatives considered:** HMAC requires secret distribution and recovery without a confidentiality requirement; full SHA-256 is longer than needed; 64-bit and 80-bit digests leave less collision margin; visible prefixes spend path length without helping consumers, who use the Catalog.

### D4: Make the Key opaque and detect collisions through metadata

- **Choice:** The protocol does not support reverse parsing and does not claim resistance to offline enumeration. Before using an existing directory, Core recomputes its Manifest identity and rejects any mismatch as a collision or integrity error.
- **Rationale:** A fixed-length digest cannot prove mathematical uniqueness. An authoritative Manifest prevents silent data merging if a collision or manual directory error occurs.
- **Alternatives considered:** Reversible encoding leaks identifiers and has unbounded length; a central random-ID map loses deterministic cross-process generation.

### D5: Use a channel-first directory layout

- **Choice:** Store local data under:

  ```text
  <basePath>/
    channels.json
    channels/<key>/
      channel.json
      sessions/messages.jsonl
      assets/
      workspace/
      <registered-namespace>/
  ```

- **Rationale:** One Catalog lookup locates every local resource for a channel. The `channels/` level leaves room for global metadata and avoids mixing random Keys with unrelated Core files.
- **Alternatives considered:** Module-first roots scatter one channel across the filesystem; channel names or raw identifiers in directory names change, collide, and disclose identity.

### D6: Treat per-channel Manifest files as facts and the global Catalog as a view

- **Choice:** `channel.json` records `formatVersion`, `keyVersion`, `key`, `isDirect`, `platform`, nullable `selfId`, `channelId`, and optional latest non-empty `name`. Shared records store `selfId: null`; direct records store the real `selfId`. `channels.json` contains sorted flat records and can be rebuilt from valid Manifests.
- **Rationale:** Per-directory metadata supports integrity checks and recovery. The global file gives operators one readable index without becoming a second source of truth.
- **Alternatives considered:** A global-only index cannot recover identity for every module directory; per-directory-only metadata requires users to scan every directory.

### D7: Commit new channels through directory staging

- **Choice:** Create a complete temporary channel directory and Manifest beneath `channels/`, then atomically rename it to the final Key. Update existing Manifests through same-directory temporary files and atomic rename. Rebuild the Catalog after the Manifest commit; a Catalog write failure leaves the Manifest committed and the Catalog dirty for retry or startup repair.
- **Rationale:** The Manifest is the only commit point. Directory staging prevents a crash from leaving a final Key directory without identity metadata.
- **Alternatives considered:** Creating the final directory before its Manifest leaves ambiguous partial state; attempting a cross-file transaction between Manifest and Catalog creates rollback states that the derived-index model does not need.

### D8: Expose storage through `YesImBotService`

- **Choice:** Add direct public methods for `channelKey`, `registerStorage`, `ensureStorage`, and `listChannels`; keep `reset` as the existing coordinated Session and Asset cleanup. Do not create a separate Koishi Service or nested storage facade.
- **Rationale:** Storage shares configuration, startup, Runtime coordination, and consumers with `YesImBotService`. There is no independent provider or lifecycle to justify another service seam.
- **Alternatives considered:** A separate `yesimbot.storage` service adds injection and ordering without independent ownership; returning only a raw channel root lets modules recreate path conventions.

### D9: Register flat module namespaces and validate every relative segment

- **Choice:** Core reserves `sessions` and `assets`; Workspace registers `workspace`. Other modules register a unique 1 to 63 character lowercase ASCII slug matching `^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$`. Core rejects unregistered names, duplicates, Windows reserved names, empty segments, `.`, `..`, absolute paths, separators, and NUL.
- **Rationale:** Registration prevents accidental directory collisions while preserving direct, readable module roots. Segment validation keeps resolved paths under the registered root.
- **Alternatives considered:** Arbitrary names can collide; package-name-derived nested trees make routine inspection harder; capability tokens add no security against trusted in-process plugins that already have filesystem access.

### D10: Keep module data lifecycle with each module

- **Choice:** Session owns JSONL cleanup, Asset owns asset cleanup, Workspace owns its data and caches, and future modules own their namespace. Core provides no generic clear, purge, or namespace lifecycle callback. Full channel deletion is an offline administrative operation.
- **Rationale:** Core cannot safely close or delete module-specific state without understanding module caches and formats. `reset` keeps its narrow Session and Asset semantics.
- **Alternatives considered:** Generic purge can delete long-lived Workspace data by surprise; lifecycle adapters introduce a second plugin protocol solely for deletion.

### D11: Require Koishi Database and fail closed for shared admission

- **Choice:** Core declares `database` as a required injection. Before Resolver work, asset freezing, persistence, or Runtime creation, Gateway queries the Channel row by `(platform, channelId)` and requires `assignee === session.selfId`. Core rechecks inside the per-Key lifecycle coordinator. Missing rows, empty assignees, query errors, and non-assignee events fail closed. Direct events skip assignee lookup.
- **Rationale:** Koishi owns assignment. Explicit database checks make correctness independent of middleware registration order and prevent non-assignee mentions or command-prefix messages from entering the Agent Runtime.
- **Alternatives considered:** Duplicating assignee in `channel.json` can drift from Koishi; relying only on Koishi middleware preserves its direct-mention exception and can be bypassed by registration order.

### D12: Perform online handover in two phases

- **Choice:** RuntimeManager keys shared Runtime ownership by Channel Key and stores the bound `selfId` plus a generation. On assignee change, phase one marks the old generation draining inside the lifecycle coordinator. Core then releases the coordinator and waits for Agent idle, model stream completion, Gateway delivery leases, and the generation's internal delivery-failure completion lane. Phase two re-enters the coordinator, verifies the generation, removes the old Runtime, rechecks Database, and creates a Runtime for the new assignee.
- **Rationale:** Waiting outside the lifecycle coordinator avoids deadlock with completion work that must finish the old turn. Rechecking before each submission rejects stale events if assignment changes again.
- **Alternatives considered:** Immediate interruption drops valid output; holding the coordinator while draining can deadlock; reusing the old Runtime retains the wrong Bot, Scope, Will, and plugin instances.

### D13: Bound handover waiting without a hidden timeout

- **Choice:** One handover admits at most five waiting events. Later events fail explicitly. Normal drain has no implicit timeout; stop or restart remains the operator recovery path for a stuck model or failed drain.
- **Rationale:** The bound prevents unbounded memory retention while preserving the chosen guarantee that Core will not silently interrupt a valid turn during an assignment switch.
- **Alternatives considered:** An automatic deadline can cut off delivery; an unbounded queue can retain Sessions and event work indefinitely.

### D14: Reuse the Core Key in consumers without absorbing their domain models

- **Choice:** Session, Asset, Workspace, RuntimeManager, and Agent history use the Core Key. memos-client uses it as `channel_hash`, but keeps `userId`, `conversationId`, `agentId`, author hashes, message hashes, and retrieval policy under plugin ownership.
- **Rationale:** The Core Key defines channel persistence identity. MemOS fields encode user, bot, conversation, and retrieval semantics that Core should not own.
- **Alternatives considered:** Replacing every MemOS identity with the Channel Key would collapse distinct memory scopes.

## Risks / Trade-offs

- [Risk] A 128-bit digest can collide in theory. -> Mitigation: verify every directory against its Manifest and fail closed on mismatch.
- [Risk] Opaque directories hinder manual lookup. -> Mitigation: maintain a readable `channels.json` and optional channel names.
- [Risk] Database outages block shared messages. -> Mitigation: fail closed to preserve one-responder ownership; direct messages remain independent.
- [Risk] An assignee handover can wait forever on a stuck turn. -> Mitigation: cap waiting events at five and retain explicit stop/restart recovery instead of starting a second Runtime.
- [Risk] Manifest and Catalog updates cannot form one filesystem transaction. -> Mitigation: make Manifest authoritative and rebuild the Catalog.
- [Risk] Plugins can misuse paths after resolution. -> Mitigation: validate Core inputs and document that namespace resolution is not a sandbox against trusted plugin code.
- [Trade-off] Shared channels lose per-bot local history isolation. -> Accepted because Koishi permits one assignee per shared Channel and account changes should retain history.
- [Trade-off] Existing data becomes inaccessible through the new service. -> Accepted because the project has removed legacy data compatibility and rejected migration complexity.

## Migration Plan

1. Introduce the tagged Channel Key and conformance vectors without reading old paths.
2. Add the Core Manifest, Catalog, namespace registry, and direct `YesImBotService` methods.
3. Require Database and apply shared assignee admission before any Session side effect.
4. Move RuntimeManager ownership and two-phase handover to the new Key.
5. Move Session and Asset paths beneath `channels/<key>/`.
6. Move Workspace to the registered Core namespace and remove its independent channel root.
7. Replace memos-client channel hashing with the Core Key.
8. Verify clean-start behavior, crash repair, path rejection, reset, and online handover.

The release does not move or delete old data. Rollback restores the old code, which continues to see only the old layout. Data created under the new layout remains untouched but unread by the rolled-back version. Acceptance requires all protocol vectors and cross-module path tests to pass.

## Open Questions

None. Concrete error class names, error codes, log event names, and operator message wording remain implementation details and must preserve the behavior defined here.
