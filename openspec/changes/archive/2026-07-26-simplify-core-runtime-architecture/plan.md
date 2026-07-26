# Simplify Core Runtime Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify Core's runtime, Will, media, storage, and public surfaces while preserving channel persistence, FIFO and delivery semantics, and requiring an explicit reload after shared-assignee changes.

**Architecture:** Move the coupled Gateway flow into `core/src/gateway/index.ts` and both runtime classes into `core/src/runtime/index.ts`. The approved runtime-file consolidation is a user-selected exception to the general small-file preference: `RuntimeManager` retains its per-identity lifecycle tail, and `ChannelRuntime` retains its per-runtime FIFO tail. Internal `WillEngine`, unified media, storage token ownership, and one base-path/default source remove obsolete extension points without adding compatibility layers.

**Tech Stack:** TypeScript 5.9 strict mode, Koishi 4, Zod, Vercel AI SDK, Vitest, Yarn 4, Turborepo.

## Global Constraints

- Use Yarn 4 with `rtk yarn ...`; do not use npm or pnpm.
- Preserve strict TypeScript: introduce no `any`, `as never`, non-null assertion, `@ts-ignore`, or compatibility assertion escape.
- Do not add compatibility shims, deprecated APIs, legacy configuration aliases, dual reads, migrations, or fallback support for removed contracts.
- Keep the built-in OneBot adapter in `core/src/platforms/onebot/`; normalize its Core imports to relative source imports.
- Preserve unrestricted `sendMessage({ channelId, content })` and direct `bot.sendMessage(channelId, content)` behavior. Do not add an outbound allowlist.
- Preserve the complete embedding configuration, provider-capability, model-reference, resolution, query, and list chain as the explicit zero-caller exception.
- Do not alter the restored `onebot.message-reactions-updated` behavior; reaction work is out of scope.
- Gateway admission is the only ordinary shared-event assignee query. Reload, reset, and other lifecycle mutations query current assignment inside their per-identity lifecycle operation.
- Never restore online handover, waiter limits, route retries, runtime assignee revalidation, Will.Factory, generation state, generation retries, or independent ingress/model image budgets.
- `multimedia.enabled` gates model projection only. Valid ingress images continue to freeze into durable history when it is false.
- Retain channel identity, Manifest, JSONL, asset, workspace, namespace, FIFO, one-stream-consumer, delivery-lease, and delivery-failure contracts.
- Make no product-code change before this OpenSpec change is explicitly approved for application. This plan itself is planning-only.
- Do not assert natural-language prompt prose. Assert machine-consumed routing, types, structured outputs, or observable behavior.
- Use a human-review checkpoint after each task. Do not commit unless the user separately authorizes a commit during execution.
- The approved `runtime/index.ts` and `media/index.ts` consolidations are user-selected exceptions to the general small-file preference. Keep their internal classes/functions cohesive; do not undo the approved layout solely to satisfy a line-count heuristic.

## File Map

| Target path | Responsibility after this change |
| --- | --- |
| `core/src/path.ts` | Sole `resolveBasePath(basePath, ctxBaseDir)` implementation. |
| `core/src/config.ts` | `DEFAULT_MULTIMEDIA_IMAGE_POLICY` and configuration schema/default source. |
| `core/src/will/index.ts` | Internal `WillEngine`, routing engine, observation contract, and `createWillEngine`. |
| `core/src/will/willingness.ts` | `WillingnessWillEngine` and pure willingness calculations. |
| `core/src/media/index.ts` | Unified image policy, freezer, `AssetStore`, MIME detection, integrity reads, and model-file selection. |
| `core/src/event/element.ts` | Element normalization, sealing, and unavailable-image helpers. |
| `core/src/gateway/index.ts` | Gateway admission, resolver contract, Satori draft/fallback resolution, and image freezer construction. |
| `core/src/runtime/index.ts` | Separate `RuntimeManager` and `ChannelRuntime` classes, separate tails, lifecycle errors, and runtime assembly helpers. |
| `core/src/storage/index.ts` | Symbol-token namespace registration and safe path/Manifest protocol. |
| `core/src/platforms/onebot/*` | Core-owned OneBot resolver and loader using relative Core imports. |

## Interface Contracts

The implementation must converge on these interfaces before file consolidation:

```ts
export interface WillEngine {
  decide(input: Input, state: WillEngine.State): Awaitable<WillEngine.Decision>;
  onReply?(): Awaitable<void>;
  stop?(): Awaitable<void>;
}

export namespace WillEngine {
  export type Decision = "wait" | "trigger";
  export interface State {
    readonly activeTurnId: string | null;
  }
}

interface WillEngineDiagnostics {
  readonly now: () => number;
  readonly random: () => number;
  readonly warn: (event: string, fields: Record<string, unknown>) => void;
}

export function createWillEngine(
  config: Config["will"] | undefined,
  diagnostics: WillEngineDiagnostics,
): WillEngine;

export class RuntimeReloadRequiredError extends Error {
  readonly scope: ChannelScope;
}

export class RuntimeReloadInProgressError extends Error {
  readonly scope: ChannelScope;
}

interface RuntimeEntry {
  readonly selfId: string;
  state: "active" | "reloading" | "failed";
  readonly runtime: ChannelRuntime;
}

export interface UnifiedImagePolicy {
  // `enabled` is read only by model projection. The freezer and AssetStore MUST
  // ignore it and apply the three numeric limits unconditionally.
  readonly enabled: boolean;
  readonly maxCount: number;
  readonly maxBytesPerImage: number;
  readonly maxTotalBytes: number;
  readonly selection: "current-first" | "fifo" | "lifo";
}

export function resolveBasePath(basePath: string, ctxBaseDir: string): string;
```

`createWillEngine` is synchronous, selects routing for missing or `routing` configuration and willingness for `willingness`, and receives no Session, scope, Agent, storage, AssetStore, or send capability. `RuntimeEntry` deliberately has no generation, handover, waiter, or retry fields.

## Execution Rules

