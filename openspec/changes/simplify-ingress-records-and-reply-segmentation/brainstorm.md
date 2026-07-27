<!--
Raw capture of superpowers:brainstorming output.

本檔原樣捕捉 brainstorming skill 的產出，不強制結構。
Skill 的自然產出通常是 decision log 格式（背景 → 決議鏈 Q1-Qn → 設計取捨），
但依對話內容可能有不同組織方式。

design.md 從本檔萃取並重新整理為結構化設計文件。

不要將本檔的內容複製到 design.md — design.md 是獨立的重組產物，
兩者互補但不重疊。
-->

# Brainstorm: Simplify Ingress Records and Reply Segmentation

## Background

This exploration started from three connected concerns in Core:

1. Message ingress currently allows platform event residue to leak into persisted
   message records.
2. Internal event modeling mixes host-owned record structure with platform event
   structure.
3. Natural reply segmentation grew into a larger OCL protocol layer than the
   current product needs justify.

The initial code review confirmed two concrete problems.

- `core/src/gateway/index.ts` builds a fallback message base by destructuring
  `session.event` and spreading `...resources` back into the returned object.
  That makes the fallback path structurally open to fields such as `_data`,
  `guild`, `member`, `sn`, `login`, and `referrer`.
- `core/src/event/index.ts` models `MessageData` as an extension of
  `Omit<Universal.Event, ...>`, which ties a host-owned persisted message shape
  to Koishi/Satori runtime event structure.

The original design direction considered fully closing non-message ingress into a
small host-owned `NoticeRecord` union and deleting `EventMap`. After review, that
direction was revised.

## Repository Reality Check

- `core/src/event/formatter.ts` only needs `eventType` and `text` from
  non-message inputs when projecting them to the model.
- `core/src/runtime/index.ts` routes `InputRecord` through a single host path and
  emits `yesimbot/event` regardless of whether the record is a message or event.
- `core/src/platforms/onebot/events.ts` uses declaration merging to extend
  `EventMap` with `notice.poke` and `onebot.message-reactions-updated`.
- Search across the repo found very few runtime consumers of rich event payloads;
  most references are tests, plus `delivery.failed` handling and the OneBot
  resolver.

This means the current system does not really need a wide inherited event shell,
but it may still benefit from an open event-variant registry.

## Decision Chain

### Q1 — Should `EventMap` be deleted?

Initial answer: yes, because a closed `NoticeRecord` union would be simpler.

Revised answer after user feedback: **no**.

The user explicitly prefers to keep `EventMap` and declaration merge because not
every future non-message input fits a single "notice" concept, and declaration
merge is a legitimate extension seam here.

**Decision:** keep `EventMap` and declaration merge.

### Q2 — If `EventMap` stays, what actually needs to change?

The critical distinction is between:

1. **Whether event variants are open**
2. **Whether the host-owned event record shell is open**

These should not be conflated.

The current problem is not that event variants are extensible. The current
problem is that the host-owned envelope inherits from `Universal.Event`, so the
platform event shell leaks into persisted host records.

**Decision:** keep event-variant openness, but replace `Universal.Event`-derived
host record inheritance with a closed host-owned `EventBase`.

### Q3 — What should the new event shape look like?

Two options were compared.

**A. Closed notice union**
- Very explicit.
- Deletes declaration merge.
- Forces every event-like input into a core-maintained closed list.

**B. Closed host base + open `EventMap` variants**
- Keeps declaration merge.
- Keeps variants flat instead of wrapping them in an extra payload layer.
- Preserves the user's preference for extending existing contracts rather than
  introducing wrapper types.

**Decision: B.**

Target direction:

```ts
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
```

This preserves `EventMap` while closing the host shell.

### Q4 — What happens to `MessageData extends Universal.Event`?

It should be removed entirely.

`MessageRecord` is not a platform runtime event. It is a host-owned normalized
record with a narrow, stable field set. Keeping it tied to `Universal.Event`
encourages exactly the sort of spread-based leakage found in the gateway
fallback path.

**Decision:** replace inherited message typing with an explicit closed
`MessageRecord` shape.

### Q5 — Should resolver output still use `ResolveContext.base`?

The current `base` object blurs ownership by pre-assembling a near-record in the
Gateway and handing it into platform resolvers.

That makes it harder to answer which layer owns field admission.

**Decision:** remove `ResolveContext.base` and move to a smaller resolver draft
shape. Resolver responsibility becomes platform interpretation; Gateway
responsibility becomes host normalization and final record assembly.

