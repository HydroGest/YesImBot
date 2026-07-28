# Simplify Ingress Records and Reply Segmentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Gateway the sole assembler of closed persisted ingress records, preserve declaration-merged event variants, and replace the four-control reply protocol with `inner_thought` and `sep` parsing plus host-owned pacing and delivery.

**Architecture:** Platform resolvers interpret a live Session into a small draft only. Gateway normalizes that draft through an explicit host whitelist into immutable `MessageRecord` or `EventRecord` values before persistence and runtime routing. Reply handling is reduced to three seams: `core/src/reply/parse.ts` creates a transport-free `ReplyPlan`, `core/src/reply/pacing.ts` owns host timing, and Gateway performs ordered delivery.

**Tech Stack:** TypeScript, Koishi/Satori (`Session`, `Universal`, `h` element helpers), Vitest, Yarn 4, Turborepo.

## Global Constraints

- Implement the ingress sequence exactly: `Platform Session/Event -> Resolver Draft -> Gateway normalize + whitelist -> Persisted Record -> Runtime Input`.
- A resolver MUST return `ResolvedMessageDraft`, `ResolvedEventDraft`, or `null`; it MUST NOT return a final persisted `MessageRecord` or `EventRecord`.
- Gateway is the only layer that constructs durable ingress envelopes and admits their host-base fields. Never spread `session.event`, a Session, or a resolver object into a persisted record.
- Keep `EventMap` and declaration merging. Close the host shell with `EventBase` and `EventRecord<K> = Readonly<EventBase & { eventType: K } & EventMap[K]>`.
- Remove `ResolveContext.base`; do not replace it with another near-record object.
- `MessageRecord` and `EventBase` MUST NOT inherit from `Universal.Event`. Continue using Satori-shaped `Universal.Channel` and `Universal.User` only where the explicit host contract names them.
- Persist ordinary inputs as `yesimbot.message` and non-message inputs as `yesimbot.event`; do not introduce a wrapper payload, nested `message`, payload `content`, or payload `type` discriminator.
- Preserve non-message model projection as only `eventType` plus `text` inside the existing untrusted runtime-event wrapper.
- The reply parser recognizes exactly `<inner_thought>...</inner_thought>` and `<sep/>`. Remove `skip`, `sleep`, `mergeExcessSegments`, parser-owned segment indexes/totals, `segmentLengths`, `controlAdopted`, and parser-owned transport/observability metadata.
- Keep raw assistant output, including inner thought, unchanged in JSONL/model history. Never deliver inner-thought text or recognized control elements to a reader.
- The model owns explicit split positions. The host may normalize, bound, truncate, or degrade, but MUST NOT create unmarked splits or merge marked segments.
- Delete `core/src/reply/observability.ts`; do not replace it with a speculative diagnostics layer.
- This is a breaking refactor. Do not add compatibility branches, migration readers, aliases, or dual payload shapes.
- Use `yarn` through `rtk`; use the focused `koishi-plugin-yesimbot` test/typecheck/build commands before broader validation.

---

## File Structure and Responsibilities

| Path | Responsibility after this change |
| --- | --- |
| `core/src/event/index.ts` | Owns closed `MessageRecord`, `EventBase`, `EventRecord`, resolver draft types, input constructors, and input type guards. |
| `core/src/gateway/index.ts` | Owns Session admission, one resolver invocation, draft normalization, explicit field whitelisting, fallback record assembly, RuntimeManager routing, and ordered final delivery. |
| `core/src/platforms/onebot/index.ts` | Registers OneBot resolver behavior and emits drafts only. |
| `core/src/platforms/onebot/events.ts` | Declaration-merges OneBot event variants and maps raw OneBot facts into flat variant fields. |
| `core/src/event/formatter.ts` | Projects runtime event input to the model as only `eventType` and `text`. |
| `core/src/reply/parse.ts` | Parses complete assistant output into a small, sanitized `ReplyPlan`; has no transport or observability responsibilities. |
| `core/src/reply/pacing.ts` | Applies host-owned delivery timing to already prepared visible segments without parser-owned sleep hints. |
| `core/src/reply/observability.ts` | Deleted; no remaining runtime consumer may import it. |
| `core/src/runtime/index.ts` | Retains raw output in history and consumes only `ReplyPlan.segments`; it carries no model-authored skip/sleep semantics. |