For each behavioral change, execute RED -> verify RED -> GREEN -> verify GREEN -> refactor in that order. Run a focused Vitest command after each RED and GREEN step. Use these commands exactly, prefixed with `rtk`:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/gateway.test.ts
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/runtime-manager.test.ts
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel-runtime.test.ts
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/will.test.ts
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/image-freeze.test.ts tests/asset.test.ts tests/formatter.test.ts
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/storage.test.ts tests/element.test.ts tests/assignee.test.ts
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/service.test.ts tests/lifecycle.test.ts
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel.test.ts tests/model.test.ts
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform/onebot.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

Every file above already exists in `core/tests/`; no task creates a new test file.

After every source edit, inspect changed-file diagnostics and resolve errors before moving on. At task checkpoints, ask a human reviewer to inspect the diff and test evidence. A commit is optional only after separate authorization.

---

### Task 1: Lock Admission And Lifecycle Regressions

**Tasks.md coverage:** 1.1, 1.2, 1.3, 1.4, 1.5.

**Files:**
- Modify: `core/tests/gateway.test.ts`
- Modify: `core/tests/runtime-manager.test.ts`
- Modify: `core/tests/service.test.ts`
- Modify later in GREEN: `core/src/gateway/index.ts`, `core/src/runtime/manager.ts`, `core/src/service.ts`

**Interfaces:**
- Consumes: current `Gateway.handle(session)`, `RuntimeManager.route(record)`, `reload(scope)`, `reset(scope)`, and `ChannelRuntime` test double.
- Produces: regression tests whose expected interface is `RuntimeReloadRequiredError`, `RuntimeReloadInProgressError`, and a runtime entry state of `"active" | "reloading" | "failed"`.

- [ ] **Step 1: RED for 1.1, no Runtime route revalidation**

  In `core/tests/runtime-manager.test.ts`, route an already-admitted shared record through a real RuntimeManager fixture with a Database spy and assert RuntimeManager performs zero assignee queries. In `core/tests/gateway.test.ts`, retain or add characterization assertions that Gateway performs one query before Resolver work for a shared Session and zero for a direct Session.

- [ ] **Step 2: Verify RED for 1.1**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/gateway.test.ts tests/runtime-manager.test.ts`

  Expected: the Gateway characterization passes and the RuntimeManager assertion fails because current `route()` revalidates the assignee.

- [ ] **Step 3: RED for 1.2 and 1.4, explicit route failures**

  In `core/tests/runtime-manager.test.ts`, replace handover-route tests with tests that create a cached shared runtime for `bot-1`, route an admitted record for `bot-2`, and assert rejection is `RuntimeReloadRequiredError`; `handle`, `beginDrain`, `drainAndStop`, model resolution, and persistence are not invoked. Add a deferred reload test: after `reload(scope)` marks the entry reloading, a route rejects `RuntimeReloadInProgressError` without awaiting the deferred drain or retrying.

- [ ] **Step 4: Verify RED for 1.2 and 1.4**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/runtime-manager.test.ts`

  Expected: the mismatch test observes automatic handover/retry behavior and the route-during-reload test observes a retry or a draining error instead of the dedicated reload error.

- [ ] **Step 5: RED for 1.3, coalesced non-destructive reload**

  In `core/tests/runtime-manager.test.ts`, use a deferred `drainAndStop` mock. Start two reloads for one identity and assert both wait for the same drain, `beginDrain` is called once inside lifecycle serialization, no replacement is constructed, persisted `sessions`, `assets`, `workspace`, and a registered custom namespace remain readable, and the next route constructs a runtime lazily with the new `selfId` and the same JSONL path.

- [ ] **Step 6: Verify RED for 1.3**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/runtime-manager.test.ts`

  Expected: the test fails because current routing creates the replacement through automatic handover rather than requiring explicit reload and lazy recreation.

- [ ] **Step 7: RED for 1.5, one reset cleanup contract**

  Add cached and uncached reset cases in `core/tests/runtime-manager.test.ts` that share an observable sessions/assets cleanup helper outcome: JSONL and assets are removed, Manifest/workspace/custom namespace survive, assets cleanup still runs after JSONL cleanup failure, cache removal occurs, and the first cleanup error is reported after later mandatory cleanup. Assert neither case calls `ChannelRuntime.reset()`.

- [ ] **Step 8: Verify RED for 1.5**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/runtime-manager.test.ts`

  Expected: cached reset still calls `ChannelRuntime.reset()` and therefore fails the shared-cleanup assertion.

- [ ] **Step 9: GREEN admission snapshot and lifecycle ownership**

  Update `core/src/gateway/index.ts`, `core/src/runtime/manager.ts`, and `core/src/service.ts` so Gateway retains the sole ordinary shared-event check, `RuntimeManager.route()` does no assignee query, and service delegates `reload`/`reset` without a duplicate check. Implement lifecycle-local assignment checks only in manager reload/reset paths. Add the two dedicated reload error classes and fail before `ChannelRuntime.handle()` on cached shared `selfId` mismatch or reloading state.

- [ ] **Step 10: GREEN explicit reload/reset state machine**

  In `core/src/runtime/manager.ts`, replace handover coordination with one coalesced reload task per identity: mark the entry `reloading` in the lifecycle tail, call `drainAndStop()` outside the tail, remove the same entry in a follow-up lifecycle operation, and mark it `failed` if draining fails. Put reset teardown and ordered sessions/assets cleanup in one manager-owned function used by both cache states; remove the entry after cleanup is attempted.

