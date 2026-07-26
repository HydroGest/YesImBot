# Simplify Core Runtime Architecture: Brainstorm Record

## Background

Two review documents identified a mix of sound core architecture and avoidable complexity:

- `docs/architecture-review.md`
- `docs/codebase-review.md`

The core message pipeline remains valid:

```text
Koishi Session
  -> Gateway admission and resolution
  -> RuntimeManager ownership
  -> ChannelRuntime FIFO, Agent, and Will evaluation
  -> Gateway passive delivery
```

The requested change is a coordinated cleanup rather than a new feature. It must preserve persisted channel identity, JSONL history, assets, workspace data, Session lifetime isolation, FIFO ordering, one Agent stream consumer per turn, and delivery-failure ownership.

The OneBot `message_reactions_updated` test failure was already fixed in the working tree. This change does not remove or rework that event.

## Review Findings Confirmed Against Current Source

The following findings still apply:

- `resolveBasePath` is duplicated in Core service, model service, and ChannelRuntime assembly.
- `registerWill`, `Will.Factory`, `RuntimeEntry.generation`, and generation retries have no production caller outside their own support path.
- `Will.State` contains `pending`, `recent`, and `lastActivityAt`, but both Will implementations ignore the entire state value.
- `MAX_RECENT_EVENTS = 32` exists only to maintain the unused `recent` state window.
- Gateway performs assignee admission before Resolver side effects, then RuntimeManager performs another hot-path database query.
- RuntimeManager also contains queries that are provably redundant within the same lifecycle operation.
- `MediaPolicy` and `MediaSelectionPolicy` define the same fields.
- image freezing, asset persistence, MIME detection, and model-call selection are split across four generic modules.
- `shared/` groups unrelated file I/O, element normalization, MIME detection, and database admission logic.
- configuration defaults are repeated between the Koishi schema and runtime fallback code.
- several internal and public exports have no production caller.
- `gateway/index.ts` and `gateway/message.ts` form one admission and fallback-resolution flow.
- `runtime/manager.ts` and `runtime/channel.ts` form one runtime ownership module but contain two distinct classes and two distinct serialization domains.

## Fixed Scope Decisions

The user set these constraints before design exploration:

- Keep platform adapters inside Core and normalize their import paths.
- Keep `sendMessage` able to send to an explicit arbitrary `channelId`.
- Remove `registerWill`.
- Remove `RuntimeEntry.generation`, generation-driven retries, and generation checks.
- Retain internal factory-based Will construction and model it as a Will engine.
- Simplify `Will.State` and remove the 32-event window.
- Merge Gateway and fallback Resolver logic into one file.
- Merge RuntimeManager and ChannelRuntime into one file.
- Consolidate the four generic image-processing paths and reconsider `event/media.ts` ownership.
- Use OpenSpec planning and make no product-code changes before explicit implementation approval.

## Decision Chain

### Q1: How far should `Will.State` be simplified?

Options considered:

1. Remove the entire state parameter.
2. Keep only `activeTurnId`.
3. Remove only `recent`.

Decision: keep only `activeTurnId`.

Rationale: this removes the unused arrays and activity timestamp while preserving a small read-only hook for engines that need to distinguish an idle channel from a busy turn.

### Q2: How should the two image budgets relate?

Options considered:

1. Keep two phases but share defaults.
2. Use one unified budget.
3. Expose independent ingress and model-selection configuration.

Decision: use one unified budget.

The same `maxCount`, `maxBytesPerImage`, and `maxTotalBytes` values will constrain ingress freezing, AssetStore file size, and model-call selection. Download timeout and concurrency remain fixed ingress execution parameters because they are not selection limits.

### Q3: What is the storage namespace lifetime?

Options considered:

1. Unregister with the owning plugin.
2. Keep every namespace for the entire service lifetime.
3. Replace dynamic registration with a fixed namespace list.

Decision: unregister with the owning plugin.

The registration mechanism must retain stale-disposer protection. A disposer from an older plugin instance must not remove a namespace registered by a newer instance.

### Q4: How should zero-production-call public interfaces be handled?

Options considered:

1. Delete only internal dead code.
2. Delete all zero-production-call public and internal interfaces directly.
3. Deprecate public interfaces first.

Decision: delete them directly, without a deprecation period.