### Target Interfaces

```ts
type ResolvedMessageDraft = {
  kind: "message"
  messageId: string
  elements: readonly Element[]
  text?: string
  user?: { id?: string; name?: string }
  channel?: { name?: string }
}

type ResolvedEventDraft<K extends keyof EventMap = keyof EventMap> = {
  kind: "event"
  eventType: K
  text: string
} & EventMap[K]

type ResolveContext = {
  session: Session
  freezeImage: (
    element: Element,
    load: (signal: AbortSignal, maxBytes: number) => Promise<{
      data: Uint8Array
      mime?: string
    }>,
  ) => Promise<Element>
}

interface EventBase {
  schemaVersion: 2
  platform: string
  selfId: string
  channel: Universal.Channel
  timestamp: number
  eventType: string
  text: string
}

type EventRecord<K extends keyof EventMap = keyof EventMap> = Readonly<
  EventBase & { eventType: K } & EventMap[K]
>

type MessageRecord = Readonly<{
  schemaVersion: 2
  platform: string
  selfId: string
  timestamp: number
  channel: Universal.Channel
  user: Universal.User
  messageId: string
  elements: readonly Element[]
  text: string
}>

type ReplyPlan = {
  innerThought?: string
  segments: readonly { text: string }[]
  degraded?: "parse_failed" | "segment_limit_exceeded" | "residual_control_element"
}

interface PacingInput {
  segment: { text: string }
  isFirst: boolean
  config: PacingConfig
  elapsedGenerationMs: number
  consumedDeliveryMs: number
  random: () => number
}
```

### Task 1: Close the Event Module's Persisted Ingress Contracts

**Files:**
- Modify: `core/src/event/index.ts`
- Modify: `core/src/event/formatter.ts`
- Modify: `core/tests/event.test.ts`
- Modify: `core/tests/formatter.test.ts`

**Interfaces:**
- Consumes: The existing `EventMap` declaration-merge seam, custom Agent message constructors, and current input type guards.
- Produces: `MessageRecord`, `EventBase`, `EventRecord<K>`, `ResolvedMessageDraft`, `ResolvedEventDraft<K>`, and `ResolveContext` without `base`.
- Produces: `createMessage()`, `createEvent()`, and `createInput()` accepting only the closed host records; their output custom types remain `yesimbot.message` and `yesimbot.event`.
- Invariant: No type in the persisted host envelope extends, intersects with, or copies arbitrary fields from `Universal.Event`.

- [ ] **Step 1: Add failing closed-envelope and declaration-merge tests**

  In `core/tests/event.test.ts`, add a declaration-merged test-only `EventMap` variant and construct it through `createEvent()`. Assert that its payload contains the event-base fields, `eventType`, and the declared flat variant field. Add compile-time assertions (for example `expectTypeOf`) that `MessageRecord` has `messageId`, `elements`, and `text`, while inherited residue such as `guild` and `member` is not available. Assert the analogous closed base for `EventRecord`.

  In `core/tests/formatter.test.ts`, add an event with extra declaration-merged variant fields and assert the formatter output contains the event's `eventType` and `text`, but not the extra variant fields.

