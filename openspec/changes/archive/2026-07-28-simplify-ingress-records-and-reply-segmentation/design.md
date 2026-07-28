## Context

Core ingress currently mixes two concerns that should be separated: variant
extensibility and host-owned record boundaries. `EventMap` is a useful extension
surface because platform adapters can declaration-merge additional event
variants, but the current host record shapes are still derived from
`Universal.Event`. That inheritance leaks platform runtime structure into
persisted records, makes fallback message assembly depend on `session.event`
residue, and leaves the Gateway without a crisp answer to which fields it owns.

Reply segmentation has a parallel boundary problem. The current OCL layer grew to
cover four control elements, protection-zone machinery, pacing hints,
skip-after-generation behavior, merge-based guardrails, and parser-adjacent
observability concerns. The approved product direction only wants to keep private
deliberation and explicit segment boundaries. The host already owns delivery
timing, and the project no longer wants `skip` or `sleep` as model-authored
protocol semantics.

The change therefore needs to reduce both surfaces without deleting the seams the
project still values: declaration-merged event variants on ingress and
inner-thought support in reply parsing.

### Current-to-Target Ingress Flow

The approved ingress boundary is:

```text
Platform Session/Event
  -> Resolver Draft
  -> Gateway normalize + whitelist
  -> Persisted Record
  -> Runtime Input
```

This is not just a sequencing preference. It is the ownership contract:

- Resolver does platform interpretation.
- Gateway does host normalization and persistence whitelisting.
- Persisted records are the only runtime-facing ingress contract.

### Target Type And Interface Sketches

The implementation is free to refine field optionality, but the design fixes the
contract direction and ownership:

```ts
type ResolvedMessageDraft = {
  kind: "message"
  messageId: string
  elements: readonly Element[]
  text?: string
  user?: {
    id?: string
    name?: string
  }
  channel?: {
    name?: string
  }
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
    load: (signal: AbortSignal, maxBytes: number) => Promise<{ data: Uint8Array; mime?: string }>,
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
  segments: readonly {
    text: string
  }[]
  degraded?: "parse_failed" | "segment_limit_exceeded" | "residual_control_element"
}
```

These are design contracts, not copy-paste implementation requirements. The key
point is that final records are Gateway-owned and parser output is a delivery plan
rather than a transport-metadata bundle.

## Goals / Non-Goals

**Goals:**
- Replace `Universal.Event`-derived message and event envelopes with closed,
  host-owned base shapes.
- Keep `EventMap` plus declaration merge for event variant extensibility.
- Make Gateway the single field-admission authority for final persisted ingress
  records.
- Preserve non-message ingress while keeping its model projection minimal.
- Reduce reply control parsing to `inner_thought` and `sep` only.
- Remove `skip`, `sleep`, and merge-based reply rewriting.
- Remove parser-owned transport and observability metadata such as per-segment
  index/total planning output, `segmentLengths`, and `controlAdopted`.

**Non-Goals:**
- Preserve backward compatibility with current `yesimbot.message` or
  `yesimbot.event` payload shapes.
- Introduce a new wrapper payload layer around event variants.
- Replace declaration merge with a closed central event registry.
- Move reply control semantics into Koishi message components.
- Redesign `packages/agent-runtime` or unrelated runtime lifecycle behavior.

## Decisions

### D1: Keep `EventMap`, close the host event shell
- **Choice**: Preserve `EventMap` and declaration merge, but redefine
  `EventRecord<K>` as `EventBase & { eventType: K } & EventMap[K]` instead of
  inheriting from `Universal.Event`.
- **Rationale**: The project benefits from open event variants, but the host
  envelope must stay stable, reviewable, and free of platform runtime residue.
- **Alternatives considered**:
  - Closed `NoticeRecord` union only. Rejected because it removes a currently
    useful extension seam and forces all variants into a core-maintained list.
  - Keep the current `Universal.Event`-derived envelope. Rejected because it is
    the source of the current boundary confusion.

### D2: Replace inherited message typing with a closed `MessageRecord`
- **Choice**: Remove `MessageData extends Omit<Universal.Event, ...>` and define
  a closed host-owned `MessageRecord` with only the fields Core actually needs:
  schema version, platform, self ID, timestamp, channel, user, message ID,
  elements, and frozen text.
- **Rationale**: Persisted message records are not platform events. The closed
  shape makes leakage detectable and keeps downstream code honest about which
  fields it depends on.