### Q6 — Should non-message ingress still reach the model?

There was a real choice here:

**A. Stop sending non-message ingress into the model entirely**
- Simpler prompt surface.
- Risks removing current behavior that some plugins or future event types may
  depend on.

**B. Keep non-message ingress, but keep its model projection minimal**
- Matches current formatter behavior.
- Prevents event variant payload shape from becoming prompt protocol.

**Decision: B.**

Non-message ingress should still project to the model only as `eventType + text`
inside the current untrusted runtime-event wrapper.

### Q7 — Should `inner_thought` be deleted along with OCL complexity?

Initial answer: delete it, because the current parser carries unused
`innerThoughts` metadata and the user asked for deletion-first simplification.

Revised answer after user feedback: **keep `inner_thought`**, but simplify its
role.

The user wants to retain private deliberation, while removing control elements
whose behavior is already covered elsewhere or is not worth keeping.

**Decision:** keep `inner_thought` as the only private-deliberation control.

### Q8 — Should `skip` and `sleep` stay?

The user rejected both.

- `skip` can be replaced by terminal-tool-driven silence or by simply producing no
  reply through existing runtime behavior; it does not need a dedicated reply
  control element.
- `sleep` duplicates an existing delayed-delivery semantic that already belongs in
  delivery pacing rather than in model-authored content.

**Decision:** delete `skip` and `sleep`.

### Q9 — What remains of reply segmentation after deleting `skip` and `sleep`?

Only two behaviors remain necessary:

1. `inner_thought` — private, host-stripped, persisted raw for replay
2. `sep` — explicit segment boundary

This collapses the current OCL concept from a four-control mini-language into a
much smaller reply-control parser.

**Decision:** the redesign should no longer frame this area as an independent OCL
module. It becomes a smaller reply parsing concern.

### Q10 — Should reply control use Koishi components?

No.

Koishi element APIs are useful for parsing, selecting, and transforming message
elements (`h.parse`, `h.select`, `h.transform`), but `ctx.component()` executes
at render/send time and is the wrong seam for host-owned reply planning.

**Decision:** use Koishi element APIs for parsing and transformation, but do not
model reply controls as message components.

### Q11 — What complexity should be deleted from the current parser?

Current `core/src/reply/ocl.ts` does more than needed:

- four control tags
- protection-zone machinery
- residual-control degradation logic
- per-segment sleep aggregation
- `mergeExcessSegments`
- parser-adjacent observability concerns
- `innerThoughts` parsed metadata array that runtime does not consume

After the revised decisions above, the target parser should only need to:

1. detect and strip `inner_thought`
2. split on explicit `sep`
3. preserve literal text safely
4. degrade to one sanitized message on parse failure

**Decision:** delete `skip`, `sleep`, `mergeExcessSegments`, and parser-owned
observability baggage. Keep segmentation and private-thought stripping only.

## Resulting Design Direction

### Ingress

- Keep `InputRecord = MessageRecord | EventRecord`
- Keep `EventMap` declaration merge
- Replace `Universal.Event`-derived message/event record inheritance with closed,
  host-owned base shapes
- Remove `ResolveContext.base`
- Make Gateway the single field-admission authority for persisted records
- Keep non-message ingress model projection minimal: `eventType + text`

### Reply parsing

- Delete OCL as a heavyweight conceptual layer
- Keep only `inner_thought` and `sep`
- Remove `skip` and `sleep`
- Use Koishi element parsing/transformation APIs where they simplify parsing
- Keep pacing in delivery, not as model-authored protocol

## Design Trade-offs Accepted

**[Trade-off] Open variants, closed shell.**
This keeps declaration merge while still shrinking the host boundary. It is a
middle path: not as minimal as a closed union, but much safer than inheriting
from `Universal.Event`.

**[Trade-off] `inner_thought` remains a special case.**
Keeping it means reply control does not collapse all the way down to plain
segmentation. Accepted because the user explicitly values it and rejected the
idea of removing it for simplicity alone.

**[Trade-off] Non-message ingress still reaches the model.**
Accepted because current architecture already supports it and the minimal
`eventType + text` projection prevents payload shape from becoming prompt
surface area.

**[Risk] Event variants may still grow carelessly.**
Mitigation: keep the base closed, keep event projection narrow, and require each
new event variant to justify its persisted fields.

**[Risk] Reply parsing may overfit to Koishi element semantics.**
Mitigation: treat Koishi APIs as parsing helpers, not as a new protocol runtime.