- [ ] **Step 2: Run the contract tests and record the expected initial failure**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/event.test.ts tests/formatter.test.ts`

  Expected: FAIL because the existing event/message payload types derive from `Universal.Event` or because current tests and constructors expose the old shape.

- [ ] **Step 3: Define the closed host-owned type family**

  In `core/src/event/index.ts`, replace the `MessageData extends Omit<Universal.Event, ...>` family with the exact `MessageRecord` shape above. Define `EventBase` with only `schemaVersion`, `platform`, `selfId`, `channel`, `timestamp`, `eventType`, and `text`; define `EventRecord<K>` as the read-only intersection of that base, `{ eventType: K }`, and `EventMap[K]`. Preserve the existing `EventMap` declaration-merge export.

  Define `ResolvedMessageDraft` and `ResolvedEventDraft<K>` alongside the resolver contract. Remove `base` from `ResolveContext` so the only resolver inputs are `session` and `freezeImage`.

- [ ] **Step 4: Make constructors and guards accept the closed records**

  Update `createMessage()`, `createEvent()`, `createInput()`, and all message/event type guards in `core/src/event/index.ts` so their payload types are the new records. Preserve timestamp placement on the Agent custom message, preserve `elements` as the sole structured ordinary-message field, and do not add nested discriminators.

- [ ] **Step 5: Keep model event projection deliberately narrow**

  In `core/src/event/formatter.ts`, retain the current untrusted runtime-event wrapper but project exactly `eventType` and frozen `text`. Do not serialize `EventBase.channel`, `selfId`, platform facts, or declaration-merged variant data into the model-facing notification.

- [ ] **Step 6: Run the focused contract tests and Core typecheck**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/event.test.ts tests/formatter.test.ts`

  Expected: PASS.

  Run: `rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot`

  Expected: PASS with no errors caused by the removed inherited fields or `ResolveContext.base`.

- [ ] **Step 7: Commit the self-contained type-boundary change**

  Run: `rtk git add core/src/event/index.ts core/src/event/formatter.ts core/tests/event.test.ts core/tests/formatter.test.ts`

  Run: `rtk git commit -m "refactor: close ingress record contracts"`

### Task 2: Make Gateway Normalize Every Draft and Fallback Record

**Files:**
- Modify: `core/src/gateway/index.ts`
- Modify: `core/tests/gateway.test.ts`
- Modify: `core/tests/gateway-delivery.test.ts`

**Interfaces:**
- Consumes: Task 1's closed records and `ResolveContext` without `base`.
- Produces: Private Gateway normalization helpers that map a `ResolvedMessageDraft` to `MessageRecord` and a `ResolvedEventDraft<K>` to `EventRecord<K>`.
- Produces: A Satori fallback that creates `MessageRecord` directly from explicitly selected Session fields.
- Invariant: Gateway invokes the selected resolver exactly once; a `null` result causes no persistence, RuntimeManager route, or Event broadcast.
- Invariant: `_data`, `_type`, `sn`, `login`, `referrer`, `guild`, `member`, `argv`, `friend`, `operator`, `emoji`, `role`, and `button` cannot enter either persisted route unless a named host/variant field maps an equivalent fact.

- [ ] **Step 1: Add failing resolver-draft normalization tests**

  In `core/tests/gateway.test.ts`, change resolver fixtures so they return a `ResolvedMessageDraft` and a `ResolvedEventDraft`. Spy on the RuntimeManager entry point and assert it receives a final record containing every required host field, including the Gateway-derived `schemaVersion`, `platform`, `selfId`, `timestamp`, and normalized `channel`.

  Add a `null` resolver case that proves neither persistence/routing nor Event broadcast occurs. Assert the resolver is called once with only a live Session and `freezeImage`, not a `base` object.

- [ ] **Step 2: Add failing residue-exclusion tests for both ingress routes**

  Add a fallback Session fixture with all forbidden fields named in the task invariant. Persist/observe the produced `yesimbot.message` and assert none of those keys exist in the payload.

  Add a resolver-backed event fixture with the same Session residue and a declared variant field (for example `targetId`). Assert the persisted `yesimbot.event` contains `targetId`, but none of the forbidden raw keys.