- **Alternatives considered**:
  - Keep inheritance and tighten the gateway spread only. Rejected because the
    type-level boundary would still be wrong.

### D3: Remove `ResolveContext.base` and shrink resolver output
- **Choice**: Resolvers stop receiving a near-record `base`. They return a small
  resolver draft, and Gateway assembles the final `MessageRecord` or
  `EventRecord`.
- **Rationale**: Platform adapters should interpret platform Sessions; Gateway
  should own final field admission and persistence shape assembly.
- **Alternatives considered**:
  - Keep `base` for convenience. Rejected because it blurs ownership and invites
    further spread-based assembly.

### D3.1: Resolver drafts are not persisted records
- **Choice**: A resolver returns either `ResolvedMessageDraft`,
  `ResolvedEventDraft<K>`, or `null`; it never returns the final persisted record.
- **Rationale**: The draft boundary prevents platform adapters from accidentally
  deciding which fields become durable host contract.
- **Alternatives considered**:
  - Let resolvers keep returning final `MessageRecord | EventRecord`. Rejected
    because it preserves the current split-brain ownership between resolver and
    Gateway.

### D4: Keep non-message ingress, but keep model projection minimal
- **Choice**: Non-message ingress continues to flow through runtime and into the
  model, but formatter projection remains limited to `eventType` and `text`
  inside the current untrusted runtime-event wrapper.
- **Rationale**: This preserves current runtime behavior without letting event
  payload structure become part of the prompt protocol.
- **Alternatives considered**:
  - Stop projecting non-message ingress to the model. Rejected because current
    architecture already supports it and no stronger product reason justified
    removing it.
  - Project full event payload JSON. Rejected because it would widen prompt
    surface area and couple prompt behavior to event variant details.

### D5: Keep `inner_thought`, remove `skip` and `sleep`
- **Choice**: The reply control grammar keeps `inner_thought` and `sep`, but
  removes `skip` and `sleep`.
- **Rationale**: The user explicitly wants to retain private deliberation.
  `skip` and `sleep` no longer justify their own protocol semantics because the
  host already owns silence and delivery timing behavior through other paths.
- **Alternatives considered**:
  - Remove all control elements except `sep`. Rejected because it discards a
    now-approved private-deliberation seam.
  - Keep all four controls. Rejected because it preserves unnecessary protocol
    surface.

### D6: Reduce reply parsing from OCL to a smaller reply-control parser
- **Choice**: The new parser recognizes only `inner_thought` and `sep`, strips
  private deliberation before delivery, preserves raw output for history replay,
  produces a smaller `ReplyPlan`, and degrades to one sanitized message on parse
  failure.
- **Rationale**: The approved behavior no longer needs a full mini-language with
  pacing or skip semantics, so the implementation should stop carrying them.
- **Alternatives considered**:
  - Keep the current OCL module name and most machinery. Rejected because it
    keeps the old conceptual weight after most of the protocol is gone.

### D6.1: Reply parser output is a plan, not transport metadata
- **Choice**: The parser returns a `ReplyPlan` containing only stripped
  inner-thought text (if any), visible segment text, and optional degradation
  reason. It does not emit per-segment index/total, `sleepHintMs`,
  `segmentLengths`, or `controlAdopted`.
- **Rationale**: Parser responsibility is “text -> deliverable plan”. Transport
  metadata belongs in runtime or Gateway, and observability-derived aggregates
  belong in diagnostics if they survive at all.
- **Alternatives considered**:
  - Keep per-segment transport metadata in parser output. Rejected because it
    couples parsing to delivery and logging concerns.

### D7: Use Koishi element APIs as parser helpers, not as component runtime
- **Choice**: Use Koishi element parsing and transformation APIs where they make
  reply control parsing simpler, but do not model reply controls as registered
  components.
- **Rationale**: `h.parse()` / `h.select()` / `h.transform()` are useful for
  element-aware parsing. `ctx.component()` executes at render time and is the
  wrong seam for host-owned reply planning.
- **Alternatives considered**:
  - Continue hand-maintained regex parsing everywhere. Rejected because Koishi
    already provides better element parsing primitives.
  - Register custom components for reply control tags. Rejected because that
    moves protocol execution too late in the pipeline.

### D7.1: Keep module seams small and explicit
- **Choice**: The reply area should keep three seams only:
  - a smaller reply parser module (`reply/parse.ts` or `reply/plan.ts`)
  - a pacing module (`reply/pacing.ts`)
  - Gateway delivery
  The current `core/src/reply/observability.ts` should be deleted rather than
  retained as a speculative sidecar.