- [ ] **Step 11: Verify GREEN**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/gateway.test.ts tests/runtime-manager.test.ts tests/service.test.ts`

  Expected: all three files pass; the Database call count is one for admitted shared Gateway events and zero for direct events.

- [ ] **Step 12: Refactor and review checkpoint**

  Remove superseded handover/generation tests only after their replacement tests pass. Confirm lifecycle errors retain distinct names and causes. Ask for human review of the admission snapshot, failed-closed reload, cache deletion, and reset cleanup evidence; do not commit without authorization.

### Task 2: Replace Will Factories With Internal Engines

**Tasks.md coverage:** 2.1, 2.2, 2.3, 2.4.

**Files:**
- Modify: `core/src/will/index.ts`, `core/src/will/willingness.ts`, `core/src/config.ts`
- Modify: `core/src/runtime/channel.ts`, `core/src/runtime/manager.ts`, `core/src/service.ts`, `core/src/index.ts`
- Modify: `core/tests/will.test.ts`, `core/tests/channel-runtime.test.ts`, `core/tests/runtime-manager.test.ts`, `core/tests/service.test.ts`

**Interfaces:**
- Consumes: Task 1 lifecycle behavior; `Input`, `Awaitable`, `Config["will"]`.
- Produces: `WillEngine`, `WillEngine.State`, `WillEngine.Decision`, `WillEngineObservation`, and synchronous `createWillEngine(config, diagnostics): WillEngine`.

- [ ] **Step 1: RED for 2.1, reduced state and renamed contract**

  In `core/tests/will.test.ts`, replace `Will` imports and `EMPTY_STATE` with `WillEngine` and `{ activeTurnId: null }`. Add `expectTypeOf<WillEngine.State>()` coverage that rejects the old state fields through the type checker, and retain routing behavior tests for direct, mention, ordinary group, non-message, and `delivery.failed` inputs.

- [ ] **Step 2: Verify RED for 2.1**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/will.test.ts`

  Expected: imports/types fail because `WillEngine` and the reduced state do not exist.

- [ ] **Step 3: RED for 2.2, construction and isolation**

  In `core/tests/will.test.ts`, add tests that `createWillEngine(undefined, diagnostics)` creates a routing engine, `createWillEngine({ engine: "willingness" }, diagnostics)` creates a willingness engine, and two calls return distinct object identities. Keep existing willingness calculation/decay/reply-cost tests while renaming only the engine class and contract.

- [ ] **Step 4: Verify RED for 2.2**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/will.test.ts`

  Expected: `createWillEngine` is unavailable.

- [ ] **Step 5: RED for 2.3 and 2.4, remove factory and window behavior**

  Remove `registerWill`/`setWill` test cases from `core/tests/service.test.ts` and `core/tests/runtime-manager.test.ts`. In `core/tests/channel-runtime.test.ts`, replace the 32-event-window case with a test whose engine records `state` for two events and receives only the current `activeTurnId`; preserve append -> event observation -> engine decision -> will observation ordering and wait/join/run behavior.

- [ ] **Step 6: Verify RED for 2.3 and 2.4**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel-runtime.test.ts tests/runtime-manager.test.ts tests/service.test.ts`

  Expected: old state fields remain and factory APIs prevent the updated test doubles from compiling or meeting assertions.

- [ ] **Step 7: GREEN the WillEngine contract**

  In `core/src/will/index.ts`, rename `Will` to `WillEngine`, rename `DefaultWill` to `RoutingWillEngine`, reduce state to `activeTurnId`, and keep the typed `yesimbot/will` observation with `WillEngine.Decision`. In `core/src/will/willingness.ts`, rename `WillingnessWill` to `WillingnessWillEngine` without changing score, decay, probability, or reply-cost behavior.

- [ ] **Step 8: GREEN factory and runtime integration**

  Add `createWillEngine(config, diagnostics)` in `core/src/will/index.ts`; construct it synchronously from frozen runtime config and diagnostic callback. In `core/src/runtime/manager.ts`, replace all custom factory selection with this function. Remove `registerWill`, custom factory storage, `setWill`, generation state/checks/retries, `MAX_RECENT_EVENTS`, pending/recent/activity bookkeeping, and `ChannelRuntime` state mutation that only supported them.

- [ ] **Step 9: Verify GREEN**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/will.test.ts tests/channel-runtime.test.ts tests/runtime-manager.test.ts tests/service.test.ts`

  Expected: routing/willingness calculations, one distinct engine per runtime, read-only reduced state, observations, and Agent FIFO behavior pass.

- [ ] **Step 10: Refactor and review checkpoint**

  Remove package-root Will exports and factory-only test exports once consumer imports are updated. Verify no production path mentions `Will.Factory`, `generation`, `MAX_RECENT_EVENTS`, `pending`, `recent`, or `lastActivityAt`. Ask for human review of the internal-only engine boundary; do not commit without authorization.

### Task 3: Delete Residual Handover Machinery And Lock Delivery Semantics

**Tasks.md coverage:** 3.1, 3.2, 3.3, 3.4, 3.5.

**Scope boundary:** Task 1 already implemented Gateway-only ordinary assignee lookup, the two reload error classes, the coalesced reload task, and the manager-owned sessions/assets cleanup path. This task does **not** reimplement them. It deletes the code and tests those steps made unreachable, removes `ChannelRuntime.reset()`, and locks the delivery, FIFO, and global-stop invariants that must survive Tasks 4-8.

**Files:**
- Modify: `core/src/runtime/manager.ts`, `core/src/runtime/channel.ts`
- Modify: `core/tests/runtime-manager.test.ts`, `core/tests/channel-runtime.test.ts`, `core/tests/gateway-delivery.test.ts`, `core/tests/lifecycle.test.ts`

**Interfaces:**
- Consumes: Task 1 errors/states and Task 2 `WillEngine`.
- Produces: lifecycle-only manager coordination; no `ChannelRuntime.reset()`; preserved `ChannelRuntime.handleInternal()` and delivery leases.

- [ ] **Step 1: Confirm the Task 1 lifecycle baseline**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/runtime-manager.test.ts tests/service.test.ts`

  Expected: pass. Gateway owns the only ordinary shared assignee query, `route()` rejects a cached `selfId` mismatch with `RuntimeReloadRequiredError`, and both reset paths already share the manager-owned cleanup. If any of those fail, finish Task 1 before continuing; do not add a second reload implementation here.

- [ ] **Step 2: Delete residual handover machinery for 3.1, 3.2, and 3.4**

  In `core/src/runtime/manager.ts`, delete the handover symbols Task 1 left unreachable: `wouldNeedHandover`, handover task state, five-event waiter accounting, and the recursive route retry. Task 2 already removed `setWill` and the `generation` fields and checks, so confirm their absence rather than deleting them again. Delete `core/tests/runtime-manager.test.ts` cases whose only subject is the five-event handover limit, phase-two assignee revalidation, automatic replacement, or stale-generation discard. This is dead-code deletion after Tasks 1 and 2, so no new failing test precedes it.