- [ ] **Step 3: Run the Gateway tests to establish the red state**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/gateway.test.ts tests/gateway-delivery.test.ts`

  Expected: FAIL because the old resolver contract expects `ResolveContext.base` and/or record assembly still retains Session-derived residue.

- [ ] **Step 4: Implement explicit Gateway draft normalization**

  In `core/src/gateway/index.ts`, add private, focused normalization helpers. The message helper must take Gateway-derived scope/timestamp values plus a `ResolvedMessageDraft`, create the exact `MessageRecord` fields, freeze/retain `elements`, and ensure `text` is frozen before routing. The event helper must take the same Gateway-derived base values plus `ResolvedEventDraft<K>`, retain only the explicit `eventType`, `text`, and declaration-merged variant fields, and construct the `EventRecord<K>` base itself.

  Do not treat a draft as structurally assignable to a final record. Do not pass a mutable Session resource object through unchanged when the host contract needs its normalized Satori counterpart.

- [ ] **Step 5: Replace fallback spread assembly with a field whitelist**

  In the no-resolver standard-message path, require a routable scope, `elements` array, and non-empty platform message ID. Capture source elements before transformations, derive text once, and construct the record with literal host fields only: `schemaVersion`, `platform`, `selfId`, `timestamp`, `channel`, `user`, `messageId`, `elements`, and `text`.

  Remove every `...session.event`, `...resources`, or equivalent broad spread used to create a persisted message. Keep no-resolver non-message handling as an immediate return.

- [ ] **Step 6: Route only normalized records into the existing runtime flow**

  Make the resolver path invoke the normalization helper after its one resolver call, then pass only the resulting `MessageRecord` or `EventRecord` to the existing `RuntimeManager`. Preserve current admission, image-freezing, and Session-lifetime rules; do not add refine, prepare, or model-projector stages.

- [ ] **Step 7: Run focused ingress verification**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/gateway.test.ts tests/gateway-delivery.test.ts`

  Expected: PASS, including the negative payload-key assertions.

  Run: `rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot`

  Expected: PASS with all resolver call sites now using drafts.

- [ ] **Step 8: Commit the Gateway ownership slice**

  Run: `rtk git add core/src/gateway/index.ts core/tests/gateway.test.ts core/tests/gateway-delivery.test.ts`

  Run: `rtk git commit -m "refactor: normalize ingress records in gateway"`

### Task 3: Convert OneBot and Runtime Consumers to the New Boundary

**Files:**
- Modify: `core/src/platforms/onebot/index.ts`
- Modify: `core/src/platforms/onebot/events.ts`
- Modify: `core/tests/platform/onebot.test.ts`
- Modify: `core/tests/channel-runtime.test.ts`
- Modify: `core/tests/storage.test.ts`

**Interfaces:**
- Consumes: Task 1 resolver draft types and Task 2 Gateway normalization.
- Produces: OneBot resolver outputs that are `ResolvedMessageDraft`, `ResolvedEventDraft<K>`, or `null`; never final records.
- Produces: Declaration-merged flat OneBot variants whose fields contain only explicitly mapped platform facts (such as a poke target or reaction list).
- Invariant: JSONL/custom-message consumers assert host payload fields rather than inherited `Universal.Event` resources.

- [ ] **Step 1: Add red tests for draft-only OneBot resolver output**

  In `core/tests/platform/onebot.test.ts`, test the poke and `message-reactions-updated` resolver paths. Assert the returned object has `kind: "event"`, the correct `eventType`, frozen `text`, and the explicit flat variant fields. Assert it does not have `schemaVersion`, `platform`, `selfId`, `timestamp`, or a final host `channel` envelope; those belong to Gateway.

  Add an ordinary-message resolver test that asserts a message result has only the `ResolvedMessageDraft` fields and no copied OneBot runtime residue.

- [ ] **Step 2: Add red persistence-consumer tests**

  In `core/tests/channel-runtime.test.ts` and `core/tests/storage.test.ts`, commit one ordinary message and one declaration-merged event through the normal runtime path. Assert the custom types are `yesimbot.message` and `yesimbot.event`; assert payloads have the exact host contracts and that JSONL retains the selected fields without `guild`, `member`, `login`, or `_data`.

