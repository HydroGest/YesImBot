## Context

Core currently separates live Koishi Session handling, per-channel Runtime ownership, channel persistence, and model projection. Those ownership rules prevent Session leakage, preserve one Agent stream consumer, and keep shared-channel data stable across bot assignment changes.

Several implementation choices no longer earn their cost:

- `registerWill` is the only production path that changes `RuntimeEntry.generation`, but no plugin calls it.
- Both Will implementations ignore `pending`, `recent`, and `lastActivityAt`, while ChannelRuntime copies and freezes those values for every accepted input.
- Gateway and RuntimeManager query the shared-channel assignee for one ordinary event.
- automatic online handover adds waiter accounting, retry loops, draining generations, and failure states that the operator does not want Core to trigger from an event.
- the generic image path spans `gateway/image.ts`, `shared/asset.ts`, `shared/image-mime.ts`, and `event/media.ts`.
- configuration defaults, media contracts, base-path resolution, and public exports repeat across modules.

This change is an integrated refactor. It changes public APIs and configuration, but it does not migrate persisted data or change `channelIdentity`.

## Goals / Non-Goals

**Goals:**

- Replace the public Will extension point with one internal configured `WillEngine` construction path.
- Remove automatic assignee handover and require an explicit non-destructive reload after assignment changes.
- Reduce ordinary shared-event assignee lookup to Gateway admission only.
- Give reload and reset one explicit owner and one cleanup definition.
- Apply one numeric image budget across freeze, persistence, and model selection.
- Consolidate strongly coupled files and remove the unowned `shared/` directory.
- Remove confirmed unused public and internal exports, except the embedding capability chain.
- Preserve FIFO ordering, one Runtime per identity, one Agent stream consumer, delivery ownership, storage safety, and current `sendMessage` behavior.

**Non-Goals:**

- Restricting cross-channel `sendMessage`.
- Moving platform adapters out of Core.
- Changing channel identity, Manifest, JSONL, asset, or workspace formats.
- Changing willingness score and decay mathematics.
- Reintroducing legacy-data compatibility or migration.
- Adding a second Will abstraction, runtime wrapper, or compatibility shim for removed APIs and configuration keys.
- Reworking the restored OneBot reaction event.

## Decisions

### D1: Core owns an internal `WillEngine`

- **Choice:** Rename the internal Will contract to `WillEngine`. Keep `decide`, optional `onReply`, and optional `stop`. `WillEngine.State` contains only `activeTurnId`.
- **Construction:** `createWillEngine(config, diagnostics)` synchronously constructs `RoutingWillEngine` or `WillingnessWillEngine` from frozen runtime configuration. It receives no Session, ChannelScope, Agent, storage, asset, or send capability.
- **Public surface:** Remove `registerWill`, `Will.Factory`, generation state, and package-root Will exports.
- **Rationale:** Configuration already provides the only required variation. A public factory created a runtime invalidation dimension without a production consumer.
- **Alternatives considered:** Keeping `Will` plus a factory function retained outdated terminology. One strategy class would mix deterministic routing with willingness state and mathematics.

### D2: Gateway admission is the ordinary-event assignee snapshot

- **Choice:** Gateway queries the Koishi Channel row before Resolver selection, image loading, persistence, or Runtime creation. Once admitted, that event is not queried again before Runtime submission.
- **Direct channels:** Direct Sessions continue to skip the shared-channel assignee query.
- **Lifecycle mutations:** `reload` and `reset` query current assignee state inside the per-identity lifecycle operation before changing Runtime or persisted state.
- **Rationale:** One query preserves the important pre-side-effect admission boundary. The accepted event keeps a clear snapshot semantic instead of paying for a second best-effort check.
- **Alternative considered:** Runtime submission revalidation rejects assignment changes during Resolver work but keeps two database round trips on every shared event.

### D3: Assignee changes require explicit reload

- **Choice:** RuntimeManager never starts an automatic handover from `route`. If a cached shared Runtime has a different `selfId`, route fails with a dedicated reload-required error before persistence.
- **Removed state:** Delete handover tasks, five-event waiter accounting, automatic route retries, `wouldNeedHandover`, and generation terminology.
- **Rationale:** Assignment changes are operator-controlled configuration changes. Explicit reload makes the transition observable and prevents an ordinary event from initiating a long lifecycle operation.
- **Alternatives considered:** Event-triggered reload still hides an operational transition inside ingress. Full service restart is stricter but needlessly disrupts unrelated channels.