- [ ] **Step 3: Verify the deletion**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/runtime-manager.test.ts tests/service.test.ts` and `rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot`

  Expected: both pass, and `handover`, `waiter`, `generation`, and `setWill` no longer appear in `core/src/runtime/` or `core/src/service.ts`.

- [ ] **Step 4: Remove `ChannelRuntime.reset()` for 3.3**

  Task 1 already asserted that neither reset path calls `ChannelRuntime.reset()`, so the method is now unreferenced. Delete `reset()` from `core/src/runtime/channel.ts` and any test double member that only mirrored it. Keep `beginDrain`, `drainAndStop`, `handleInternal`, delivery leases, FIFO, Agent, engine, and stream ownership untouched.

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel-runtime.test.ts tests/runtime-manager.test.ts`

  Expected: pass; no caller of `ChannelRuntime.reset` remains.

- [ ] **Step 5: Lock the delivery, FIFO, and isolation invariants for 3.5**

  These are green-baseline guards for the file moves in Tasks 4-8, not new behavior. In `core/tests/channel-runtime.test.ts` and `core/tests/gateway-delivery.test.ts`, retain or add observable tests: an outstanding delivery lease keeps `drainAndStop()` waiting; `delivery.failed` remains accepted through `handleInternal()` while ordinary inputs reject during drain; one stream consumer serves a busy join; a failed reload for one identity leaves another channel routable; global stop stops runtimes without clearing persisted assets.

- [ ] **Step 6: Verify the invariant baseline**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel-runtime.test.ts tests/gateway-delivery.test.ts tests/lifecycle.test.ts`

  Expected: all pass. Any failure here is a regression from Tasks 1-3, not a pending implementation; fix it before Task 4.

- [ ] **Step 7: Verify and review checkpoint**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/runtime-manager.test.ts tests/channel-runtime.test.ts tests/gateway-delivery.test.ts tests/lifecycle.test.ts tests/service.test.ts`

  Expected: lifecycle tests pass with no online handover behavior anywhere in the suite. Ask for human review of the two independent tails and delivery failure ownership; do not commit without authorization.

### Task 4: Unify Media Defaults, Budget, And Generic Ownership

**Tasks.md coverage:** 4.1, 4.2, 4.3, 4.4, 4.5.

**Files:**
- Create: `core/src/media/index.ts`
- Modify: `core/src/config.ts`, `core/src/service.ts`, `core/src/runtime/channel.ts`, `core/src/runtime/manager.ts`, `core/src/gateway/index.ts`
- Delete after migration: `core/src/gateway/image.ts`, `core/src/event/media.ts`, `core/src/shared/asset.ts`, `core/src/shared/image-mime.ts`
- Modify: `core/tests/image-freeze.test.ts`, `core/tests/asset.test.ts`, `core/tests/formatter.test.ts`, `core/tests/channel-runtime.test.ts`, `core/tests/runtime-manager.test.ts`

**Interfaces:**
- Consumes: `ChannelStorage`, `ChannelScope`, `Input`, `ModelMessageContext`, and the current element helper until Task 5 moves that helper to `event/element.ts`.
- Produces: `UnifiedImagePolicy`, `AssetStore`, `createImageFreezer(options)`, `selectInputFiles(context, options)`, `detectImageMime(data)`, and `UnsupportedImageMimeError` from `core/src/media/index.ts`.

- [ ] **Step 1: RED for 4.1, renamed config keys and one default source**

  `core/tests/runtime-manager.test.ts` holds the only existing `multimedia` fixture (currently `maxCountPerCall: 2`, `maxBytesPerImage: 1024`, `maxBytesPerCall: 2048`). Rename those keys to `maxCount`, `maxBytesPerImage`, and `maxTotalBytes`. Assert the Koishi `Config` schema materializes those three values and that RuntimeManager snapshots an immutable policy whose omitted fields equal exactly the exported `DEFAULT_MULTIMEDIA_IMAGE_POLICY` values. Do not add a fixture that still accepts an old key name.

- [ ] **Step 2: Verify RED for 4.1**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/runtime-manager.test.ts`

  Expected: the renamed fixture fails because `core/src/config.ts` and `core/src/runtime/manager.ts` still read `maxCountPerCall` and `maxBytesPerCall`, and `DEFAULT_MULTIMEDIA_IMAGE_POLICY` does not exist yet.

- [ ] **Step 3: RED for 4.2, identical budget across all three phases**

  Add focused cases using a non-default policy such as `{ maxCount: 1, maxBytesPerImage: 8, maxTotalBytes: 8 }`: `image-freeze.test.ts` verifies one accepted freeze then permanent unavailable form; `asset.test.ts` verifies nine bytes reject at AssetStore; `formatter.test.ts` verifies each independent model context selects at most one eight-byte image and a second tool-loop context receives a fresh budget.

- [ ] **Step 4: Verify RED for 4.2**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/image-freeze.test.ts tests/asset.test.ts tests/formatter.test.ts`

  Expected: generic paths use separate hard-coded/default limits rather than the shared fixture policy.

- [ ] **Step 5: RED for 4.4 and 4.5, preserved ingress/projection behavior**

  Retain tests that prove 10-second timeout, concurrency two, per-reference accounting, `current-first`/FIFO/LIFO ordering, invalid MIME/read failure text-only projection, and no remote fetch during selection. Add one Gateway test proving `multimedia.enabled: false` still freezes an eligible ingress image, and one projection test proving the same setting does not read or append image file parts.

