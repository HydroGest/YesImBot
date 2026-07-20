# Platform Adapter System Roadmap

## Purpose

This file is the cross-session entry point for the YesImBot platform adapter
work. It tracks development phases, current status, handoff context, and the
next blocking decisions. Normative behavior remains in `design.md` and the delta
specs. Raw decision history remains in `brainstorm.md`.

## Current Status

| Area | Status | Evidence |
| --- | --- | --- |
| Source and legacy review | Complete | `brainstorm.md` source findings |
| Architecture brainstorming | Complete for first implementation scope | `brainstorm.md` D1-D20 |
| Proposal | Complete | `proposal.md` |
| Technical design | Complete for Slice 01 | `design.md` |
| Delta specs | Complete for Slice 01 | `specs/` |
| Public API naming | Complete for the first implementation | Naming Decisions below |
| Slice tasks | Slice 01 complete | `slices/01-first-implementation/tasks.md` |
| Slice plans | Slice 01 complete | `slices/01-first-implementation/plan.md` |
| Production code | Slice 01 implemented and verified | `slices/01-first-implementation/verify.md` |
| PlatformService refactor | Complete | `docs/platform-service-refactor-20250718.md` |
| Slice 01 retrospective | Complete | `docs/retrospective.md` |

OpenSpec validation passes with the resource-snapshot and naming decisions:

```text
rtk openspec validate design-platform-adapter-system --strict
```

Run validation again after each later artifact or implementation batch. The
root OpenSpec status does not count numbered slice artifacts; the Slice Status
table is authoritative for per-version tasks, plans, apply, and verification.

## Slice 01: First Implementation

The first implementation is not a throwaway prototype. It must establish the
stable extension contracts through one real platform integration:

1. Core collects Satori-dispatched Sessions once and preserves current message
   routing behavior.
2. Core validates standardized messages, standard events, namespaced custom
   events, and structured external publication.
3. Core owns final LLM presentation, template boundaries, and stable historical
   projection.
4. Core resolves configured message resources before first agent persistence,
   then renders persisted snapshots without I/O.
5. OneBot integration converts `message-reactions-updated` as the native-event
   proof case.
6. OneBot integration reads `get_forward_msg` as the platform-resource proof
   case.
7. Image handling proves channel-local content-addressed storage and stable model
   presentation.

World state, willingness evaluation, and guild/account-to-agent routing are not
part of this first vertical slice. The implementation must expose the structured
facts they will consume later.

## Confirmed Resource Rules

- Synchronous Session conversion performs no I/O.
- Optional resource resolution runs after conversion and before the original
  message is first persisted by the agent runtime.
- `toModelMessages` performs deterministic rendering only and does not call
  platform APIs, access the network, download resources, or resolve references.
  It may read an immutable channel-local asset by content hash to build a stable
  media part.
- Any resolved content that becomes model-visible is frozen with the original
  message so later prompts do not change between model requests.
- Forward and quote snapshots are stored inline after configured depth, count,
  detail, and length limits are applied.
- Binary media is stored by content hash under the current channel directory;
  messages retain stable asset references.
- Raw Sessions, authentication tokens, signed URLs, download streams, and
  temporary platform handles are not persisted.
- Failed resolution produces a stable unavailable snapshot. Core does not
  opportunistically rewrite old history after a later retry.
- Resource policy has core-wide defaults in the first implementation. Platform
  plugins own API invocation details but cannot loosen core safety budgets.
- Old messages keep the snapshot and policy result created when they were first
  persisted. New configuration applies to new messages only.

## Version Roadmap

### Slice 01 Planning Gate

**Status:** Closed (Verified 2026-07-18)

**Exit criteria (all met):**

- Public names are confirmed.
- `brainstorm.md`, `design.md`, and delta specs include the resource-snapshot
  decisions.
- OpenSpec strict validation passes.
- `slices/01-first-implementation/tasks.md` and `plan.md` contain no unresolved
  placeholders.
- Root `fmt:check` baseline explicitly accepted (pre-existing, not caused by
  Slice 01). Separate formatting cleanup may be pursued outside this change.

## Slice Workflow

This OpenSpec change is the shared design and requirements container. The
implementation proceeds through numbered vertical slices under:

