# Simplify Platform Adapter Model Review Fix Design

**Status:** Approved design for a corrective implementation plan  
**Date:** 2026-07-20  
**Scope:** Fix the independent review findings for `simplify-platform-adapter-model`

## Document Relationship

This document defines corrective decisions discovered after the original implementation was marked complete. It supplements the existing proposal and design, and it supersedes conflicting details in those documents for the fixes listed here.

The original `plan.md`, `tasks.md`, and `verify.md` remain unchanged as historical implementation records. Normative files under `specs/` must be updated with the decisions in this document. The corrective implementation and its evidence will be recorded in:

- `review-fix-plan.md`
- `review-fix-verify.md`

## Goals

- Make `ctx.yesimbot.platform` the only documented public platform service entry.
- Restore correct per-channel FIFO semantics using the Agent runtime as the busy-state source of truth.
- Replace ambiguous adapter returns with a discriminated `refine()` result.
- Use Koishi `Element` directly throughout the public and internal message model.
- Keep events publish-only and remove unused event receipt metadata.
- Enforce image limits on actual streamed bytes with cancellation and deterministic total-budget admission.
- Remove full asset storage capabilities from the public adapter boundary.
- Eliminate raw Session retention, duplicated adapter matching, and public type assertions at integration boundaries.
- Support both raw string and structured OneBot forward payloads without leaking raw fields or URLs.
- Restore the regression coverage required by the original change.

## Non-Goals

- No compatibility layer for the removed legacy platform message or JSONL formats.
- No second public service entry for `ctx["yesimbot.platform"]`.
- No public element algebra parallel to Koishi `Element`.
- No event storage, event model projection, event receipt envelope, or event runtime schema system.
- No general media downloader for audio, video, or files.
- No public `AssetStore`, storage layout, asset read, or asset clear capability.
- No change from literal message storage to a serialized element record format.
- No speculative advanced TypeScript utilities when ordinary interfaces, indexed access types, and discriminated unions are sufficient.

## 1. Public Service Boundary

`ctx.yesimbot.platform` is the only documented platform service API.

`PlatformService` remains an internal Koishi Service so it can be constructed before `YesImBotService` and participate in Koishi lifecycle management. Core obtains that dependency through a precisely typed internal context key. `YesImBotService` then exposes it as a readonly `platform` property.

External plugins depend on `yesimbot` and access `ctx.yesimbot.platform`. They do not index a dotted context property and do not use `ctx as any`.

The core plugin construction order remains:

1. `PlatformService`
2. `ModelService`
3. `YesImBotService`

A production-path integration test must construct the plugin through the real `apply()` function and prove that the first collected message can reach platform collection, preparation, and runtime submission without manually injecting a `PlatformService` test double.

## 2. Public Types

### 2.1 Pure-data message

`Platform.Message` remains a plain data object whose working content is a Koishi `Element[]` tree.

```ts
namespace Platform {
  interface Message {
    source: Source
    scope: Extract<Scope, { type: "channel" }>
    sender: Sender
    messageId: string
    timestamp?: number
    receivedAt: number
    elements: Element[]
  }
}
```

The implementation must import the existing Koishi `Element` type. The custom `MsgElement` interface, `any[]` element pipelines, and hand-written pseudo-elements are removed.

Message phase remains an orchestration concern. It is not persisted and no public `MessagePhase` type is added unless implementation code has a concrete use for it.

### 2.2 Literal record

JSONL storage continues to encode sealed elements as one literal string. The shorter persisted-record name is `Platform.MessageRecord`.

```ts
namespace Platform {
  interface MessageRecord {
    source: Source
    scope: Message["scope"]
    sender: Sender
    messageId: string
    timestamp?: number
    receivedAt: number
    content: string
  }
}
```

The domain model remains independent of this encoding. Message companion functions convert between `Element[]` and literal content at the persistence boundary.

### 2.3 Events

`Platform.Event` no longer contains `receivedAt`. There is no production consumer for event receipt time, events are not persisted, and events are not projected into model messages.

Adapters return complete semantic events. `platform.publish(event)` synchronously invokes event subscribers with that event and does not stamp or rewrite it.

`PlatformEventVariants` remains the declaration-merging extension point for precise event `data` inference.

### 2.4 Image sink

`ImagePrepareSink` is write-only:

```ts
interface ImagePrepareSink {
  put(bytes: Uint8Array): Promise<{ assetId: string; mime: string }>
}
```

MIME is determined from byte signatures. There is no `mimeHint` second source of truth.

`AssetStore`, its options, the fixed runtime budget constant, and any full-store getter are not exported from the platform subpath.

## 3. Adapter Contract

The adapter identity remains flat. The removed `AdapterIdentity` wrapper is not restored.

```ts
interface Adapter {
  readonly id: string
  readonly platform?: string
  readonly adapter?: string
  readonly profile?: string
  accepts?(session: Session): boolean
  refine?(input: {
    readonly session: Session
    readonly base?: Platform.Message
  }): Platform.RefineResult
  prepare?(ctx: Platform.PrepareContext): Promise<Element[] | void>
}

type RefineResult =
  | { kind: "keep" }
  | { kind: "ignore" }
  | { kind: "message"; message: Platform.Message }
  | { kind: "event"; event: Platform.Event }
```

