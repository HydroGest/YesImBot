# Core Architecture Review

Evidence base for this change. Every claim here was verified by reading the file
or running the measurement shown. `proposal.md` states scope, `design.md` states
decisions, `brainstorm.md` records rejected alternatives; this document holds the
findings and measurements those three rest on and does not repeat them.

Scope: all 32 files of `core/src` (4,828 lines), reviewed 2026-07-27 against
KISS, YAGNI, DRY, SOLID, and Concrete First.

## 1. Summary

Module boundaries in `core` are sound. Gateway, Runtime, Storage, and Model own
real domain concerns and the dependency direction is correct. The problems are
internal:

| Rank | Complexity source | Evidence |
| --- | --- | --- |
| 1 | Features with no production consumer | §2 |
| 2 | Defensive validation of self-constructed data | §3 |
| 3 | Two persisted fields disagreeing on one fact | §4 |
| 4 | One 905-line module holding three unrelated concerns | §5 |
| 5 | Configuration surfaces wider than any caller uses | §6 |

Approximately 700 lines can be deleted without removing any capability that has
a real consumer.

## 2. Features with no production consumer

### 2.1 `ReplyPlan.degraded` and `ReplyPlan.innerThought`

`core/src/reply/parse.ts` returns three fields. Only `segments` is read in
production: `core/src/runtime/index.ts:793` takes `plan.segments` and discards
the rest.

- `degraded` (`parse.ts:1-10`, written at `:40`, `:51`, `:56`, `:65`) — its three
  values are asserted only in `core/tests/ocl.test.ts`. No production code
  branches on it, logs it, or surfaces it.
- `innerThought` (`parse.ts:33-37`) — extracted, joined, returned, never read.
  Its intended purpose (keeping private deliberation out of delivery) is already
  achieved by removing the region from `segments`.

The machinery supporting these fields is substantial: `findProtectedRanges`,
`isProtected`, `findControls` with three `matchAll` passes and cross-filtering,
`stripControls`, `hasRecognizedControl`, `unescapeControlText`, and a `try/catch`
whose only job is producing a fourth degradation path. 172 lines to produce one
array of strings.

### 2.2 `maxSegments`

Configured at `core/src/config.ts:147-152`, threaded through
`ChannelRuntime.maxSegments` (`runtime/index.ts:551-553`), and consumed at
`parse.ts:53`. When exceeded it truncates and sets `degraded` — which nothing
reads. The guardrail's observable effect is silent truncation of a reply.

### 2.3 `hasRenderableSegment`

`runtime/index.ts:513-519` re-parses assistant output in full to answer "was
there anything visible?" — output that `consumeStream` (`:787`) already parsed on
the same turn. Its single caller is `recordReplyCompletion` (`:831`).

### 2.4 Dead exports

Verified by grep across `core/src`, `core/tests`, `plugins/`, `providers/`,
`packages/`:

- `isModelId` (`core/src/model/config.ts:186`) — zero references.
- `EmbeddingModelRef` (`core/src/model/types.ts:54`) — zero references.
- `ProviderPluginOptions` (`core/src/model/provider.ts:23`) — self-use only.
- `decayScore` (`core/src/will/index.ts:14`) — exported, used only in tests.
- `createChannelRuntime` (`core/src/runtime/index.ts:48`, used at `:318`) — no
  production caller; sole user is `core/tests/runtime-manager.test.ts:72`. A
  test-only injection seam.

## 3. Defensive validation of self-constructed data

These helpers do not compensate for a weak type system. They re-check values
that Core constructed itself, with types already known.

| Helper | Location | Why it is redundant |
| --- | --- | --- |
| `hasScope` | `gateway/index.ts:406-413` | Compares record fields against the scope those fields were assigned from at `:347-349`. The assertion is always true. |
| `isRecord` | `gateway/index.ts:400-404` | Checks `schemaVersion === 2` and truthiness of fields Gateway wrote as literals at `:346-356`. |
| `containsReference` | `gateway/index.ts:415-424` | Recursively walks the entire object graph of every inbound record to confirm no `Session` leaked in. |
| `isMessage` / `isEvent` | `event/index.ts:95-127` | Field-by-field `typeof` checks on objects Gateway built from literals. |
| `normalizeLimits` | `reply/pacing.ts:66-90` | Third validation of pacing numbers. |
| `assertValidConfig` | `will/willingness.ts:211-233` | Called on every `decide()` (`:172`) and `onReply()` (`:74`), re-validating immutable frozen config. |