```text
slices/
  01-first-implementation/
    tasks.md
    plan.md
    verify.md
  02-standard-event-consumers/
    tasks.md
    plan.md
    verify.md
  03-additional-platforms/
    tasks.md
    plan.md
    verify.md
```

Each slice follows one complete workflow:

1. **Task:** Write the slice-scoped checklist in `tasks.md`. It must reference
   the shared design/spec requirements it implements and define an independently
   testable exit state.
2. **Plan:** Write the TDD implementation plan in `plan.md` with exact paths,
   interfaces, commands, expected failures, passing evidence, and commit points.
3. **Apply:** Implement only that slice. Do not begin a dependent slice while
   the current slice has unresolved tasks or failed checks.
4. **Verify:** Record fresh test, typecheck, formatting, build, diff, and spec
   evidence in `verify.md`. A slice is complete only after its exit criteria and
   referenced requirements are proven.

The numbered slice files are intentionally additional OpenSpec artifacts.
`openspec status` tracks the shared schema artifacts, while this roadmap tracks
slice progress. `openspec validate --strict` must still pass after every slice.

### Slice Status

| Slice | Scope | Status | Depends On |
| --- | --- | --- | --- |
| 01 | Complete first implementation: core input, stable views, resource snapshots, OneBot validation | **Verified** — all 25 deltas have passing evidence; pre-existing `fmt:check` baseline explicitly accepted | None |
| 02 | Standard event consumers, world state, and explicit guild/account routing | **Exploring** — separate design in progress | Slice 01 verified; separate design artifact |
| 03 | Additional platform validation and expanded model media handling | Deferred | Slice 02 scope review |

Each slice is a complete releasable version. Milestones inside a slice do not
receive separate task, plan, apply, or verify cycles.

## Roadmap Maintenance

- Update this file whenever a slice changes status, scope, dependency, or exit
  criteria. Do not postpone status updates until the end of the whole change.
- Add one dated Decision Log entry for every cross-slice design change. Keep
  implementation detail in the affected slice plan and normative behavior in
  `design.md` or `specs/`.
- Link each started slice to its `tasks.md`, `plan.md`, and `verify.md` from the
  Slice Status table.
- Mark a slice `Applying` only after its task and plan documents are complete.
- Mark a slice `Verified` only from fresh commands recorded in `verify.md`.
- Mark a slice `Blocked` only with the concrete unmet dependency or decision.
- Never rewrite a verified slice to hide later changes. Create the next numbered
  slice or add a corrective slice with a new number.
- Keep the four Slice 01 milestone scopes stable. Move new features to later
  version slices unless they are required to satisfy a Slice 01 acceptance
  scenario.
- At the end of every work session, update Current Status, Slice Status, the
  Decision Log, and the Resume Checklist if the next command or file changed.
- A new session starts from this roadmap and the active slice artifacts. It does
  not repeat the original source, Koishi/Satori, or legacy exploration unless a
  recorded assumption has changed.

### Slice 01 Milestones (All Complete — Verified 2026-07-18)

The slice was executed as one task/plan/apply/verify cycle covering four
milestones in a single implementation:

1. **Core Input Boundary** — Single `internal/session` collection with
   middleware correlation, stable schemas, live disposables, structured
   publication, preserved routing.
2. **Stable Views** — Typed `MessageView`/`EventView` models, deterministic
   `toModelMessages` with no platform I/O, safe media presentation, template
   boundaries.
3. **Resource Snapshots** — Pre-persistence resolution, frozen snapshots,
   forward/quote limits, stable failures, channel-local content-addressed
   assets, reset cleanup.
4. **OneBot Validation** — Explicit profile matching, native reaction event,
   forward reader, image acquisition, contract tests proving core independence.

### Slice 02: Standard Event Consumers

**Status:** Exploring — separate design in progress

**Candidate work:**

- World-state consumers for selected Satori guild, member, role, reaction, and
  request events.
- Explicit routes from guild/account facts to agent contexts.
- Consumer-owned persistence and idempotency.

This phase requires a separate design for world-state ownership and routing.

### Slice 03: Additional Platforms and Model Media

**Status:** Deferred

**Candidate work:**

- Validate the adapter contract against a second non-OneBot platform.
- Add only platform-specific refiners and resource readers required by real
  differences.