Later clarification: embedding is an explicit exception. The embedding registration, resolution, query, model-reference, provider-capability, and configuration chain remains intact even without a current in-repository consumer.

### Q5: What does "Will engine" mean?

Options considered:

1. Keep the `Will` interface and add only an internal factory function.
2. Rename the interface to `WillEngine` and keep an internal factory.
3. Combine routing and willingness into one strategy class.

Decision: rename the interface to `WillEngine`.

The concrete implementations become routing and willingness engines. An internal `createWillEngine` function selects one from frozen configuration. Core does not expose an engine registration interface.

### Q6: How should the overall change be delivered?

Options considered:

1. Contract-first incremental cleanup followed by mechanical moves.
2. Mechanical file cleanup before behavioral contract changes.
3. One integrated refactor.

Decision: one integrated refactor.

The OpenSpec change will cover the full target state. Its implementation tasks still follow dependency order so each checkpoint can compile and run focused tests.

### Q7: When does shared-channel assignee authority take effect?

Options considered:

1. Gateway admission is an event snapshot.
2. Runtime submission must query the assignee again.
3. RuntimeManager owns the only query, after Resolver side effects.

Decision: Gateway admission is the event snapshot.

Gateway performs the single ordinary-event database query before Resolver work and image loading. An admitted event does not perform a second hot-path query before persistence. Runtime lifecycle mutations still query the current assignee.

### Q8: Should automatic online assignee handover remain?

The current mechanism automatically marks the old Runtime as draining, bounds waiting events, waits for FIFO, Agent, streams, and delivery leases, then creates a Runtime for the new assignee.

Decision: remove automatic handover.

When an admitted event carries a `selfId` different from the cached Runtime, routing fails closed with an explicit "reload required" error. Core does not drain, wait, retry, or switch assignees automatically.

### Q9: Who triggers the assignee change reload?

Options considered:

1. Require explicit `ctx.yesimbot.reload(newScope)`.
2. Let the first event trigger a full reload and retry itself.
3. Require a full Core service restart.

Decision: require explicit channel reload.

Reload validates the current database assignee, drains and stops the cached Runtime, removes the cache entry, preserves persisted data, and leaves recreation lazy for the next admitted event.

### Q10: How should reload and reset differ?

Decision:

- `reload(scope)` drains and stops a cached Runtime without clearing channel data. It is a no-op for an uncached channel after assignment validation.
- `reset(scope)` drains and stops a cached Runtime, then clears `sessions/messages.jsonl` and assets through one RuntimeManager-owned cleanup path. It preserves the Manifest, workspace, and other registered namespaces.
- ChannelRuntime no longer owns a separate reset implementation.
- Routes that reach a reloading Runtime fail explicitly. They do not wait and do not retry automatically.
- A reload failure leaves the channel failed closed and does not publish another Runtime.

## Approaches Considered

### Contract-first staged cleanup

This approach would update specs, then runtime behavior, then file layout. It offers the easiest review and rollback path. The user rejected it because the desired product of this planning cycle is one integrated architecture change.

### Mechanical cleanup first

This approach would merge and move files before changing runtime behavior. It was rejected because large import-path diffs would obscure assignee, reload, and FIFO changes.

### Integrated refactor

This approach captures the complete target state in one OpenSpec change. It was selected. The task plan must still order tests and implementation so concurrency and persistence behavior remain inspectable.

## Approved Target Architecture

```text
core/src/
├── gateway/
│   ├── index.ts       Gateway, SessionResolver contract, Satori fallback
│   └── allowlist.ts   allowedChannels matching
├── runtime/
│   ├── index.ts       RuntimeManager and ChannelRuntime as separate classes
│   ├── prompt.ts
│   ├── storage.ts
│   └── prompts/
├── will/
│   ├── index.ts       WillEngine, createWillEngine, routing engine
│   └── willingness.ts willingness engine and pure calculations
├── media/
│   └── index.ts       unified policy, freezing, AssetStore, MIME, selection
├── event/
│   ├── index.ts       Event and Input contracts
│   ├── formatter.ts   pure model formatting
│   └── element.ts     Element normalization and sealing
├── storage/
│   ├── index.ts       namespace registration and safe channel paths
│   └── manifest.ts
├── platforms/
│   └── onebot/        Core-owned platform adapter with relative imports
├── path.ts            single `resolveBasePath`
└── config.ts          single source for configuration defaults
```

