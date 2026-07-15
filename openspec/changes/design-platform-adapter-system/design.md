## Context

Koishi delivers inbound platform facts as Satori Sessions. Current core code
receives user messages through middleware, carries Session through route and
reply logic, converts it to a custom runtime message, and renders it for the
model in the same area of code. This works for normal text messages but leaves
no clear boundary for platform implementation differences, native events,
structured media, or world-state consumers.

Satori already supplies standard resources, message elements, event names, and
adapter dispatch. It emits `internal/session` before specific dispatched event
names. OneBot 6.9.4 constructs and dispatches a Session for
`message_reactions_updated`, with native OneBot data attached before dispatch.
The event's declared public name and runtime type/subtype differ, so core must
not rely on every adapter-specific event name.

## Goals / Non-Goals

**Goals:**

- Define a stable, validated boundary from Koishi/Satori input to YesImBot
  messages and events.
- Keep adapter-specific parsing outside core policy while preserving one core
  collector and one final LLM presentation policy.
- Support stable Satori events, namespaced platform extensions, explicit
  publication, and later world-state or willingness consumers.
- Preserve replayable channel presentation without retaining raw Sessions or
  depending on an installed platform plugin.

**Non-Goals:**

- No output delivery abstraction, platform send adapter, capability framework,
  global event archive, replay system, dedupe cache, or raw trace store.
- No platform API calls, database access, network access, or media download in
  the conversion path.
- No automatic assignment of guild or account events to a channel agent.
- No implementation tasks or execution plan in this change.

## Decisions

### D1: Core collects dispatched Sessions once

- **Choice:** Core observes every Satori-dispatched inbound Session through
  `internal/session`. Middleware consumes the already-created message for route
  and reply control, rather than constructing a second message. A public
  structured publication API handles sources outside Satori dispatch.
- **Rationale:** This captures standard and native Session events, removes
  listener duplication, and preserves middleware behavior for chat replies.
- **Alternatives considered:** Per-adapter `ctx.on()` and middleware listeners
  were rejected because they duplicate input, depend on order, and can stop the
  middleware chain. Treating `internal/session` as a universal Koishi event hook
  was rejected because plugins can emit Session-bearing events outside dispatch.

### D2: Adapters refine platform facts, not product policy

- **Choice:** Core derives a Satori result, then a selected platform refiner can
  correct or extend it. Refiners never decide routing, persistence, willingness,
  final LLM text, or outbound delivery.
- **Rationale:** Platform facts change independently from YesImBot policy.
- **Alternatives considered:** Core-owned rules would grow around unstable
  provider details. Fully autonomous adapter plugins would mix unrelated policy
  and render inconsistent prompts.

### D3: Adapter selection is explicit and deterministic

- **Choice:** One refiner can modify one input. Explicit implementation profile
  matches outrank Koishi adapter matches, which outrank platform matches. Ties
  are configuration errors. A refiner can decline an input; a failure records a
  diagnostic but does not silently try another implementation.
- **Rationale:** NapCat and Lagrange can share a platform and Koishi adapter, so
  raw field fingerprinting is neither stable nor core-owned.
- **Alternatives considered:** Ordered refiner chains and numeric priorities
  were rejected because they hide conflicting writes. Raw implementation
  fingerprinting was rejected because it breaks with upstream changes.

### D4: Core owns a fixed common shape and runtime schemas

- **Choice:** Core fixes the common source, scope, time, identity, and version
  structure. Plugins add namespaced event payloads and namespaced extensions,
  each with declaration merging and a runtime schema. Every input has one
  primary conversation, guild, or account scope.
- **Rationale:** A top-level optional-field bag loses event semantics and cannot
  validate persisted external data.
- **Alternatives considered:** Arbitrary extension fields on every event and
  TypeScript-only extension were rejected because names collide and runtime data
  remains unvalidated.

### D5: Satori content remains the message-content source of truth

- **Choice:** Persist Satori content and an optional structured quote reference.
  Derive text, mentions, media, files, forward messages, and other element views
  when a consumer needs them. Store selected data Satori cannot express only in
  validated namespaced extensions.
- **Rationale:** A second element tree, attachment list, and plain-text cache
  would create competing stored representations.
- **Alternatives considered:** Persisting several equivalent content forms was
  rejected because they drift after transformations.

### D6: Standard, unknown, and invalid event outcomes differ

- **Choice:** Core recognizes all Satori inbound Session events. A standard type
  requires its event-specific minimum schema. An unregistered native event
  becomes a safe unknown result; a conversion result that fails its claimed
  schema becomes a diagnostic and publishes no fact.