- [ ] **Step 6: Verify RED for 4.4 and 4.5**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/image-freeze.test.ts tests/formatter.test.ts tests/gateway.test.ts`

  Expected: the new shared policy wiring is absent while current execution controls and selection mechanics remain available.

- [ ] **Step 7: GREEN defaults and unified policy**

  In `core/src/config.ts`, export `DEFAULT_MULTIMEDIA_IMAGE_POLICY` as the one immutable default image-policy value and use it in both the Koishi Schema defaults and runtime fallback construction. Replace `maxCountPerCall`/`maxBytesPerCall` with `maxCount`/`maxTotalBytes` in the `Config` interface and Schema; reject old configuration by schema/type failure. Delete the separate `IMAGE_BUDGET` literal that `core/src/gateway/image.ts` currently owns, and delete the duplicated `?? 4`, `?? 5 * 1024 * 1024`, and `?? 10 * 1024 * 1024` fallbacks in `core/src/runtime/manager.ts` so `config.ts` is the only default source. Make RuntimeManager create one immutable `UnifiedImagePolicy` snapshot per runtime. The freezer and AssetStore must ignore `enabled` and apply the numeric limits unconditionally; only model projection reads `enabled`.

- [ ] **Step 8: GREEN for 4.3, consolidate media ownership**

  Move generic freezer, fixed timeout/concurrency, AssetStore, MIME detection, integrity-checked reads, selection strategy, and file selection into `core/src/media/index.ts`. Pass unified policy to freezer, AssetStore, and each selector call. Retain the current element-helper import until Task 5 moves it to `event/element.ts`. Keep OneBot's HTTP/file/data URL byte loading in `core/src/platforms/onebot/image.ts`; it receives the remaining-byte limit only through `freezeImage`.

- [ ] **Step 9: Verify GREEN and review checkpoint**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/image-freeze.test.ts tests/asset.test.ts tests/formatter.test.ts tests/channel-runtime.test.ts tests/runtime-manager.test.ts`

  Expected: all media behavior passes, every model context gets a fresh count/total budget, and disabled multimedia freezes but does not project images. Ask for human review of the one-budget ownership and old-key removal; do not commit without authorization.

### Task 5: Move Shared Utilities, Add Path Owner, And Tokenize Namespaces

**Tasks.md coverage:** 5.1, 5.2, 5.3, 5.4, 5.5.

**Files:**
- Create: `core/src/event/element.ts`, `core/src/path.ts`
- Modify: `core/src/storage/index.ts`, `core/src/service.ts`, `core/src/model/service.ts`, `core/src/gateway/index.ts`, `core/src/runtime/manager.ts`, `core/src/platforms/onebot/*`
- Delete: `core/src/shared/index.ts`, `core/src/shared/element.ts`, `core/src/shared/assignee.ts`, remaining `core/src/shared/*`
- Modify: `core/tests/storage.test.ts`, `core/tests/element.test.ts`, `core/tests/assignee.test.ts`, `core/tests/service.test.ts`, `core/tests/model.test.ts`

**Interfaces:**
- Consumes: unified media ownership from Task 4.
- Produces: `resolveBasePath(basePath, ctxBaseDir): string`, element functions under `event/element.ts`, and `Map<string, symbol>` namespace ownership.

- [ ] **Step 1: Establish the green namespace-safety baseline**

  In `core/tests/storage.test.ts`, retain or add a characterization sequence: register `workspace`, dispose it, register `workspace` again, invoke the old disposer again, then assert `ensure(scope, "workspace")` succeeds. Keep duplicate active-registration rejection and inactive-namespace rejection. This behavior already exists; the object-to-symbol change is an internal representation refactor and does not require a fabricated RED failure.

- [ ] **Step 2: Verify the namespace baseline**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/storage.test.ts`

  Expected: all namespace lifecycle and stale-disposer behavior passes before the representation change.

- [ ] **Step 3: Establish the green owner/path behavior baseline**

  Retain current element normalization, assignee admission, and relative/absolute service/model path behavior tests using their current imports. Record the expected resolved storage and models paths with hand-derived fixtures. Do not change imports until the new owners exist.

- [ ] **Step 4: Verify the owner/path baseline**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/element.test.ts tests/assignee.test.ts tests/service.test.ts tests/model.test.ts`

  Expected: all existing element, assignee, service, and model path behavior passes before moving code.

- [ ] **Step 5: Preserve storage safety coverage**

  Keep all existing `core/tests/storage.test.ts` cases for invalid segments, reserved names, key/namespace/intermediate/final symlink rejection, containment, atomic Manifest creation, startup scan, and Manifest identity verification. These tests must run unchanged except import/type changes.

- [ ] **Step 6: GREEN moved owners and namespaces**

  Add `core/src/event/element.ts` with the existing normalization/sealing API and update its tests in the same step. Move `AssigneeAdmissionError` and `assertAssignee` from `core/src/shared/assignee.ts` into runtime ownership without changing the Database query contract, and update `core/tests/assignee.test.ts` imports. Both remaining callers — Gateway admission and RuntimeManager lifecycle operations — then import them from runtime. This adds a value import from `gateway` to `runtime`, which does not create a cycle: `core/src/gateway/index.ts` imports `RuntimeManager` as a type only, and runtime imports nothing from gateway. After Task 1, `core/src/service.ts` no longer calls `assertAssignee` at all. Add `core/src/path.ts`; import it from service, model service, and runtime assembly, and pass resolved base paths to prompt/runtime construction. Replace `Map<string, object>` with `Map<string, symbol>`, retaining only a disposer whose captured symbol still owns the namespace.

- [ ] **Step 7: GREEN for 5.4, delete shared directory**

  Update every production and test import to `event/element`, `media`, `runtime`, or `path`, then delete all `core/src/shared/*`. Do not alter validation, symlink, containment, Manifest, or namespace behavior while moving code.