- [ ] **Step 3: Run the platform and persistence tests to establish failures**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform/onebot.test.ts`

  Expected: FAIL while OneBot still returns final envelope fields or accepts `ResolveContext.base`.

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel-runtime.test.ts tests/storage.test.ts`

  Expected: FAIL while the persisted assertions still observe legacy envelope fields.

- [ ] **Step 4: Rewrite OneBot resolver outputs as small drafts**

  In `core/src/platforms/onebot/index.ts`, remove all dependence on `ResolveContext.base` and return either `null`, `ResolvedMessageDraft`, or `ResolvedEventDraft`. Supply platform interpretation only: message ID, source elements, optional text/user/channel display information for messages; event type, frozen text, and declared flat variant fields for events.

  In `core/src/platforms/onebot/events.ts`, preserve declaration merging but map raw payload facts explicitly. For example, map poke target data into the named poke variant field and reaction payload data into the named reaction-list field. Do not forward raw event objects or inherit `Universal.Event` fields.

- [ ] **Step 5: Update runtime/storage fixtures to assert durable contracts**

  Update the Task 3 Core tests so fixtures enter via Gateway-normalized records. Replace assertions for implementation residue with assertions for `schemaVersion: 2`, scope-derived host fields, `messageId`/`elements`/`text` for messages, and `eventType`/`text` plus declared fields for events.

- [ ] **Step 6: Run focused consumer verification and typechecks**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform/onebot.test.ts`

  Expected: PASS.

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel-runtime.test.ts tests/storage.test.ts`

  Expected: PASS.

  Run: `rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot`

  Expected: PASS.

- [ ] **Step 7: Commit platform and consumer migration together**

  Run: `rtk git add core/src/platforms/onebot/index.ts core/src/platforms/onebot/events.ts core/tests/platform/onebot.test.ts core/tests/channel-runtime.test.ts core/tests/storage.test.ts`

  Run: `rtk git commit -m "refactor: emit onebot ingress drafts"`

### Task 4: Replace OCL with a Small Reply Parser and Pacing Module

**Files:**
- Create: `core/src/reply/parse.ts`
- Modify: `core/src/reply/pacing.ts`
- Delete: `core/src/reply/ocl.ts`
- Delete: `core/src/reply/observability.ts`
- Modify: `core/tests/ocl.test.ts`
- Modify: `core/tests/pacing.test.ts`
- Delete: `core/tests/observability.test.ts`

**Interfaces:**
- Consumes: Complete raw assistant output and the existing maximum-segment configuration.
- Produces: `parseReply(raw: string, maxSegments: number): ReplyPlan` from `core/src/reply/parse.ts`.
- Produces: A pacing function in `core/src/reply/pacing.ts` that accepts one already-sanitized visible segment plus host delivery state and performs no parsing or model-authored timing interpretation.
- Produces: `nextSegmentDelayMs(input: PacingInput): number` in `core/src/reply/pacing.ts`; `isFirst` is host-owned delivery state and `segment` contains only visible text.
- Invariant: `ReplyPlan` contains only optional `innerThought`, `segments: readonly { text: string }[]`, and optional `degraded`; it has no `skip`, `sleepHintMs`, index/total, lengths, `controlAdopted`, or observability aggregate.

- [ ] **Step 1: Replace old OCL expectations with grammar tests**

  In `core/tests/ocl.test.ts`, remove all `skip`, `sleep`, and merge-overflow expectations. Keep only legacy coverage that maps directly to `inner_thought`, `<sep/>`, escaped control entities, normalization, and safe degradation; move it to the new parser import when the old module is removed.

  In `core/tests/ocl.test.ts`, replace the old parser cases with these exact cases:

  ```ts
  expect(parseReply("hello", 8)).toEqual({
    segments: [{ text: "hello" }],
  })

  expect(parseReply("one<sep/>two<sep/>three", 8).segments).toEqual([
    { text: "one" },
    { text: "two" },
    { text: "three" },
  ])

  expect(parseReply("<inner_thought>private</inner_thought>visible", 8)).toMatchObject({
    innerThought: "private",
    segments: [{ text: "visible" }],
  })

  expect(parseReply("&lt;sep/&gt;", 8).segments).toEqual([
    { text: "<sep/>" }],
  ])
  ```

  Add assertions that leading/trailing/consecutive `<sep/>` produce no empty segments; unrecognized elements remain visible; over-limit input either truncates without merging or returns one sanitized segment with `degraded: "segment_limit_exceeded"`; parser errors and residual recognized elements become exactly one sanitized segment with the applicable degradation reason.