- **Rationale**: The project no longer needs a large reply protocol subsystem.
  Keeping only the seams with real runtime consumers raises locality and reduces
  maintenance cost.
- **Alternatives considered**:
  - Keep `observability.ts` and feed it reduced parser output. Rejected because
    no approved requirement currently justifies a dedicated observability module.

### D8: Remove merge-based guardrails
- **Choice**: Delete `mergeExcessSegments`. When guardrails trigger, the host may
  truncate at the configured maximum or degrade to one sanitized message, but it
  must not merge model-marked segments to satisfy a preferred structure.
- **Rationale**: Merging segments means the runtime rewrites the model's chosen
  segmentation. That conflicts with the approved direction that the host should
  validate and bound structure, not reshape it.
- **Alternatives considered**:
  - Keep merge-based overflow handling. Rejected because it preserves one of the
    current parser's most semantically invasive behaviors.

## Module Boundaries And File Plan

### Ingress Area

- `core/src/event/index.ts`
  - owns `MessageRecord`, `EventBase`, `EventRecord`, custom message constructors,
    and type guards
- `core/src/gateway/index.ts`
  - owns final record assembly and field whitelisting
- `core/src/platforms/*`
  - own platform interpretation and draft emission only

### Reply Area

- `core/src/reply/parse.ts` or `core/src/reply/plan.ts`
  - owns `ReplyPlan` creation from assistant text
- `core/src/reply/pacing.ts`
  - owns host delivery pacing policy only
- `core/src/gateway/index.ts`
  - owns actual ordered segment delivery

### Planned Deletions

- `ResolveContext.base`
- `MessageData extends Universal.Event`
- inherited `Universal.Event` event shell in `EventRecord`
- `mergeExcessSegments`
- parser-owned `innerThoughts` array
- parser-owned segment `index/total`
- parser-owned `segmentLengths`
- parser-owned `controlAdopted`
- `core/src/reply/observability.ts`
- ingress leakage of `_data`, `_type`, `sn`, `login`, `referrer`, `guild`,
  `member`, `argv`, `friend`, `operator`, `emoji`, `role`, and `button`

## Risks / Trade-offs

- **[Risk] Existing resolvers or tests may rely on inherited event resources**
  → Mitigation: update resolver outputs and tests together, and add negative
  assertions that forbidden fields no longer persist.

- **[Risk] Keeping `EventMap` may encourage oversized event variants**
  → Mitigation: keep `EventBase` minimal and require each variant to justify its
  own flat fields rather than inheriting from platform runtime types.

- **[Trade-off] Non-message ingress remains part of the runtime flow** → Accepted
  because the minimal `eventType + text` projection keeps prompt coupling low
  while preserving current behavior.

- **[Trade-off] `inner_thought` remains a special host behavior** → Accepted
  because the user explicitly wants to retain it even while shrinking the rest of
  the protocol.

- **[Trade-off] Reply parsing still needs element-aware sanitization** → Accepted
  because private-deliberation stripping and explicit segmentation still require a
  parser; the redesign only removes unnecessary control semantics.

- **[Risk] Deleting parser-owned metadata may break tests that implicitly depend
  on old internals** → Mitigation: rewrite tests to assert delivery behavior and
  persisted contracts, not parser transport internals.

## Migration Plan

1. Redefine host-owned message and event base types in `core/src/event`.
2. Refactor Gateway and resolver contracts so final record assembly happens in
   Gateway without `ResolveContext.base` or `session.event` residue spreading.
3. Update platform event resolvers to emit the new flat `EventRecord` shapes.
4. Rewrite reply parsing around `inner_thought` and `sep` only, deleting
   `skip`, `sleep`, and merge-based overflow handling.
5. Update formatter, runtime, and tests to match the new contracts.
6. Run targeted typecheck and runtime tests for gateway ingress, event
   formatting, platform event resolution, and reply segmentation.

Rollback strategy: because this is an approved breaking refactor, rollback is by
reverting the change set before release rather than by keeping runtime
compatibility branches.

## Open Questions

- Should the simplified reply parser keep the existing protection-zone strategy
  for literal `<sep/>` text inside code, URLs, and platform elements, or should
  it rely more directly on Koishi element parsing plus a smaller literal-text
  escape rule?
- Should the revised schema version for persisted ingress payloads increment for
  both message and event records together, or only for the affected variant(s)?