- [ ] **Step 8: Verify GREEN and review checkpoint**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/storage.test.ts tests/element.test.ts tests/assignee.test.ts tests/service.test.ts tests/model.test.ts`

  Expected: token ownership works and all path/storage safety checks remain green. Ask for human review of each ownership move and the absence of `shared/`; do not commit without authorization.

### Task 6: Consolidate Gateway And Runtime Modules

**Tasks.md coverage:** 6.1, 6.2, 6.3, 6.4.

**Files:**
- Modify: `core/src/gateway/index.ts`, `core/src/runtime/index.ts`
- Delete: `core/src/gateway/message.ts`, `core/src/runtime/manager.ts`, `core/src/runtime/channel.ts`
- Modify imports: `core/src/service.ts`, `core/src/index.ts`, tests under `core/tests/`
- Modify: `core/tests/gateway.test.ts`, `core/tests/runtime-manager.test.ts`, `core/tests/channel-runtime.test.ts`, `core/tests/gateway-delivery.test.ts`

**Interfaces:**
- Consumes: Tasks 1-5 target contracts.
- Produces: `gateway/index.ts` exports `Gateway`, `ResolveContext`, `SessionResolver`; `runtime/index.ts` exports `RuntimeManager`, `ChannelRuntime`, `AgentPluginFactory`, lifecycle errors, and concrete `ChannelRuntime.Output`/result contracts as necessary.

- [ ] **Step 1: Establish the green module behavior baseline**

  Run current Gateway, RuntimeManager, ChannelRuntime, and delivery tests before moving files. Retain tests for one resolver, fallback sealing, scope validation, Session non-retention, independent lifecycle/FIFO serialization, one stream consumer, and delivery leases.

- [ ] **Step 2: Verify the module baseline**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/gateway.test.ts tests/runtime-manager.test.ts tests/channel-runtime.test.ts tests/gateway-delivery.test.ts`

  Expected: all tests pass before file consolidation.

- [ ] **Step 3: Map callers before moving files**

  Use caller search to list every production and test import of `gateway/message.ts`, `runtime/manager.ts`, and `runtime/channel.ts`. Confirm the target `gateway/index.ts` and `runtime/index.ts` export list from the Interface Contracts section before editing.

- [ ] **Step 4: Consolidate Gateway without behavior changes**

  Move `draftMessageBase`, `resolveFallbackMessage`, `numberValue`, and the sole `scopeFromSession` into `core/src/gateway/index.ts`; import element helpers from `event/element.ts`; delete `gateway/message.ts`. Keep `allowlist.ts` separate and preserve exactly one Resolver invocation per accepted Session.

- [ ] **Step 5: Consolidate Runtime without combining state machines**

  Move manager and channel implementations into `core/src/runtime/index.ts`. Preserve separate `RuntimeManager` and `ChannelRuntime` classes, their separate `tails`/`tail` promise fields, and their isolated responsibilities. Extract private module helpers for `sendMessage` tool creation, event-format plugin, will-reply plugin, Agent assembly, and concrete output queue. Update production and test imports only after target exports exist. Remove only unnecessary result/output type indirection; keep public observable results stable where consumers need them.

- [ ] **Step 6: Verify the mechanical refactor and review checkpoint**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/gateway.test.ts tests/runtime-manager.test.ts tests/channel-runtime.test.ts tests/gateway-delivery.test.ts`

  Expected: merged module paths pass with unchanged Gateway, FIFO, single-stream-consumer, and delivery behavior. Ask for human review specifically confirming two separate classes and two separate tails remain in `runtime/index.ts`; do not commit without authorization.

### Task 7: Remove Dead Surfaces And Correct Core Types

**Tasks.md coverage:** 7.1, 7.2, 7.3, 7.4, 7.5.

**Files:**
- Modify: `core/src/index.ts`, `core/src/service.ts`, `core/src/storage/index.ts`, `core/src/channel/index.ts`, `core/src/runtime/index.ts`, `core/src/platforms/index.ts`, `core/src/event/index.ts`
- Delete: `core/src/model/middleware.ts` (currently a 0-byte file), dead barrels, and the unused `apply(ctx)` function in `core/src/platforms/index.ts`
- Keep: the Koishi plugin entrypoint `apply(ctx, config)` in `core/src/index.ts`, plus `name`, `usage`, and `inject`. Only the `platforms/index.ts` `apply` is dead; `core/src/index.ts` imports `Platform` from that module and never its `apply`.
- Modify: `core/tests/channel.test.ts`, `core/tests/service.test.ts`, `core/tests/channel-runtime.test.ts`, `core/tests/model.test.ts`

**Interfaces:**
- Consumes: merged runtime module.
- Produces: package root keeps the Koishi plugin contract (`name`, `usage`, `inject`, `apply`) and exports only `Config`, `channelIdentity`, `ChannelScope`, event contracts, `ResolveContext`, `SessionResolver`, `AgentPluginFactory`, and `YesImBotService`, plus retained embedding APIs under `./model`. Removed from the root: `DefaultWill`, `Will`, `WillObservation`, `ChannelFilter`, and `ChannelRecord`.

- [ ] **Step 1: Remove obsolete API-specific tests and map remaining consumers**

  Remove tests whose sole subject is `sameChannel`, `listChannels`, `ChannelFilter`, `registerWill`, dead platform `apply`, or `putImage`. Replace direct test-only helper imports with tests through the owning production behavior. Use compiler and caller search as removal evidence; do not add source-text checks or runtime assertions that merely test a property is absent.

- [ ] **Step 2: Verify the retained behavior baseline**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel.test.ts tests/service.test.ts tests/channel-runtime.test.ts`

  Expected: retained channel, service, and runtime behavior passes before deleting unused implementations.

- [ ] **Step 3: Record the green embedding preservation baseline**

  In `core/tests/model.test.ts`, retain/add a behavior test that registers an embedding-capable provider, configures/defaults an embedding model, resolves it, and verifies it remains listed/queryable. This test must not depend on an in-repository runtime consumer.