`adapt()` is replaced by `refine()`.

Result semantics are fixed:

| Result | Meaning |
| --- | --- |
| `keep` | Keep the core base message. If no base exists, the result is ignore. |
| `ignore` | Produce no message or event. |
| `message` | Replace an existing base message. This result is invalid without a base. Core preserves the base `receivedAt`. |
| `event` | Produce one complete semantic event. |

An invalid `message` result without a base records a diagnostic and is ignored. The contract does not introduce conditional generic return types to encode this runtime relationship; the simple discriminated union plus a runtime guard is more readable.

`prepare()` receives the selected Session, a readonly message, the write-only image sink, and the fixed budget. It returns a complete `Element[]` replacement or `void`. Core applies returned elements to the message and always runs final normalization and sealing. It never accepts a string from the adapter and therefore never adds a second parse boundary.

## 4. Adapter Selection And Failure Policy

Adapter selection is implemented once in `PlatformService`. `normalize.ts` and its duplicate matcher are removed.

The selected adapter and its status are associated with the Session through weak references. Preparation reuses the adapter selected during collection instead of matching again.

Matching rules remain deterministic:

1. Profile rank is higher than adapter rank.
2. Adapter rank is higher than platform rank.
3. `accepts() === false` is an explicit decline and allows the next eligible candidate to be considered.
4. Two accepted candidates at the same winning rank are a configuration conflict and raise an error with both adapter IDs.
5. A thrown `accepts()` or `refine()` records a diagnostic and does not try another adapter.

Failure behavior favors core-safe degradation:

| Failure | Behavior |
| --- | --- |
| `accepts()` throws | Keep the core base when present, mark adapter failed for this Session, skip adapter preparation. |
| `refine()` throws | Keep the core base when present, mark adapter failed for this Session, skip adapter preparation. |
| Invalid `message` result without base | Record a diagnostic, ignore the result, skip adapter preparation. |
| `prepare()` throws | Preserve allowed non-image content and let core seal all unfrozen remote images as unavailable. |
| Listener throws or rejects | Record a diagnostic without preventing other listeners. |

No failure path selects a second adapter after an adapter has thrown.

## 5. Event-only Publication And Session Lifetime

Platform subscribers receive only `Platform.Event` values.

Ordinary messages are retrieved by `YesImBotService` through the Session-to-message association. They are never cast to Event and never sent through event listeners.

Session associations use `WeakMap` and `WeakSet`. Core may retrieve a normalized message or selected adapter for the same Session object during the dispatch lifecycle, but it does not keep Sessions, bots, native payloads, or normalized messages alive after external references disappear.

## 6. FIFO Routing And Reset

Core removes the `activeTurns` mirror. `Agent.getActiveTurnId()` is the busy-state source of truth.

Routing is split into static classification and final busy routing.

For one channel, a single FIFO operation performs:

1. Classify the Session as `ignore`, `append`, or `reply` without reading busy state.
2. Return immediately for `ignore`.
3. Prepare and seal the platform message.
4. Resolve the channel Agent.
5. Submit `append` through `runtime.append()`.
6. For `reply`, read `runtime.getActiveTurnId()` immediately before submission.
7. If active, call `runtime.send(message, { ifBusy: "join" })`.
8. If idle, call `runtime.run(message)` and return its stream from the FIFO operation.

There is no `await` between the busy read and `send()` or `run()`. Stream consumption, outbound response sending, and terminal stream handling occur outside the FIFO operation.

This deliberately replaces the original single-stage `route decision -> prepare` wording. A busy decision made before a potentially ten-second preparation step is stale by construction.

Reset uses the same channel FIFO and runs after all earlier preparation and initial submissions:

1. `runtime.interrupt()`
2. `runtime.stop()`
3. clear message storage
4. clear channel assets
5. delete the cached runtime

Messages queued after reset cannot classify, prepare, or submit until reset finishes. Reset does not wait for an entire model stream before entering the FIFO; interruption terminates the active turn.

## 7. Element Transformation And Message Companion Functions

The message module owns pure-data companion behavior:

- build a draft from Session data
- normalize the allowlisted Element tree
- seal residual remote resources
- encode and decode literal storage
- format the fixed message header
- project a sealed message into a model message

Normalization, sealing, and model projection all require recursive tree traversal. Shared traversal and allowlist helpers live in `platform/utils/elements.ts` and are not exported from `platform/index.ts`.

Unknown and private elements are unwrapped while recursively preserving allowed children. Image, quote, and forward normalization applies at any tree depth. Final sealing guarantees that no remote image URL survives in a sealed message.

## 8. Image Preparation And Asset Validation

OneBot preparation recursively enumerates images in document order.

- Only the first four image nodes are eligible for download.
- Later image nodes become unavailable without starting a request.
- At most two downloads run concurrently.
- HTTP downloads use `ctx.http` with a stream response, timeout, and `AbortSignal`.
- Every streamed chunk is counted before retention.
- A response exceeding five MiB is aborted immediately.
- Timeout aborts the underlying request rather than only abandoning its promise.
- `data:` input is bounded during decoding and after decoding.