- [ ] **Step 2: Add an isolated pacing ownership test**

  In `core/tests/pacing.test.ts`, construct the existing `nextSegmentDelayMs()` input with `{ segment: { text }, isFirst }` and deterministic `random()`. Assert the delay remains determined by host `PacingConfig`, `isFirst`, generation elapsed time, and consumed delivery time. Assert its segment has no `sleepHintMs` and that literal `<sleep/>` text neither changes timing nor receives parser treatment.

- [ ] **Step 3: Run parser and pacing tests to establish the red state**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/ocl.test.ts tests/pacing.test.ts`

  Expected: FAIL because the old OCL parser exposes removed control semantics and no separate parser/pacing seams exist.

- [ ] **Step 4: Implement the transport-free parser**

  Create `core/src/reply/parse.ts` with exported `ReplyPlan` and `parseReply()`. Follow this exact order: protect required literal text; extract all `inner_thought` regions; split visible content on `<sep/>`; trim and discard empty segments; apply the maximum-segment guardrail without merging; assert no recognized control element survives. Use Koishi `h.parse()`, `h.select()`, and/or `h.transform()` where they make element-aware recognition and escaping clearer than ad-hoc regex.

  On parsing, validation, or residual-control failure, return one complete sanitized visible message and the relevant `degraded` value. Never return an empty plan by dropping a reply. Preserve escaped `&lt;sep/&gt;` and `&lt;inner_thought&gt;` as literal visible text after unescaping.

- [ ] **Step 5: Create a narrow host-owned pacing seam**

  In `core/src/reply/pacing.ts`, simplify the existing `nextSegmentDelayMs()` seam to the exact `PacingInput` shape above. Retain typing-delay, configured limits, `isFirst`, elapsed-generation, consumed-delivery, and deterministic-random behavior; remove `ReplySegment` imports, `index`, `total`, and `sleepHintMs` usage. Never accept raw model output, `ReplyPlan.innerThought`, parser diagnostics, or a model-authored sleep value.

  Update `core/src/runtime/index.ts` and `core/tests/ocl.test.ts` from `./ocl.js`/`../src/reply/ocl.js` to the new `parse.js` module, and update `core/src/reply/pacing.ts` plus `core/tests/pacing.test.ts` to use the text-only segment type. Do not add a barrel export or compatibility alias.

- [ ] **Step 6: Delete obsolete reply machinery**

  Delete `core/src/reply/ocl.ts`, `core/src/reply/observability.ts`, and `core/tests/observability.test.ts`. Remove `skip`, `sleep`, `mergeExcessSegments`, parser segment index/total, `segmentLengths`, and `controlAdopted` from their imports and consumers. Do not move their behavior into a new module.

- [ ] **Step 7: Run focused parser/pacing verification and typecheck**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/ocl.test.ts tests/pacing.test.ts`

  Expected: PASS; no test should import `observability.ts` or assert skip/sleep behavior.

  Run: `rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot`

  Expected: PASS with no stale OCL or observability import.

- [ ] **Step 8: Commit the reply-module split**

  Run: `rtk git add core/src/reply/parse.ts core/src/reply/pacing.ts core/tests/ocl.test.ts core/tests/pacing.test.ts`

  Run: `rtk git rm core/src/reply/ocl.ts core/src/reply/observability.ts core/tests/observability.test.ts`

  Run: `rtk git commit -m "refactor: reduce reply control parsing"`