- [ ] **Step 4: Verify the embedding baseline**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/model.test.ts`

  Expected: embedding registration, default resolution, listing, and query behavior passes before deletion work; keep it green throughout the task.

- [ ] **Step 5: Record the green observable type-behavior baseline**

  In `core/tests/channel-runtime.test.ts`, retain the observable test that invokes `sendMessage` with `{ channelId: "room-2", content: "hello" }` and asserts the bot receives that arbitrary channel. In `core/tests/formatter.test.ts`, retain a compile-aware Event fixture that depends on distributive `Event<K>` narrowing. Run focused tests and typecheck before changing internal annotations; do not manufacture a failing runtime test for a type-only refactor.

- [ ] **Step 6: GREEN for 7.1, 7.2, 7.4, and 7.5, surface and type cleanup**

  Delete the confirmed unused exports and implementations directly: service `listChannels`, the `ChannelStorage.list`/`ChannelFilter`/`matchesFilter` API, `sameChannel` in `core/src/channel/index.ts`, the `apply(ctx)` function in `core/src/platforms/index.ts` (never `apply` in `core/src/index.ts`), the `putImage` member of the media freezer's return value, the 0-byte `core/src/model/middleware.ts`, and unneeded barrels. `registerWill` was already removed in Task 2; verify rather than repeat it. Preserve `ChannelRecord` internally where storage needs it. Keep embedding configuration/types/service methods intact. Simplify runtime result/output types without broad unions; retain the distributive `Event<K>` type and add a short comment explaining that it preserves declaration-merged discriminated event narrowing. Type `sendMessage` as a valid `AgentToolSet` member without `as never` and retain unrestricted channel sending.

- [ ] **Step 7: Verify GREEN and review checkpoint**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel.test.ts tests/service.test.ts tests/channel-runtime.test.ts tests/model.test.ts tests/formatter.test.ts`

  Expected: removed APIs are absent, embedding behavior remains intact, Event narrowing compiles, and explicit cross-channel send behavior passes. Ask for human review of breaking removals and absence of assertion escapes; do not commit without authorization.

### Task 8: Normalize OneBot Imports And Package Metadata

**Tasks.md coverage:** 8.1, 8.2, 8.3.

**Files:**
- Modify: `core/src/platforms/onebot/index.ts`, `core/src/platforms/onebot/events.ts`, `core/src/platforms/onebot/image.ts`
- Modify: `core/package.json`, root lockfile only if Yarn changes it during approved implementation
- Modify: `core/tests/platform/onebot.test.ts`

**Interfaces:**
- Consumes: `core/src/gateway/index.ts` `ResolveContext` and `SessionResolver`; event contracts from `core/src/event/index.ts`.
- Produces: only relative imports from Core-owned OneBot code to Core contracts; `koishi-plugin-adapter-onebot` in `peerDependencies` and `devDependencies`.

- [ ] **Step 1: Establish the green OneBot baseline**

  Run `core/tests/platform/onebot.test.ts` unchanged in meaning. Confirm resolution, bounded HTTP/file/data loading, poke handling, and restored reaction behavior pass before import changes.

- [ ] **Step 2: Record the baseline result**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform/onebot.test.ts`

  Expected: all OneBot tests pass before the mechanical import and metadata change.

- [ ] **Step 3: Preserve the reaction baseline**

  Keep the existing `onebot.message-reactions-updated` tests unchanged in meaning: valid notice becomes the typed event, numeric identifiers normalize to strings, and resolver prioritizes the notice. Treat this as a no-regression baseline, not a reaction feature change.

- [ ] **Step 4: GREEN imports, including the EventMap augmentation**

  Three files hold self-package references. Convert all of them:

  - `core/src/platforms/onebot/image.ts:6` — `import type { ResolveContext } from "koishi-plugin-yesimbot"` becomes a relative import from `../../gateway/index.js`.
  - `core/src/platforms/onebot/index.ts:3` — `MessageRecord` becomes a relative import from `../../event/index.js`; `ResolveContext` and `SessionResolver` from `../../gateway/index.js`.
  - `core/src/platforms/onebot/events.ts:2` — `EventRecord` becomes a relative import from `../../event/index.js`.

  `core/src/platforms/onebot/events.ts:16` also contains `declare module "koishi-plugin-yesimbot" { interface EventMap { ... } }`, which registers `notice.poke` and `onebot.message-reactions-updated`. Retarget that block to `declare module "../../event/index.js"`, the module that declares `EventMap`. Do not delete the block and do not leave it pointing at the package root, or Core-owned OneBot code keeps a self-package dependency on its own build output. External plugins may continue augmenting `"koishi-plugin-yesimbot"`, because `core/src/index.ts` re-exports `./event/index.js` and both augmentations merge into the same `EventMap` declaration.

  Then add `koishi-plugin-adapter-onebot` to `peerDependencies` and `devDependencies` in `core/package.json`, mark the peer optional in `peerDependenciesMeta`, and run `rtk yarn install` to update the root lockfile when Yarn requires it.

- [ ] **Step 5: Verify GREEN and review checkpoint**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform/onebot.test.ts` and `rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot`

  Expected: all resolver/image/reaction tests pass unchanged in behavior, `rg "koishi-plugin-yesimbot" core/src` returns nothing, and `resolveOneBotEvent` still typechecks as `EventRecord<"notice.poke" | "onebot.message-reactions-updated"> | null`, which proves the retargeted augmentation still merges. Ask for human review that the adapter remains Core-owned and reactions were not reworked; do not commit without authorization.

### Task 9: Update Migration And Architecture Documentation

**Tasks.md coverage:** 9.1, 9.2, 9.3.

**Files:**
- Modify: `README.md`, `core/README.md`, `AGENTS.md`, `CHANGELOG.md`
- Do not modify: `docs/athena-development-log.md`

**Interfaces:**
- Consumes: final public surface, configuration keys, path/module layout, and explicit reload workflow from Tasks 1-8.
- Produces: release-facing migration guidance without legacy aliases.

- [ ] **Step 1: Prepare exact documentation facts**

  Derive the final list from the implemented API: no Will registration/factories, `reload(scope)` after a shared assignee change, `multimedia.image.maxCount`, `maxBytesPerImage`, `maxTotalBytes`, one image budget, `gateway/index.ts`, `runtime/index.ts`, `media/index.ts`, removed `listChannels`, and no online handover.

- [ ] **Step 2: Update root and Core README**

  In `README.md` and `core/README.md`, replace claims of Will registration, generations, online handover, separate freeze/call budgets, old key names, and public channel listing. Document that reload preserves JSONL/assets/workspace and the next admitted event lazily creates the current-assignee runtime. State that `multimedia.enabled` controls projection, while ingress freezing remains durable.

- [ ] **Step 3: Update AGENTS and CHANGELOG**

  In `AGENTS.md`, update current architecture/source layout and lifecycle facts. In `CHANGELOG.md` Unreleased, record direct removal of Will/factory/list APIs, multimedia key rename, removed automatic handover, and the explicit reload procedure. Do not create compatibility guidance that implies old keys or APIs still work.