- **Rationale:** Consumers need valid types without forcing every field optional.
- **Alternatives considered:** Partial standard events were rejected because
  they force every consumer to guess missing identity fields.

### D7: Distribution is synchronous; consumers own asynchronous work

- **Choice:** Conversion, validation, and notification complete synchronously
  in per-bot receipt order. Consumers queue slow I/O independently. Consumer
  failure does not block another consumer, and core promises no completion order
  for asynchronous consumer work.
- **Rationale:** `internal/session` is synchronous and message handling cannot
  wait for unrelated world-state or storage operations.
- **Alternatives considered:** A global core queue was rejected because it would
  couple unrelated consumer latency to inbound message handling.

### D8: Core retains no raw data and no global event store

- **Choice:** Session, bot handles, and native raw data remain transient. Core
  stores only selected, validated extensions. Core creates neither a raw trace
  store nor a global event archive. It removes only the duplicate path between a
  dispatched Session and middleware; it does not dedupe platform replay.
- **Rationale:** Raw data creates privacy, size, serialization, and migration
  obligations. Heuristic replay dedupe can remove real input.
- **Alternatives considered:** Event sourcing, time-window dedupe, and raw
  payload persistence were rejected because no current consumer requires them.

### D9: Presentation uses core semantic nodes

- **Choice:** Extensions convert their typed payloads into a finite set of
  core-defined semantic nodes. Core formats them into final model input, runs
  templates, escapes values, applies limits, and chooses media transport.
- **Rationale:** Core cannot understand every native field, but prompt safety and
  structure must remain consistent across platform plugins.
- **Alternatives considered:** Plugin-owned final text and AI SDK messages were
  rejected because they bypass consistency and safety rules. Generic raw JSON
  rendering was rejected because it is weak model input and exposes internals.

### D10: Channel history stores presentation semantics for events

- **Choice:** A channel-admitted non-message event stores source metadata, type,
  and semantic nodes, not custom platform payload. Messages retain Satori
  content. World state owns any independent persistence it needs.
- **Rationale:** Historical prompts still work after a plugin is removed or
  upgraded, while templates can still control wording.
- **Alternatives considered:** Recomputing old event presentation from custom
  payload was rejected because it depends on plugin availability and version.

### D11: Templates and media remain constrained

- **Choice:** Templates arrange stable semantic data but cannot access raw data,
  roles, framing, escaping, limits, or transport. Media defaults to safe metadata
  in text; no raw URL enters prompt text. An image needs explicit separate media
  handling before becoming a model media part.
- **Rationale:** Platform URLs can contain credentials, local addresses, or
  temporary parameters. Templates must not bypass prompt boundaries.
- **Alternatives considered:** Adapter templates and automatic media pass-through
  were rejected because they give plugins inconsistent and unsafe output paths.

### D12: Willingness receives routed structured facts

- **Choice:** World state and routing resolve the relevant agent before a future
  willingness system evaluates structured input. Platform adapters do not emit
  observation, command, intent, or trigger-candidate labels.
- **Rationale:** Interaction commands and message content are platform facts;
  their product meaning depends on state and routing policy.
- **Alternatives considered:** Adapter-level trigger flags were rejected because
  they bind platform parsing to a future product policy.

### D13: Registrations are live and disposable

- **Choice:** Core owns a live registry for refiners, schemas, element handlers,
  and semantic contributions. Each registration returns a disposer. It remains
  independent from per-channel agent plugin snapshots.
- **Rationale:** Input conversion is global and must use current plugin state;
  channel runtimes do not need recreation after an adapter changes.
- **Alternatives considered:** Channel-scoped registry snapshots were rejected
  because two channels could normalize the same platform event differently.

### D14: Resource snapshots are frozen before first persistence

- **Choice:** Synchronous conversion discovers stable message, forward, quote,
  and media references without I/O. According to one core-wide policy, an
  asynchronous resource stage can resolve selected references, apply detail and
  truncation limits, and freeze the results before the original message first
  enters agent storage. `toModelMessages` performs no platform API calls,
  network access, downloads, or resource resolution. It reads the persisted
  snapshot and may read immutable channel-local assets by content hash to build
  stable media parts.
- **Rationale:** A resource fetched only during model projection can disappear,
  expire, or change between requests. Rewriting a historical model message
  breaks prompt-prefix stability and prompt-cache reuse.