### D4: Reload drains; reset drains and clears

- **Reload:** Validate the requested shared scope, mark a cached Runtime as reloading in the lifecycle queue, drain and stop it outside that queue, then remove its entry. Do not clear data and do not construct a replacement. An uncached reload validates assignment and returns.
- **Reset:** Validate assignment, drain and stop a cached Runtime if present, revalidate before destructive cleanup, clear `sessions/messages.jsonl` and assets through one RuntimeManager-owned function, and remove the entry. Preserve the Manifest, workspace, and every other registered namespace.
- **Concurrency:** Concurrent reload calls for one identity await one reload task. Route during reload fails explicitly and does not wait or retry. Failure marks the entry failed closed and never publishes a second Runtime.
- **ChannelRuntime:** Remove `ChannelRuntime.reset`. ChannelRuntime retains drain, stop, delivery leases, FIFO, Agent, engine, and stream ownership.
- **Rationale:** RuntimeManager can define cached and uncached behavior once. Discarding the stopped Runtime removes any need to preserve Agent memory after reset.

### D5: RuntimeManager and ChannelRuntime share one file, not one state machine

- **Choice:** `runtime/index.ts` contains both classes. RuntimeManager retains its per-identity lifecycle tail. ChannelRuntime retains its per-runtime FIFO tail.
- **Class responsibilities:** RuntimeManager owns cache, lifecycle mutation, model and plugin snapshots, explicit reload, reset, creation, and global stop. ChannelRuntime owns accepted-input persistence, WillEngine evaluation, Agent run/join, one output consumer, delivery leases, drain, and stop.
- **Helpers:** Private module functions create the `sendMessage` tool, event-format plugin, will-reply plugin, and Channel Agent assembly. `OutputQueue` becomes concrete for `ChannelRuntime.Output`.
- **Rationale:** One source file improves locality for the ownership protocol. Separate classes and tails keep the two concurrency domains independently testable.
- **Alternative considered:** One combined class would mix cross-channel cache coordination with per-channel turn serialization.

### D6: Gateway and fallback resolution share one file

- **Choice:** Move Satori draft construction, fallback message resolution, and the sole `scopeFromSession` implementation into `gateway/index.ts`. Keep `allowlist.ts` separate.
- **Platform adapters:** OneBot remains under `core/src/platforms/onebot/` and imports Core contracts by relative source paths. Core declares `koishi-plugin-adapter-onebot` as an optional peer plus development dependency.
- **Rationale:** Gateway and fallback resolution form one Session-to-record flow. Allowlist matching and OneBot resource loading remain separate concerns.

### D7: One numeric media budget governs the generic image path

- **Choice:** Replace call-scoped names with `maxCount`, `maxBytesPerImage`, and `maxTotalBytes`. Gateway freezing, AssetStore, and each model request use those values.
- **Projection switch:** `multimedia.enabled` continues to control model file projection. Gateway still freezes valid images when projection is disabled so persisted history remains stable.
- **Execution controls:** download timeout remains 10 seconds and concurrency remains 2. They are fixed ingress execution controls rather than a second budget contract.
- **Selection:** `current-first`, `fifo`, and `lifo` continue to receive a fresh count and total-byte budget for every model request, including tool-loop requests.
- **Rationale:** A single configured limit removes silent upstream truncation and duplicate policy definitions.
- **Trade-off:** Lowering the configured budget changes both future persistence admission and model projection.

### D8: Generic image handling becomes one media module

- **Choice:** `media/index.ts` owns the unified policy, image freezer, AssetStore, MIME detection, integrity-checked reads, and model file selection.
- **Platform ownership:** OneBot owns only HTTP, file, and data URL loading. It passes bytes through `ResolveContext.freezeImage`.
- **Failure behavior:** freeze failures produce the existing unavailable-image form. Selection failures omit only the file part, retain text and elements, and never re-fetch the platform resource.
- **Rationale:** The four generic steps form one continuous path and share the same budget and MIME rules.

### D9: Storage namespace registration keeps token ownership