`containsReference` is the most costly: a per-message deep traversal enforcing an
architectural invariant. That invariant belongs in a test or review, not in the
hot path of every inbound message.

Pacing values are validated three times: Koishi Schema `.min()` constraints
(`config.ts:154-178`), then `resolveReplyPacingConfig` freezing defaults
(`config.ts:49-51`), then `normalizeLimits` applying `nonNegative`/`positive`
fallbacks. The third layer cannot fire.

Legitimate boundaries exist and should keep validation: the Session entry point
(untrusted platform input) and JSONL read-back (untrusted disk content).
`storage/manifest.ts` already uses zod for exactly this, which is the pattern to
follow.

## 4. `elements` and `text` disagree

This is the one correctness defect found, not a style issue.

```ts
// core/src/gateway/index.ts:345-356
const sealedElements = sealElements(normalizeElements([...draft.elements]));
return {
  elements: draft.elements,                                             // unsealed
  text: draft.text ?? sealedElements.map((e) => e.toString()).join(""), // sealed
};
```

`sealElement` (`event/element.ts:15-21`) replaces an image carrying `src` with
`<img unavailable/>`. So the persisted `elements` retains the original image URL
while `text` states the image is unavailable. The same pattern appears in the
Satori fallback path at `gateway/index.ts:317-328`.

`AGENTS.md` asserts "`elements` as the sole structured message field, frozen
`text`". In practice the two fields give different answers about whether an image
was frozen.

Two related findings:

- **Double normalization.** `sealElements` already calls `normalizeElements`
  internally (`event/element.ts:24`). Gateway calls
  `sealElements(normalizeElements(x))` at `:317` and `:345`, normalizing twice.
- **`text` is load-bearing as an index.** `selectInputFiles` recovers asset ids
  by re-parsing the text projection: `imageAssetIds(input.data.text)` calling
  `h.normalize()` on it (`media/index.ts:307-325`) — while `input.data.elements`
  is available on the same object. Asset resolution therefore depends on the
  text rendering format.

Text derivation is also triplicated: `gateway/index.ts:328`,
`gateway/index.ts:355`, and `platforms/onebot/index.ts:33` each render elements
to text with the same `map(toString).join("")` expression.

### Measured cost of removing `text`

The stated reason for `text` was caching the render and keeping model-visible
content stable. Measured with a realistic group-chat element mix (`at` + CJK/Latin
text + asset image + face), rendering a full history every turn:

```
history size:         200 messages
render whole history: 0.947 ms per turn
per message:          4.7 µs
deterministic:        true
reparse-stable:       true
```

Against a multi-second model call this is roughly 0.02%. Output is byte-identical
across repeated renders and survives a parse/render round trip, so stability does
not depend on caching. Persisting sealed elements makes the render a pure
function of persisted data.

## 5. `runtime/index.ts` holds three concerns

905 lines containing `RuntimeManager`, `ChannelRuntime`, `OutputQueue`, and six
free functions. One file owns cross-channel lifecycle orchestration, per-channel
FIFO and Agent assembly, a hand-written async-iterable queue, delivery leases,
an `AbortController` table, and a reconciliation state machine.

### 5.1 Three copies of one scheduler

The same serial promise-chain pattern is written three times:
`enqueue` (`:897-904`), `enqueueLifecycle` (`:378-390`), `enqueueReplyCompletion`
(`:860-867`).

### 5.2 `ReplyCompletion` is heavier than its purpose

`ReplyCompletion` (`:521-527`, reconciled at `:811-867`) tracks `acknowledged`,
`deliveryReleased`, and a three-state `eligibility`, on its own promise queue.
Its only effect is deciding whether to call `will.onReply()` (`:854`).

The `eligibility` dimension is redundant. Gateway calls
`delivery.complete(turnId)` only after `session.send()` returns successfully
(`gateway/index.ts:185-189`), and only ever sends segments that exist. A
successful acknowledgement therefore already proves renderable content was
delivered; recomputing it via `hasRenderableSegment` re-derives a known fact.