### Task 5: Integrate ReplyPlan with Runtime History and Gateway Delivery

**Files:**
- Modify: `core/src/runtime/index.ts`
- Modify: `core/src/gateway/index.ts`
- Modify: `core/src/runtime/prompts/constitution.ts`
- Modify: `core/tests/channel-runtime.test.ts`
- Modify: `core/tests/gateway-delivery.test.ts`

**Interfaces:**
- Consumes: Task 4's `ReplyPlan`, parser, and pacing seam.
- Produces: Runtime output handling that stores raw assistant output unchanged, parses it once for delivery, and forwards only plan segments to Gateway delivery/pacing.
- Produces: Gateway delivery that delivers parsed segments in order and retains existing passive `Session.send()`/delivery-failure behavior.
- Invariant: Prompt instructions mention only `<inner_thought>` and `<sep/>`; no persona/runtime prompt tells the model to emit `<skip/>` or `<sleep/>`.

- [ ] **Step 1: Add failing raw-history and delivery-segmentation tests**

  In `core/tests/channel-runtime.test.ts`, produce an assistant output such as `<inner_thought>private reasoning</inner_thought>first<sep/>second`. Assert JSONL/raw agent history contains the exact original string, while the delivery plan exposed to the delivery lane contains only `{ text: "first" }` and `{ text: "second" }`.

  Add a no-control case asserting one delivered message with current single-message content. Add a long no-separator case asserting it remains one message; do not assert punctuation- or length-based splitting.

- [ ] **Step 2: Add failing Gateway delivery ownership tests**

  In `core/tests/gateway-delivery.test.ts`, assert a two-segment `ReplyPlan` is delivered in order through the existing live Gateway Session handle. Assert no delivery contains `inner_thought`, `<sep/>`, or a recognized residual control tag. Assert delivery timing comes from host pacing and never from an output `<sleep/>` tag.

- [ ] **Step 3: Run the runtime/delivery tests to establish the red state**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel-runtime.test.ts tests/gateway-delivery.test.ts`

  Expected: FAIL because the existing runtime consumes old OCL metadata or applies removed skip/sleep behavior.

- [ ] **Step 4: Wire raw-history preservation and ReplyPlan consumption**

  In `core/src/runtime/index.ts`, keep appending the exact raw assistant output to the existing JSONL/Agent history path before any delivery-only transformation. Replace old OCL result usage with `parseReply(rawOutput, configuredMaximum)`. Pass only `ReplyPlan.segments` and permitted host delivery context to the delivery lane; discard `innerThought` from reader delivery and do not derive transport metadata from it.

- [ ] **Step 5: Make Gateway own final ordered delivery through pacing**

  In `core/src/gateway/index.ts`, integrate the Task 4 pacing function at the existing delivery seam. Maintain ordered passive sends, delivery leases, and same-channel `delivery.failed` feedback. Gateway must not reparse raw assistant output, reinterpret control tags, or receive parser-owned indexes/totals.

- [ ] **Step 6: Update the runtime prompt grammar**

  In `core/src/runtime/prompts/constitution.ts`, remove instructions/examples for `<skip/>` and `<sleep/>`. State that `<inner_thought>...</inner_thought>` is private and `<sep/>` marks visible segment boundaries; do not promise a preferred segment count or host timing behavior.

- [ ] **Step 7: Run the integrated reply regression tests and typecheck**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel-runtime.test.ts tests/gateway-delivery.test.ts tests/ocl.test.ts tests/pacing.test.ts`

  Expected: PASS, including raw-history retention and no control leakage.

  Run: `rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot`

  Expected: PASS.

- [ ] **Step 8: Commit runtime and delivery integration**

  Run: `rtk git add core/src/runtime/index.ts core/src/gateway/index.ts core/src/runtime/prompts/constitution.ts core/tests/channel-runtime.test.ts core/tests/gateway-delivery.test.ts`

  Run: `rtk git commit -m "refactor: deliver reply plans through gateway"`

