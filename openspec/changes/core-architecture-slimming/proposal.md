## Why

A systematic review of `core` (4,828 lines) found that its module boundaries are
sound but its internals pay for requirements that do not exist. Three patterns
dominate: features whose output no consumer reads, defensive runtime validation
of data Core itself just constructed, and two persisted fields that disagree
about the same fact. Measured evidence for every claim is in `review.md`.

Addressing this now matters because the reply path is about to grow: natural
message segmentation is the active product direction, and building it on the
current hand-rolled parser would deepen the wrong foundation. The slimming also
removes a real correctness defect in persisted records rather than deferring it.

## What Changes

**Reply parsing foundation**
- From: A hand-rolled regex parser owns protection ranges, escape/unescape,
  residual-control detection, and three degradation modes; output is text-only
  segments.
- To: Koishi `h.parse()` owns all message structure. A new `<raw>` control
  element carries verbatim plain text and is pre-extracted before parsing.
  Output becomes ordered `Element[]` segments.
- Reason: The parser reimplements element recognition Koishi already provides,
  while its degradation machinery has no production consumer.
- Impact: Breaking for prompts and any consumer of `ReplyPlan`. Enables `<at>`,
  images, and other elements in assistant replies.

**Reply control grammar**
- From: `<inner_thought>` and `<sep/>`, plus parser-owned protection zones over
  fenced code, inline code, URLs, and arbitrary non-control elements.
- To: `<inner_thought>`, `<sep/>`, and `<raw>`. Literal-text safety becomes
  model-authored through `<raw>` instead of host-inferred through heuristics.
- Reason: Protection zones guess at intent; `<raw>` states it. Guessing cannot
  be made correct because the host cannot know whether `<` was markup or text.
- Impact: Breaking for the prompt contract. Requires a literal-recovery fallback
  for unwrapped content (see `design.md` D3).

**Persisted message projection**
- From: `MessageRecord` carries both `elements` and a frozen `text`, and the two
  disagree: `elements` is persisted unsealed while `text` is derived from sealed
  elements.
- To: `MessageRecord.elements` holds sealed elements as the single source of
  truth. `MessageRecord.text` is removed and rendered on demand at projection.
- Reason: The divergence is a correctness defect, and the caching `text` provided
  is worth 0.947 ms per turn across a 200-message history (`review.md` §4).
- Impact: Breaking for the persisted `yesimbot.message` payload. `EventRecord.text`
  is retained because Events have no `elements`.

**Reply pacing**
- From: Nine configuration knobs, a `normalizeLimits` re-validation layer, and
  first-segment generation-time compensation.
- To: Two knobs, no re-validation layer, uniform treatment of all segments.
- Reason: Koishi Schema already constrains these values; the third validation
  layer is redundant and the first-segment special case encodes an unverified
  assumption.
- Impact: Breaking for `reply.pacing` configuration keys.

**Removed over-design**
- Delete `ReplyPlan`, `degraded`, `maxSegments`, `containsReference`, `isRecord`,
  `hasScope`, `normalizeLimits`, `hasRenderableSegment`, `imageAssetIds` text
  round-trip, `createChannelRuntime` test-only seam, `resolveBasePath`,
  `isModelId`, `EmbeddingModelRef`, and the `ReplyCompletion` three-state
  reconciler.
- Collapse three duplicate promise-chain schedulers into one, split
  `runtime/index.ts` (905 lines) along its three real seams, merge `model/`
  from six files into two, and move prompt prose out of TypeScript literals.

## Capabilities

### Modified Capabilities
- `reply-output-control-language`: Adopt element-based parsing, add the `<raw>`
  control element, replace protection zones with literal recovery, and remove
  degradation modes and the segment maximum.
- `platform-message-formatting`: Project Messages from sealed `elements` instead
  of a frozen `text` field, and select media from `elements` rather than text.
- `platform-message-ingestion`: Persist sealed elements as the single structured
  field and stop admitting a resolver-supplied `text`.
- `message-delivery`: Deliver ordered `Element[]` segments and reduce pacing to
  a bounded, configuration-light delay.
- `channel-will-evaluation`: Simplify successful-reply notification to delivery
  acknowledgement, and validate willingness configuration once at construction.
- `core-runtime-integration`: Remove defensive re-validation between internal
  seams and restate runtime ownership across the split modules.
- `model-input-media-budgeting`: Discover image references from `elements`.

## Impact

- Depends on `simplify-ingress-records-and-reply-segmentation`, which is complete
  but not yet archived. These spec deltas are written against that change's
  post-state: the two-element reply grammar, closed ingress records, and removed
  `skip`/`sleep` semantics are assumed already in place.
- Affected code: `core/src/reply`, `core/src/event`, `core/src/gateway`,
  `core/src/runtime`, `core/src/media`, `core/src/will`, `core/src/model`,
  `core/src/platforms/onebot`, and their tests.
- Affected persisted contracts: `yesimbot.message` loses `text` and stores
  sealed `elements`. Existing JSONL remains on disk unread, consistent with
  prior practice; no migration or dual read is added.
- Affected configuration: `reply.segmentation` is removed; `reply.pacing`
  shrinks to two keys.
- Affected prompts: the constitution must teach `<raw>`; prose moves to
  packaged Markdown resources.
- Affected docs: `AGENTS.md` currently describes a `platforms/*` workspace
  package layout and a `plugins/sticker` package that do not exist in the
  repository; both are corrected as part of this change.
- Retained deliberately: the willingness engine and its tuning surface, and the
  `WillEngine` interface, which has two real implementations.