- Define explicit media handling modes for supported model providers.
- Consider bounded caches only after measurement shows repeated platform reads.
- Revisit a unified resource center only when cross-channel reuse has concrete
  ownership, authorization, retention, and garbage-collection requirements.

## Naming Decisions

The first implementation uses a short `Platform` namespace instead of repeating
the `Platform` prefix on every public type:

- `Platform.Message`
- `Platform.Event`
- `Platform.Scope`
- `Platform.Adapter`
- `Platform.MessageView`
- `Platform.EventView`
- `Platform.Reader`
- `ctx.yesimbot.platform.register(extension)`
- `ctx.yesimbot.platform.publish(input)`

No public common message-or-event union is required. Internal code can use a
direct TypeScript union. The rejected terms `Ingress`, `Projector`, `Envelope`,
`Activity`, `ProcessingScope`, and `Presentation` are not approved API names.

## Resume Checklist

Start a new session with this reading order:

1. `openspec/changes/design-platform-adapter-system/HANDOFF.md`
2. `openspec/changes/design-platform-adapter-system/ROADMAP.md`
3. `openspec/changes/design-platform-adapter-system/design.md`
4. `openspec/changes/design-platform-adapter-system/specs/`
5. The active `openspec/changes/design-platform-adapter-system/slices/NN-name/tasks.md`
6. The active `openspec/changes/design-platform-adapter-system/slices/NN-name/plan.md`
7. The previous slice `verify.md`, when the active slice depends on it

Then run:

```text
rtk git status --short
rtk openspec status --change design-platform-adapter-system
rtk openspec validate design-platform-adapter-system --strict
```

Do not revert unrelated working-tree changes. Continue from the active slice
artifacts. When starting Slice 02, read the exploration output and then create
`tasks.md`, `plan.md`, and `verify.md` under
`slices/02-standard-event-consumers/`. Do not repeat source and legacy
exploration.

## Next Action

Begin Slice 02 exploration: design the standard event consumer system covering
world-state consumers for Satori guild, member, role, reaction, and request
events, explicit routes from guild/account facts to agent contexts, and
consumer-owned persistence and idempotency. Produce a separate `design.md` for
world-state ownership and routing before creating Slice 02 tasks and plan.

## Decision Log

- 2026-07-15: Created the OpenSpec change and captured the initial architecture.
- 2026-07-16: Confirmed the OneBot reaction, forward, and image vertical slice.
- 2026-07-16: Replaced runtime-only resource expansion with pre-persistence,
  stable resource snapshots to preserve deterministic model input and prompt
  cache reuse.
- 2026-07-16: Approved the short `Platform.*` namespace and
  `ctx.yesimbot.platform.register()/publish()` service surface.
- 2026-07-16: Defined each numbered slice as one complete implementation version.
  Slice 01 contains four milestones under one task, plan, apply, and verify cycle.
- 2026-07-16: Kept model projection offline except for deterministic reads of
  immutable channel-local assets by content hash, and deferred a unified
  resource center until cross-channel lifecycle requirements are concrete.
- 2026-07-16: Completed Slice 01 tasks and implementation plan. The next session
  starts the apply phase at Task 1 and updates task status incrementally.
- 2026-07-16: Added a self-contained HANDOFF for sequential subagent execution
  of Slice 01 in the current shared workspace.
- 2026-07-17: Completed Slice 01 Task 7 focused, package, root, OpenSpec, and
  patch verification. All required tests, typechecks, builds, strict validation,
  and diff checks passed; root `fmt:check` failed across the existing tracked
  formatter baseline, so Task 7.2 and Slice 01 Verified status remain pending.
- 2026-07-18: PlatformService refactor completed (4 commits, 30 files,
  +1160/−1147): factory→class conversions, `registry.ts` merged into
  `PlatformService`, `runtime/prompt.ts` inlined, config split via
  `Schema.intersect`.
- 2026-07-18: Slice 01 final whole-change review completed. All 25 deltas have
  passing evidence from committed state; pre-existing `fmt:check` baseline
  explicitly accepted. Slice 01 status changed to **Verified**.
- 2026-07-18: Slice 02 exploration begins. Scope: standard event consumers,
  world state, and explicit guild/account routing.