Successful per-image downloads become bounded candidates. Candidates are admitted to the ten-MiB message budget in original document order, independent of network completion order. Only admitted candidates are written through `ImagePrepareSink.put()`.

`AssetStore.put()` accepts only bytes whose signatures identify JPEG, PNG, WebP, or GIF. Unknown bytes, SVG, and MIME-spoofed content are rejected. Returned MIME always comes from verified bytes.

Asset storage remains content-addressed and channel-local. Only core can read or clear assets. Reset clears the same channel asset scope used during preparation and projection.

## 9. OneBot Forward Sanitization

The forward tool keeps a local sanitizer because core element utilities are private and the tool must not depend on core storage or preparation internals.

Forward payloads enter as `unknown`. Runtime guards distinguish:

- raw text or CQ string content
- structured OneBot segment arrays
- unsupported shapes

Text segments contribute their text. Image, file, video, and record segments become fixed text placeholders. Unknown segments are discarded. Objects are never converted with implicit `String(object)`.

The final text path removes external URLs, strips unsupported CQ syntax, and enforces:

- 1,000 characters per record
- 6,000 characters per page
- default limit 10
- maximum limit 20

Output contains no child message ID, raw OneBot field, external URL, media bytes, or asset ID.

## 10. Module And Export Layout

```text
core/src/platform/
  types.ts
  config.ts
  assets.ts
  message.ts
  service.ts
  index.ts
  utils/
    elements.ts
```

Rules:

1. A helper used by one module remains private to that module.
2. A helper used by multiple platform modules may move to `platform/utils/`.
3. Nothing under `platform/utils/` is exported from `platform/index.ts`.
4. `assets.ts` is a core implementation module, not an adapter API.
5. The public subpath exports only the platform namespace and adapter contracts, `PlatformService`, and required configuration contracts.

The public README and OneBot README must describe only symbols and flows that exist after this repair. Removed Reader, MessageView, EventView, and resource-pipeline claims must not remain.

## 11. Verification Design

The corrective plan uses risk-first vertical slices. Each slice starts with a failing regression or type test and ends with the narrowest command proving that slice.

Required coverage:

### Public contracts

- Koishi `Element` is accepted directly.
- Invalid pseudo-elements and non-channel `Platform.MessageRecord.scope` fail type checking.
- `Platform.MessageRecord` is bound to the agent custom message data.
- `AssetStore` and the fixed budget constant cannot be imported from the public platform subpath.
- OneBot adapter code compiles without `as any`, string-indexed Context access, or `any[]`.

### Service and adapter behavior

- Real core `apply()` constructs a usable `ctx.yesimbot.platform` path.
- Adapter matching covers profile, adapter, platform, decline, conflict, and thrown predicates.
- The selected adapter is reused for preparation.
- `keep`, `ignore`, `message`, and `event` refine results have explicit tests.
- Messages do not reach event subscribers; refined and explicitly published events do.
- Repeated collection of one Session is idempotent while caches use weak references.

### FIFO and reset

- Two concurrent reply-eligible messages produce one `run()` and one busy `send(join)`.
- Busy is read after preparation and immediately before submission.
- A turn that ends during preparation causes the next message to start a new run.
- Stream consumption does not hold the channel FIFO.
- Reset waits for earlier preparation and submission.
- A later message waits behind reset.
- Reset performs interrupt, stop, message clear, asset clear, and cache deletion in order.
- Different channels remain concurrent.

### Images and assets

- Nested images are prepared and projected in document order.
- A fifth image does not start a request.
- At most two requests are active.
- Streamed and decoded bytes are capped independent of declared length.
- Timeout and size failure abort the request.
- Concurrent completion cannot exceed the ten-MiB accepted total.
- SVG, unknown bytes, and MIME spoofing are rejected.
- Reset removes channel assets.

### OneBot forward tool

- Raw strings and structured segment arrays normalize to useful text.
- Media segments become fixed placeholders.
- Empty raw text can fall back to structured content.
- URLs, raw fields, child IDs, and asset IDs are absent.
- Record, page, offset, limit, and `hasMore` boundaries are enforced.

### Documentation and full pipeline

- Public export smoke tests agree with both READMEs.
- Focused package tests and type checks pass before the full repository pipeline.
- `review-fix-verify.md` records exact commands and results only after they run successfully.
- The historical `verify.md` is not cited as evidence for the repair.

## 12. Implementation Order

The implementation plan must use these vertical slices:

1. Normative spec and public type corrections.
2. Service construction, refine semantics, event-only publication, weak Session state, and one matcher.
3. FIFO busy routing and reset regressions.
4. Recursive streamed image preparation and private asset boundary.
5. Structured OneBot forward sanitization and public documentation.
6. Export checks, focused verification, full pipeline, and `review-fix-verify.md`.

Each slice must remain narrowly scoped and avoid unrelated formatting or architecture changes.