- [ ] **Step 4: Verify documentation boundaries and review checkpoint**

  Read each changed document and confirm `docs/athena-development-log.md` has no diff. Ask for human review of migration language and release impact; do not commit without authorization.

### Task 10: Integrated Verification And OpenSpec Evidence

**Tasks.md coverage:** 10.1, 10.2, 10.3, 10.4.

**Files:**
- Modify only if verification exposes a defect: the focused source/test file that owns that behavior.
- Validate: `openspec/changes/simplify-core-runtime-architecture/specs/**/*.md` against implemented test evidence; do not alter specs unless a separately approved specification correction is required.

**Interfaces:**
- Consumes: completed Tasks 1-9.
- Produces: recorded command evidence and a requirement-to-test checklist for review.

- [ ] **Step 1: Run focused Core tests in dependency order**

  Run:

  ```bash
  rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/gateway.test.ts tests/gateway-delivery.test.ts
  rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/runtime-manager.test.ts tests/channel-runtime.test.ts tests/lifecycle.test.ts
  rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/will.test.ts
  rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/image-freeze.test.ts tests/asset.test.ts tests/formatter.test.ts
  rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/storage.test.ts tests/element.test.ts tests/assignee.test.ts
  rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform/onebot.test.ts tests/service.test.ts tests/model.test.ts
  ```

  Expected: all pass, including the restored reaction baseline.

- [ ] **Step 2: Run Core typecheck and build**

  Run:

  ```bash
  rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
  rtk yarn workspace koishi-plugin-yesimbot build
  rtk yarn turbo run test --filter=koishi-plugin-yesimbot
  ```

  Expected: each command exits 0. If build changes generated output, do not treat generated files as source changes.

- [ ] **Step 3: Run root CI-order verification**

  Run:

  ```bash
  rtk yarn lint
  rtk yarn fmt:check
  rtk yarn check-types
  rtk yarn build
  rtk yarn test
  ```

  Expected: each command exits 0 in this order.

- [ ] **Step 4: Map every delta requirement to evidence**

  Review this evidence map before running strict validation and requesting final human approval:

  | Delta requirement | Primary test evidence |
  | --- | --- |
  | `channel-will-evaluation`: configured construction, reduced state, routing/willingness, observation/reply | `core/tests/will.test.ts`, `core/tests/channel-runtime.test.ts`, `core/tests/runtime-manager.test.ts` |
  | `core-runtime-integration`: one runtime, FIFO, explicit reload/reset, stop, media snapshot | `core/tests/runtime-manager.test.ts`, `core/tests/channel-runtime.test.ts`, `core/tests/lifecycle.test.ts`, `core/tests/gateway-delivery.test.ts` |
  | `platform-message-ingestion`: one Gateway query, no route revalidation, mismatch error | `core/tests/gateway.test.ts`, `core/tests/runtime-manager.test.ts`, `core/tests/assignee.test.ts` |
  | `model-input-media-budgeting`: enablement and unified fresh budgets | `core/tests/image-freeze.test.ts`, `core/tests/asset.test.ts`, `core/tests/formatter.test.ts`, `core/tests/runtime-manager.test.ts` |
  | `workspace-sandbox-tools`: same shared identity/root after explicit reload | `core/tests/runtime-manager.test.ts` plus existing workspace package tests |
  | `memos-cloud-memory`: unchanged `channelIdentity`, current-self agent identity after reload | `core/tests/runtime-manager.test.ts` plus existing `plugins/memos-client` identity tests |

- [ ] **Step 5: Run affected plugin tests**

  Run:

  ```bash
  rtk yarn turbo run test --filter=koishi-plugin-yesimbot-workspace
  rtk yarn turbo run test --filter=koishi-plugin-yesimbot-memos-client
  ```

  Expected: workspace namespace/root reuse and MemOS identity tests pass with explicit reload wording and unchanged identity algorithms.

- [ ] **Step 6: Validate the exact OpenSpec change**

  Run: `rtk openspec validate "simplify-core-runtime-architecture" --type change --strict --json`

  Expected: one change item passes with zero issues.

- [ ] **Step 7: Final human-review checkpoint**

  Present focused test, typecheck, build, root-pipeline, and OpenSpec validation results. Confirm no legacy compatibility behavior, handover, independent budget, outbound restriction, or reaction rework was introduced. Request merge/commit direction only after the user separately authorizes it.

## Plan Self-Review

- **Spec coverage:** Tasks 1-3 cover all runtime, admission, reload, reset, FIFO, stop, and error-isolation delta requirements. Task 2 covers every WillEngine addition/modification/removal. Task 4 covers both media requirements. Task 5 covers storage safety and namespace lifetime. Tasks 8 and 10 preserve workspace, MemOS, and OneBot cross-package requirements.
- **No placeholders:** Every task names source paths, test paths, expected behavior, and a runnable Yarn command. No task relies on an unspecified test or a deferred implementation choice.
- **Type consistency:** `WillEngine` and its single-field state flow from factory through ChannelRuntime. `RuntimeEntry` uses only `active`, `reloading`, and `failed`; route errors use dedicated reload error types. Unified media uses `maxCount`, `maxBytesPerImage`, and `maxTotalBytes` in config, freezer, store, and selector.
- **Task 1 / Task 3 boundary:** Task 1 owns the lifecycle behavior change because its tests must end green. Task 3 therefore owns only the deletion of what Task 1 made unreachable, the removal of `ChannelRuntime.reset()`, and the delivery/FIFO/stop invariant baseline. Task 3 asserts a green baseline instead of a fabricated RED, so its steps never claim handover code still exists.
- **Refactor tasks state green baselines:** Tasks 5, 6, and 7 are representation, file-location, and dead-code changes. They record passing baselines before moving code rather than inventing failing tests for behavior that does not change.

## Execution Handoff

Plan complete and saved to `openspec/changes/simplify-core-runtime-architecture/plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using executing-plans, with checkpoints for review.

Use `/opsx:apply` or ask for implementation to begin. Commits remain optional and require separate authorization.