- **Alternatives considered:** Turn-local resolution inside `toModelMessages`
  was rejected because every model step rebuilds history and could produce
  different content. Automatic retries that mutate old history were rejected
  for the same reason.

### D15: Structured resource data is inline; binary media is channel-local

- **Choice:** Bounded forward bodies, quote bodies, media metadata, resolution
  status, and applied policy version are stored with the original message.
  Binary media that remains model-visible is stored by content hash under the
  current channel directory. Messages keep stable asset references. Channel
  reset removes channel history and channel assets together.
- **Rationale:** Inline structured snapshots keep history self-contained. A
  channel-local asset store avoids cross-channel permissions, reference counts,
  and garbage collection while ensuring model-visible media survives temporary
  platform URLs.
- **Alternatives considered:** Runtime-only bytes were rejected because later
  prompts would change. A global content-addressed store was deferred because it
  adds cross-channel ownership, authorization, retention, and garbage collection
  before a real shared consumer exists. A future unified resource center may
  revisit that tradeoff when cross-channel reuse has concrete requirements.

### D16: The first resource policy is core-wide

- **Choice:** Core configuration controls resource switches, detail level,
  nesting, count and character limits, timeouts, concurrency, request budgets,
  allowed media types, and byte limits. Platform readers implement API access
  but cannot loosen those budgets. New configuration applies only to newly
  persisted messages.
- **Rationale:** Per-channel policy requires a configuration ownership and
  authorization model that the current core does not have.
- **Alternatives considered:** Adapter-owned limits were rejected because each
  platform would expose different safety behavior. Per-channel overrides are
  deferred until a real configuration system requires them.

### D17: Public names are short and namespace-scoped

- **Choice:** Public types use `Platform.Message`, `Platform.Event`,
  `Platform.Scope`, `Platform.Adapter`, `Platform.MessageView`,
  `Platform.EventView`, and `Platform.Reader`. The service exposes
  `ctx.yesimbot.platform.register(extension)` and
  `ctx.yesimbot.platform.publish(input)`. No public common message-or-event union
  is required.
- **Rationale:** The namespace keeps individual names short without losing their
  domain context.
- **Alternatives considered:** Repeated `PlatformXxx` prefixes were rejected as
  long and visually noisy. `Presentation` and the earlier engineering-oriented
  working terms were rejected as public names.

## Risks / Trade-offs

[Risk] `internal/session` is a lower-level Satori hook. -> Mitigation: isolate
the hook in one core boundary and add contract tests against supported Koishi
versions and OneBot dispatched native events.

[Risk] An explicit implementation profile can be configured incorrectly. ->
Mitigation: show the selected refiner and optional probe evidence in diagnostics;
do not use hidden raw-field guesses.

[Risk] Semantic nodes may initially lack an expression needed by a custom event.
-> Mitigation: add a narrow general node after an actual example, not a raw-text
escape hatch.

[Risk] Core does not persist raw data for later debugging. -> Mitigation: retain
safe processing diagnostics and design any sampling facility separately when an
operational need exists.

[Trade-off] No global event archive prevents replaying all platform history. ->
Accepted because event sourcing would add storage, privacy, idempotency, and
migration obligations before a consumer exists.

[Trade-off] Audio, video, and file content are not automatically model-visible.
-> Accepted because automatic URL use can leak credentials or require I/O.

[Risk] Resource resolution delays first persistence and direct-message response.
-> Mitigation: keep it optional, bounded by core timeouts and request budgets,
and persist a stable unavailable result when the budget expires.

[Trade-off] Channel-local binary assets can duplicate the same media across
channels. -> Accepted because local ownership and reset cleanup are simpler than
global reference counting.

## Migration Plan

Implementation is intentionally deferred. When implementation begins, it will:

1. Introduce the core collection and validation boundary alongside focused
   contract tests.
2. Route existing message behavior through that boundary without changing its
   private, mention, ordinary observation, or busy-join semantics.
3. Move platform message model conversion into the unified presentation path.
4. Add pre-persistence resource snapshots and channel-local binary assets.
5. Add live platform registrations and one default Satori implementation.
6. Add non-message consumers only after each consumer has a persistence and
   routing policy.

Rollback during development removes the new boundary and restores the current
message-only route. No historical raw-event migration is required because the
first implementation creates no global event archive.

## Open Questions

- What minimal semantic node set covers the first real custom event examples?
- Which non-message consumers ship first, and how do they route guild or account
  facts to world-state or agent contexts?
- Which explicit media handling modes are valid for supported model providers?