- **Choice:** Replace opaque object values with unique symbol tokens. Keep built-in `sessions` and `assets`; keep plugin registration and disposer semantics.
- **Safety:** A disposer removes a namespace only if its token still owns that name. Duplicate active registration fails. `ensureStorage` rejects inactive namespaces.
- **Unchanged checks:** Preserve segment validation, Windows reserved-name rejection, symlink rejection, path containment, atomic Manifest creation, and on-read Manifest verification.
- **Rationale:** The current stale-disposer protection is necessary. The change improves expression without weakening lifecycle safety.

### D10: Remove `shared/` and centralize repeated definitions

- **Choice:** Move asset and MIME code to media, element normalization to `event/element.ts`, and assignee logic to runtime. Delete the dead shared barrel.
- **Paths:** Add `path.ts` as the sole `resolveBasePath` owner. Pass resolved base paths into Runtime assembly.
- **Defaults:** `config.ts` exports the sole default constants used by Schema and fallback construction.
- **Types:** Delete duplicate media policy types, make Runtime result variants explicit, and keep the distributive `Event<K>` type with a comment because it preserves discriminated unions.

### D11: Remove unused public and internal surfaces directly

- **Choice:** Remove `listChannels`, `ChannelFilter`, `sameChannel`, dead platform `apply`, dead `putImage`, empty `model/middleware.ts`, dead barrels, and test-only exports that can be private.
- **Embedding exception:** Preserve provider capabilities, configuration, model references, defaults, resolution, and list/query methods for embedding.
- **No compatibility shim:** Removed APIs and renamed config keys fail at compile or configuration validation time.
- **Documentation:** Update package README files, root README, `AGENTS.md`, and CHANGELOG. Do not add this cleanup to `docs/athena-development-log.md`.

### D12: Preserve unrestricted `sendMessage` with a valid type contract

- **Choice:** Keep `{ channelId, content }` and direct `bot.sendMessage(channelId, content)` behavior. Remove the `as never` escape by matching `AgentToolSet` correctly.
- **Rationale:** Cross-channel sending is an accepted product requirement. Type correctness does not require changing its authority.

## Risks / Trade-offs

- **[Risk] Explicit reload can drop an event that arrives after an assignee change.** → Mitigation: return a distinct reload-required or reload-in-progress diagnostic before persistence; document the operator sequence.
- **[Risk] A reload or reset drain can fail.** → Mitigation: retain failed-closed state and never publish a concurrent Runtime. Global restart remains the recovery path.
- **[Risk] Gateway snapshot admission can accept an event immediately before the database assignment changes.** → Mitigation: define admission as an event snapshot. A later event for the new assignee detects cached `selfId` mismatch and requires reload.
- **[Risk] Unified media limits change ingress behavior when operators tune model limits.** → Mitigation: document that all three numeric fields govern persistence and projection; cover both paths with the same tests.
- **[Risk] A single runtime source file becomes large.** → Mitigation: preserve two classes, organize private helpers by responsibility, and test only through class interfaces.
- **[Risk] Direct public removals break external TypeScript consumers.** → Mitigation: record every removal and config rename in CHANGELOG and release notes; do not add ambiguous compatibility aliases.
- **[Risk] Large file moves can hide behavioral changes in review.** → Mitigation: the task plan locks behavior with focused tests before moving code and runs type checks after every ownership move.
- **[Trade-off] Dynamic namespace unregistering requires owner tokens.** → The small token registry cost is accepted because it prevents hot-reload disposers from invalidating new registrations.

## Migration Plan

1. Add focused regression tests for the accepted baseline, Gateway snapshot admission, explicit reload requirement, unified reset, media limits, and namespace token ownership.
2. Update WillEngine and runtime lifecycle behavior, including public API removals and explicit reload errors.
3. Consolidate media ownership, config defaults, base-path resolution, and namespace tokens.
4. Remove dead exports and merge Gateway and Runtime files after their behavior is locked.
5. Normalize platform imports and update optional dependency declarations.
6. Update documentation and CHANGELOG with API removals, config key renames, and the required assignee reload procedure.
7. Run Core-focused tests and checks, then the root lint, format, type-check, build, and test pipeline.

No persisted-data migration runs. Current channel directories, Manifests, JSONL, assets, and workspace data remain readable.

Rollback before release is a source revert. After release, operators can roll back the package without data conversion, but must restore the previous multimedia configuration keys. Removed TypeScript APIs have no runtime compatibility layer.

## Open Questions

None. The user approved the target architecture, lifecycle semantics, media policy, namespace lifetime, public-surface cleanup, and OpenSpec artifact creation.