### Task 6: Perform Contract-Level Regression and Release Verification

**Files:**
- Modify: `core/tests/event.test.ts`
- Modify: `core/tests/gateway.test.ts`
- Modify: `core/tests/storage.test.ts`
- Verify: all files changed by Tasks 1-5

**Interfaces:**
- Consumes: Completed closed ingress contracts, Gateway normalization, OneBot drafts, reply parser/pacing, runtime history, and Gateway delivery.
- Produces: Regression evidence that each required persisted and reader-visible boundary is enforced end-to-end.
- Invariant: Tests assert durable and externally visible behavior rather than deleted parser internals or inherited platform runtime fields.

- [ ] **Step 1: Add the final cross-boundary regression matrix**

  Add or consolidate tests so the suite explicitly covers all of these outcomes:

  ```text
  fallback message with session residue -> closed yesimbot.message payload
  resolver message draft -> Gateway-assembled MessageRecord
  resolver event draft + declaration merge -> EventBase + flat variant payload
  resolver null -> no persistence, routing, or event broadcast
  non-message model projection -> eventType + text only
  inner_thought + sep -> raw JSONL unchanged, private text withheld, ordered visible sends
  escaped control text -> literal visible text
  excess/failing/residual parsing -> one safe sanitized delivery or bounded non-merged output
  ```

- [ ] **Step 2: Run the narrow Core regression suite**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/event.test.ts tests/formatter.test.ts tests/gateway.test.ts tests/channel-runtime.test.ts tests/gateway-delivery.test.ts tests/storage.test.ts tests/ocl.test.ts tests/pacing.test.ts`

  Expected: PASS.

- [ ] **Step 3: Run the OneBot regression suite**

  Run: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform/onebot.test.ts`

  Expected: PASS.

- [ ] **Step 4: Run package-level typecheck, build, and test verification**

  Run: `rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot`

  Expected: PASS.

  Run: `rtk yarn turbo run build --filter=koishi-plugin-yesimbot`

  Expected: PASS.

  Run: `rtk yarn turbo run test --filter=koishi-plugin-yesimbot`

  Expected: PASS.

- [ ] **Step 5: Inspect changed interfaces before the final commit**

  Run: `rtk git diff --check`

  Expected: PASS with no whitespace errors.

  Run: `rtk git diff -- core/src/event core/src/gateway core/src/reply core/src/runtime core/src/platforms/onebot`

  Expected: The diff shows no `ResolveContext.base`, no `Universal.Event` host-envelope inheritance, no reply `skip`/`sleep`/`mergeExcessSegments`, and no `core/src/reply/observability.ts` import.

- [ ] **Step 6: Commit final regression coverage**

  Run: `rtk git add core/tests/event.test.ts core/tests/gateway.test.ts core/tests/storage.test.ts`

  Run: `rtk git commit -m "test: lock ingress and reply boundaries"`

## Self-Review

- [x] **Spec coverage:** Tasks 1-3 implement the closed message/event host bases, Gateway-only field admission, Satori fallback, resolver drafts, forbidden-residue exclusion, declaration merging, persisted custom types, and minimal event model projection. Tasks 4-5 implement the two-control grammar, literal escaping, fixed parsing order, private thought handling, model-owned segmentation, no merging, guardrails, no control leakage, parser/pacing/Gateway seams, and observability deletion.
- [x] **No placeholders:** Every task names exact paths, contracts, test scenarios, commands, expected outcomes, and a commit command. There are no deferred or unspecified implementation/test steps.
- [x] **Type consistency:** Resolver drafts are consumed by Gateway; Gateway produces `MessageRecord`/`EventRecord`; the parser produces `ReplyPlan`; runtime consumes raw output plus `ReplyPlan.segments`; Gateway pacing/delivery consumes sanitized segments only.
- [x] **Scope check:** The plan changes only the approved ingress-record and reply-segmentation boundaries. It does not redesign `@yesimbot/agent-runtime`, add compatibility layers, or create a new event registry.
