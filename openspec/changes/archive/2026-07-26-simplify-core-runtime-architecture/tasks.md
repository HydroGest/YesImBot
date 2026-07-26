## 1. Lock Runtime Lifecycle Behavior

- [x] 1.1 Add focused tests proving Gateway performs exactly one assignee query for each admitted shared external event and direct events perform none.
- [x] 1.2 Add tests proving a cached shared Runtime `selfId` mismatch fails before persistence with a reload-required diagnostic and does not start automatic handover or retry.
- [x] 1.3 Add tests proving explicit reload validates assignment, coalesces concurrent calls, drains outside lifecycle serialization, preserves all persisted channel data, removes the cache entry, and recreates lazily.
- [x] 1.4 Add tests proving route during reload fails without waiting or retrying and reload failure leaves the channel failed closed.
- [x] 1.5 Add tests proving cached and uncached reset use one sessions/assets cleanup contract while preserving Manifest, workspace, and other namespaces.

## 2. Replace Will With Internal WillEngine

- [x] 2.1 Rename the Will contract and concrete engines, reduce `WillEngine.State` to `activeTurnId`, and update Will observation typing and tests.
- [x] 2.2 Add `createWillEngine(config, diagnostics)` as the only routing/willingness construction path and preserve willingness calculation behavior.
- [x] 2.3 Remove `registerWill`, `Will.Factory`, custom factory state, generation fields, generation checks, and generation retry tests.
- [x] 2.4 Remove pending/recent/activity bookkeeping and `MAX_RECENT_EVENTS` from ChannelRuntime while preserving Agent append, wait, join, and run behavior.

## 3. Implement Explicit Runtime Reload And Unified Reset

- [x] 3.1 Replace automatic handover state, waiter accounting, route retry loops, and `wouldNeedHandover` with explicit reload-required and reload-in-progress errors.
- [x] 3.2 Implement one per-identity reload task that marks the Runtime reloading inside the lifecycle queue, drains it outside the queue, and removes the entry without replacement.
- [x] 3.3 Move reset teardown and sessions/assets cleanup into RuntimeManager and remove `ChannelRuntime.reset()`.
- [x] 3.4 Remove ordinary Runtime assignee revalidation, retain lifecycle mutation checks, and delete redundant service-level and same-operation queries.
- [x] 3.5 Preserve delivery leases, internal delivery-failure completion, FIFO serialization, failed-closed reload behavior, and global stop ordering.

## 4. Unify Media Configuration And Ownership

- [x] 4.1 Rename multimedia image limit keys to `maxCount`, `maxBytesPerImage`, and `maxTotalBytes`, and make `config.ts` the single default-value source.
- [x] 4.2 Add tests proving the same configured values limit one-message freezing, AssetStore acceptance, and every model-request selection budget.
- [x] 4.3 Move generic freezing, AssetStore, MIME detection, media policy, and input-file selection into `core/src/media/index.ts`.
- [x] 4.4 Preserve fixed 10-second download timeout, concurrency 2, per-reference accounting, selection strategies, and text-preserving failure behavior.
- [x] 4.5 Keep `multimedia.enabled` as a model-projection switch while continuing to freeze valid ingress images for durable history.

## 5. Simplify Storage And Shared Ownership

- [x] 5.1 Replace namespace object owners with symbol tokens while preserving duplicate-registration rejection and stale-disposer safety.
- [x] 5.2 Move element normalization and sealing to `event/element.ts` and move assignee checks into runtime ownership.
- [x] 5.3 Add `core/src/path.ts` as the sole `resolveBasePath` implementation and pass resolved paths into Runtime assembly.
- [x] 5.4 Delete `core/src/shared/` after all production and test imports use the new owners.
- [x] 5.5 Preserve storage segment validation, symlink rejection, containment checks, atomic Manifest creation, and integrity verification tests.

## 6. Consolidate Gateway And Runtime Files

- [x] 6.1 Merge Satori draft and fallback message resolution into `gateway/index.ts`, remove duplicate `scopeFromSession`, and delete `gateway/message.ts`.
- [x] 6.2 Merge RuntimeManager and ChannelRuntime into `runtime/index.ts` while retaining separate classes, separate promise tails, and internal interfaces.
- [x] 6.3 Extract private Runtime assembly helpers for the send tool, event-format plugin, will-reply plugin, and concrete OutputQueue.
- [x] 6.4 Update production and test imports after the file merges without changing Gateway, Runtime, or delivery behavior.

## 7. Remove Dead Surface And Simplify Types

- [x] 7.1 Remove `listChannels`, `ChannelFilter`, `sameChannel`, dead platform `apply`, dead `putImage`, empty `model/middleware.ts`, and dead barrels.
- [x] 7.2 Make test-only helper exports private when production behavior still needs the helper.
- [x] 7.3 Preserve the complete embedding capability chain as the explicit zero-caller exception.
- [x] 7.4 Replace unnecessary Runtime result and OutputQueue type machinery while retaining the distributive `Event<K>` type with an explanatory comment.
- [x] 7.5 Correct the `sendMessage` AgentToolSet typing and remove the type escape without restricting explicit cross-channel sends.

## 8. Normalize Platform And Package Contracts

- [x] 8.1 Replace Core-owned OneBot self-package imports with relative source imports.
- [x] 8.2 Declare `koishi-plugin-adapter-onebot` as an optional peer and development dependency appropriate for the built-in adapter typing.
- [x] 8.3 Verify the restored `onebot.message-reactions-updated` behavior remains green and unchanged by the import and file moves.

## 9. Update Documentation And Migration Guidance

- [x] 9.1 Update root README, `core/README.md`, and `AGENTS.md` for internal WillEngine, explicit assignee reload, unified media keys, merged module layout, and removed APIs.
- [x] 9.2 Add CHANGELOG entries for direct public API removals, multimedia configuration renames, and the required reload procedure after assignee changes.
- [x] 9.3 Confirm `docs/athena-development-log.md` remains unchanged because this work is a cleanup rather than a new product-evolution record.

## 10. Verify The Integrated Change

- [x] 10.1 Run focused Core tests for Gateway, RuntimeManager, ChannelRuntime, service, WillEngine, media freezing, AssetStore, storage, and OneBot resolution.
- [x] 10.2 Run Core typecheck, build, and full workspace tests after all moves and removals.
- [x] 10.3 Run root `lint`, `fmt:check`, `check-types`, `build`, and `test` in CI order.
- [x] 10.4 Run strict OpenSpec validation and confirm every delta requirement has an implementation task and test evidence.