This finding is independent of whether the willingness engine is kept: it
concerns how a delivered reply is detected, not how the score is computed.

## 6. Configuration wider than its callers

### 6.1 Pacing: nine knobs

`config.ts:153-179` exposes `minDelayMs`, `maxSegmentDelayMs`, `maxTotalDelayMs`,
`cjkCharactersPerSecond`, `latinCharactersPerSecond`, `randomFactorMin`,
`randomFactorMax`, `firstSegmentResidualMinMs`, `firstSegmentResidualMaxMs`.

The first-segment branch (`pacing.ts:29-34`) subtracts elapsed generation time
from the typing delay, encoding an assumption about perceived latency that no
test or observation validates.

### 6.2 Plan contract not implemented

`plan.md` of the preceding change specifies `PacingInput` with
`random: () => number`, and its Task 4 Step 2 requires asserting with a
deterministic `random()`. The implemented `PacingInput` (`pacing.ts:3-9`) has no
such field; `unitRandom()` calls `Math.random()` internally (`:92-95`). A seam the
plan required was silently closed, leaving delay logic assertable only by range.

### 6.3 Willingness tuning is not reachable through the interface

`will/willingness.ts` (233 lines) computes weighted silence across three time
bands with magic constants (`:145-156`), a piecewise quadratic gain multiplier
(`:198-202`), a two-speed high-score decay (`:158-169`), and marginal-gain
damping (`:181`), exposing 10+ knobs — producing one `"wait" | "trigger"`.

`core/tests/will.test.ts:244-272` must write private fields (`will["score"]`,
`will["lastDecayAt"]`, `will["lastMessageAt"]`) to reach these branches. A
capability that cannot be exercised through its own interface cannot be tuned
through it either.

This is recorded as an observation about the interface, not a recommendation to
delete the engine. The engine is retained by explicit decision; see `design.md`
D6 for what changes and what does not.

## 7. Koishi `h` API: measured behaviour

The preceding change's plan (Task 4 Step 4) directs the parser to use
`h.parse()`/`h.select()`/`h.transform()`. Measurement shows that instruction is
unsafe as written, and also shows the shape that does work.

### 7.1 `h.parse` on unguarded LLM text is lossy

```
"List<String> generic" → [text "List"] [String [text " generic"]]
"a < b and 3 > 2"      → [text "a "] [template attrs{3,b,and} [text " 2"]]
"if (x<y) return"      → toString ⇒ "if (x&lt;y) return"
"5<10, 10>5"           → [text "5"] [10, [text "5"]]
"email me <me@x.com>"  → [text "email me "] [me@x.com]
```

`<` is common in assistant output (generics, comparisons, Markdown, emails).
Parsing it as markup silently relocates or destroys text.

### 7.2 `h.parse` has no raw mode

`<raw>` alone does not protect its content:

```
"<raw>List<String> generic</raw>"
  → raw[ text"List", String[ text" generic" ] ]        inner tag still parsed
"<raw>if (x<y) return</raw>"
  → raw[ text"if (x", y)[attrs{"return</raw": true}] ] closing tag consumed
```

In the second case the `</raw>` boundary itself is absorbed into an attribute, so
the end of the raw region no longer exists in the tree.

### 7.3 Re-serializing `raw` children cannot restore the original

Two recovery strategies were tested against 10 inner texts, comparing
byte-for-byte with the original:

| Strategy | Result |
| --- | --- |
| A: `children.map(toString).join("")` | 3/10 |
| B: recursive `text` node content | 2/10 |

Every passing case contained no `<` at all — fidelity in the cases that motivate
`<raw>` is 0/10. Representative failures:

```
"List<String> generic" → A "List<String> generic</String>"   injected close tag
"if (x<y) return"      → A "if (x<y) return</raw/>"          boundary destroyed
"a < b and 3 > 2"      → A "a <template 3 b and> 2</template>" attribute collapse
"&lt;sep/&gt;"         → A "&lt;sep/&gt;"  B "<sep/>"        strategies disagree
```