`shared/` is removed. Asset and MIME behavior move to media, element helpers move to event, and assignee checks move into runtime ownership.

## Approved Runtime Model

RuntimeManager and ChannelRuntime share one source file but remain separate classes.

- RuntimeManager owns the map by `channelIdentity`, per-identity lifecycle serialization, explicit reload, reset, global stop, model resolution, plugin snapshots, and runtime creation.
- ChannelRuntime owns one channel FIFO, Agent, WillEngine, stream consumer, delivery leases, and drain/stop behavior.
- Their promise tails remain separate.
- Runtime routing never creates a second Runtime for one shared identity.
- A cached `selfId` mismatch requires explicit reload.
- Automatic handover maps, waiter limits, retry loops, and generation state are deleted.

The internal Will interface is:

```ts
interface WillEngine {
  decide(input: Input, state: WillEngine.State): Awaitable<WillEngine.Decision>
  onReply?(): Awaitable<void>
  stop?(): Awaitable<void>
}
```

`WillEngine.State` contains only `activeTurnId`. Routing and willingness construction occurs only through `createWillEngine`.

## Approved Media Model

One numeric image budget controls the generic pipeline:

```yaml
multimedia:
  enabled: true
  image:
    maxCount: 4
    maxBytesPerImage: 5242880
    maxTotalBytes: 10485760
    selection: current-first
```

- Gateway uses the budget while freezing one admitted message.
- AssetStore uses the per-image limit.
- Every model request gets a fresh count and total-byte selection budget using the same values.
- `multimedia.enabled` still controls model projection, not whether valid images are frozen for durable history.
- OneBot retains platform-specific HTTP, file, and data URL byte loading.
- Generic load, timeout, count, total-byte, MIME, persistence, read-integrity, and selection behavior live in `media/index.ts`.

## Approved Namespace Model

ChannelStorage keeps dynamic plugin namespaces and built-in `sessions` and `assets` namespaces.

- A plugin registration receives a unique symbol token.
- Duplicate active registration fails.
- Disposal removes the namespace only when the token still owns it.
- `ensureStorage` rejects inactive namespaces.
- Existing path segment, symlink, containment, reserved-name, and Manifest checks remain unchanged.

## Public Surface Cleanup

The change removes zero-production-call public and internal exports directly, except for the embedding capability chain.

Confirmed removals include:

- `registerWill` and Will factory exports
- `listChannels` and `ChannelFilter`
- `sameChannel`
- dead platform `apply`
- dead `putImage`
- empty `model/middleware.ts`
- dead barrels and test-only exports that can become private

The change preserves the OneBot reaction event restored outside this scope.

The `sendMessage` tool retains explicit cross-channel behavior. Its TypeScript contract must be corrected without adding an outbound allowlist.

## Contract Changes Required

The following main specifications conflict with the approved design and need delta requirements:

- `channel-will-evaluation`
- `core-runtime-integration`
- `platform-message-ingestion`
- `model-input-media-budgeting`
- `workspace-sandbox-tools`
- `memos-cloud-memory`

The documentation must remove claims about Will registration, generation-based replacement, online handover, independent image budgets, and `listChannels`.

## Validation Expectations

The implementation plan must use focused tests before the full root pipeline.

- Lock the already-restored OneBot reaction behavior as the baseline.
- Prove one database query for each admitted shared external event.
- Prove cached assignee mismatch fails and does not auto-reload.
- Prove explicit reload validates assignment, drains fully, preserves data, removes the cache entry, and recreates lazily under the new `selfId`.
- Prove reset uses the same sessions/assets cleanup path for cached and uncached channels.
- Prove the unified budget controls freeze, AssetStore, and every model request.
- Preserve namespace stale-disposer and storage path-safety tests.
- Run Core-focused tests and type checks, then root lint, format check, type check, build, and tests.

## Approval

The user approved the target architecture, WillEngine model, Gateway admission snapshot, explicit reload requirement, unified media budget, namespace lifetime, public-surface cleanup with an embedding exception, and creation of OpenSpec planning artifacts. Product code remains unchanged until a later explicit implementation approval.