Root cause: `toString` is not the inverse of `parse`. Whitespace inside tags,
attribute order and quoting, self-closing versus auto-closed form, and whether
`<` was literal or markup are all discarded during lexing — before any child
element is available. No post-hoc join can rebuild them.

### 7.4 Pre-extraction is lossless

Scanning out `<raw>…</raw>` with `indexOf` before parsing, substituting a
per-parse nonce placeholder, then restoring the captured substring into text
nodes, reproduced all test inputs exactly:

```
"<raw>List<String> generic</raw>"          ⇒ "List<String> generic"
"<raw>if (x<y) return</raw>"               ⇒ "if (x<y) return"
'hi <at id="42"/> see <raw>a < b</raw> ok' ⇒ "hi [at id=42] see a < b ok"
"<raw>```ts\nif (a<b) {}\n```</raw>"       ⇒ "```ts\nif (a<b) {}\n```"
```

Element structure outside the raw regions is preserved (`<at>` remains an
element). The nonce must be generated per parse, otherwise a model could emit the
placeholder and inject content.

### 7.5 What `h` does provide

`h.parse` natively converts `&lt;sep/&gt;` into a literal text node, so
`unescapeControlText` (`parse.ts:154-159`) becomes unnecessary once parsing is
element-based. `<sep/>` and `<inner_thought>` become ordinary tree nodes,
replacing interval-overlap bookkeeping with tree partitioning.

## 8. Boundary and documentation findings

### 8.1 `AGENTS.md` contradicts the repository

- It describes `platforms/*` as platform-adapter workspace packages and lists
  `platforms/onebot/` in the package table. **The `platforms/` directory does not
  exist.** The OneBot adapter lives at `core/src/platforms/onebot/` (294 lines),
  inside core. The documented boundary "platform adapters live outside core" does
  not hold.
- It lists `plugins/sticker/` (`koishi-plugin-yesimbot-sticker`), which is
  deleted in the current working tree.

This has a measurable cost: during this review, two independent exploration
agents reached incorrect architectural conclusions by trusting the document over
the tree.

### 8.2 `model/` fragmentation

882 lines across six files implementing one linear flow: load `models.json` →
register providers → refresh schema → resolve a model. `model/index.ts` is a
4-line barrel exporting 4 groups; other consumers, including tests, bypass it via
deep imports. `ModelProvider` and `ModelProviderCapabilities` (`model/types.ts:32-44`)
are single-shape interfaces whose only construction site is `createProviderPlugin`
(`model/provider.ts:71-86`).

### 8.3 Prompt prose stored as TypeScript

`runtime/prompts/constitution.ts` (57 lines) and `runtime/prompts/athena.ts`
(35 lines) are `String.raw` literals with no interpolation or logic, while the
same module already reads optional `AGENTS.md`/`PERSONA.md` from disk
(`runtime/prompt.ts:72-75`). Changing wording currently requires a rebuild.

### 8.4 Hidden class

`createImageFreezer` (`media/index.ts:141-255`) returns `{ freezeImage }` while
closing over mutable `imageCount`, `totalBytes`, `active`, and a `waiting`
queue — a class expressed as a factory. `reportAssetFailure` (`:273-280`) also
contains an unreachable branch: both arms of its `catch` return.

### 8.5 Trivial module

`core/src/path.ts` (5 lines) wraps `path.resolve` with no added behaviour, in its
own file.

## 9. Test suite observations

Test code totals 6,204 lines against 4,059 lines of measured `core/src`.

Fixture weight indicates coupling rather than seams: a single `ChannelRuntime`
test needs ~32 lines of fixture plus ~47 lines of hoisted module mocks before it
can assert anything (`core/tests/channel-runtime.test.ts:20-128`);
`RuntimeManager` tests need ~55 lines (`runtime-manager.test.ts:51-105`); Gateway
tests ~53 lines (`gateway.test.ts:70-122`).

Tests also reach past interfaces: `will["score"]` (`will.test.ts:244-272`),
`service["gate"]` and `service["asset"]` (`service.test.ts:95,157-158`). Near-identical
fixture builders are duplicated across four files (fake logger in five places,
message-record builder in four).

These are consequences of the findings above, not separate problems: the fixture
weight for `ChannelRuntime` follows from §5, and the private-field access in
willingness tests follows from §6.3.
