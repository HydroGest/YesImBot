# Brainstorming Capture: Simplify Platform Adapter Model

## Background

`design-platform-adapter-system` delivered a first Platform Adapter implementation built around a generic resource and presentation pipeline:

```text
Satori content
  -> Ref / Reader / ReadContext / ReadResult
  -> Snapshot
  -> MessagePart / MessageView
  -> template renderer / StoredMessagePresentation
  -> model message
```

The first implementation solved real platform-boundary problems, but read-only review found that its generic resource, presentation, template, and legacy-compatibility layers exceed current product needs. Messages dominate traffic, forward details are already available through an explicit OneBot tool, and no event consumer lifecycle has been implemented.

This follow-up is an intentional incompatible replacement. It is not the original change's Slice 02 (world state, event routing, willingness). `design-platform-adapter-system` remains the historical record of its first implementation and is not retrospectively rewritten.

## Decision Chain

### Q1. Should the new model read legacy JSONL records?

**Decision: no.** The new framework does not read, write, decode, render, migrate, or otherwise support legacy platform-message JSONL shapes. Deployments must deliberately clear or replace old channel history.

Rationale: compatibility created duplicate message semantics and consumer coupling. A clean version break is simpler than retaining a permanent union and fallback renderer.

### Q2. What is the canonical representation of an inbound message?

**Decision: a sanitized Koishi/Satori element literal plus small stable metadata.**

```text
Session.content
  -> synchronous normalization/refinement
  -> routing decision
  -> adapter image preparation and sanitization
  -> core validation
  -> agent JSONL
  -> core MessageFormatter and local-only projection
```

There is no `version` field, `extensions` escape hatch, `MessagePart`, `MessageView`, duplicate plain-text content, or stored rendered presentation.

### Q3. Which binary media is frozen?

**Decision: images only.** An admitted `img`/`image` may be downloaded before first persistence, validated, and written to the channel-local AssetStore. Audio, video, and file elements are not downloaded in this version; they retain only safe type/name metadata and an omitted state.

Image limits are fixed rather than operator-configurable:

```text
maximum images per message: 4
maximum bytes per image: 5 MiB
maximum total image bytes per message: 10 MiB
per-image timeout: 10 seconds
maximum concurrent downloads per message: 2
accepted MIME types: image/jpeg, image/png, image/webp, image/gif
```

Actual streamed bytes, including decoded `data:` URLs, are limited even when `Content-Length` is missing or misleading. SVG is never admitted as a model image. A failing image becomes a permanent unavailable element; other text and allowed images continue.

### Q4. How does reset coordinate with image preparation?

**Decision: a FIFO per-channel lifecycle mutex.** It serializes routing, preparation, asset commit, and initial agent submission, but does not wait for an entire model turn stream.

```text
message A prepare + initial submission
  -> reset clear/stop
  -> message B prepare + initial submission
```

A reset waits for preparation already ahead of it, then stops the runtime and clears JSONL/assets. Messages arriving after reset is enqueued wait behind reset. Reset completion therefore guarantees that work submitted before reset has been cleared, while active turns are interrupted through normal runtime lifecycle behavior.

### Q5. Do all references use a generic resource model?

**Decision: no.** The paths are deliberately distinct:

| Input kind | Inbound behavior | Stored form | Detail behavior |
| --- | --- | --- | --- |
| Image | bounded download and freeze | internal asset ID | core reads local bytes for multimodal projection |
| Audio/video/file | no download | safe name/type plus omitted state | no byte projection |
| Forward | ID plus fixed summary | forward ID and summary | explicit paginated OneBot tool |
| Quote | ID plus fixed summary | quote ID and unread summary | no lookup |
| Ordinary elements | sanitize and retain literal | literal | core text projection |

There are no `Ref`, `Reader`, `ReadContext`, `ReadResult`, `Snapshot`, generic depth policy, or generic resource registry.

### Q6. How are assets and resource IDs stored?

**Decision: keep AssetStore narrow.** It stores channel-local image bytes only. External URLs are removed and successful images become implementation-private `asset_<id>` values. No ContentStore, global resource manager, stable resource URI scheme, cross-channel index, reference counting, or garbage collection is introduced.

### Q7. How are forward and quote handled?

**Decision: neither is automatically expanded.** A forward retains ID plus a fixed summary that advertises the explicit detail tool. A quote retains ID plus a fixed body-not-read summary. Neither causes platform API access during inbound preparation or model projection; nesting is never recursively resolved.

### Q8. What does `onebot_get_forward_message` return?

**Decision: a bounded sanitized paginated result, not raw OneBot data.**

```ts
input: {
  messageId: string
  offset?: number // default 0
  limit?: number  // default 10, maximum 20
}

output: {
  forwardId: string
  offset: number
  messages: Array<{
    sender: string
    time?: string
    content: string
  }>
  hasMore: boolean
}
```

Returned records are consecutive from `offset`; the next request uses `offset + messages.length`. A record has no child message ID because forwarded messages commonly cannot be acted upon in the current channel. Per-record content is capped at 1,000 characters and all page content is capped at 6,000 characters. Forward media is replaced with unavailable/omitted representation: the tool neither downloads media nor writes AssetStore entries, because current tool-result projection cannot attach local image bytes to the model.

### Q9. What is the event lifecycle?

**Decision: publish-only.** A standardized event contains typed structured data and adapter-created frozen sanitized content, then is synchronously distributed to platform subscribers. Core does not runtime-validate the event shape or scan `data` for JSON safety; TypeScript declarations and trusted adapter/plugin contracts define that boundary. Events do not become agent custom messages, JSONL records, LLM input, world-state archives, or replay logs in this change.

`PlatformEventVariants`-style declaration merging remains the compile-time typing mechanism. `Fact`, `EventView`, semantic event nodes, templates, and event renderers are removed.

### Q10. How are normal messages encoded for the LLM?

**Decision: a core-owned fixed MessageFormatter, not templates.**

```text
[time="2026/7/18 20:34" id="123456" sender="Alice (10001)"]
Sanitized Koishi element literal
```

Rules:

- fixed field order: `time`, conditional `id`, `sender`;
- `time` is source timestamp or receipt time, in `Asia/Shanghai`, `zh-CN`, minute precision;
- `sender` is display name plus raw user ID, or raw user ID alone;
- `id` is raw platform message ID only when the current runtime exposes a message-operation tool;
- no short ID mapping and no sender role in the first version;
- quoted escaping prevents values from creating fields or newlines.

Core, not adapters, parses the sanitized literal, emits the formatted text, and appends local image bytes for a multimodal path. Projection never accesses platform APIs or the network.

### Q11. How are literals sanitized?

**Decision: use a minimal semantic allowlist and unwrap unknown elements.**

Allowed structure:

```text
text
br / p
at(id, name?)
face / emoji(id, name?)
img / image(id, alt?, verified mime?, data-yesimbot)
audio / video / file(name?, sanitized mime?, data-yesimbot)
quote(id, data-yesimbot, fixed summary)
message forward(id, forward, data-yesimbot, fixed summary)
```

Unknown, private, and Koishi component elements lose their name and attributes but retain recursively sanitized children. Components are never executed. The sanitizer strips `src`, `url`, `href`, `style`, `class`, all original `data-*`, native fields, and platform-private attributes.

Only sanitizer-authored `data-yesimbot` survives. Its current stable values are `asset`, `unavailable`, `omitted`, `unread`, and `summary`.

### Q12. Where does platform image I/O live?

**Decision: the selected adapter has one message-specific `prepareMessage()` hook.** The hook runs after routing but before persistence. It receives transient Session access, read-only message metadata, and channel AssetStore; it returns only the final sanitized content string. It has no `AbortSignal`; FIFO lifecycle serialization is the sole reset coordination mechanism. Core preserves every metadata field and always applies the final functional literal sanitizer; it does not runtime-schema-parse or shape-validate the returned message.

This is intentionally not a generic Reader or public durable ReadContext. It cannot modify source, scope, sender, message ID, timestamps, model role, or header.

### Q13. What is the final minimal Adapter interface?

**Decision: retain only two optional hooks.** `adapt(session, fact?)` is the one synchronous pre-routing platform refiner. It may preserve the base fact by returning `void`, replace a recognized Message/Event, or create a standard fact when core supplied none. `prepareMessage(session, readonlyMessage, assets)` is the one post-routing image/content hook and returns only a content string. There is no `AbortSignal`, separate normalizer hooks, reader/event/extension registry, model projection hook, or cancellation protocol.

### Q14. Do new messages/events have versions, extensions, or runtime schemas?

**Decision: no.** The new message model is versionless and has no `extensions` field. The new event model likewise has no extension map. Core does not retain Zod schemas, `parseWith()`, structural guards, `EventDefinition.schema`, or extension-schema registries for platform facts. TypeScript types describe trusted adapter/plugin contracts; literal sanitization remains a functional transformation, not a runtime schema check.

### Q15. What if no adapter implements image preparation?

**Decision: core falls back safely.** Core still sanitizes the message. Every image that was not frozen by a selected adapter becomes `data-yesimbot="unavailable"`; ordinary text remains eligible for storage and model input. Quote, forward, and non-image media retain their established fallback forms.

### Q16. How are formatter/literal values encoded and bounded?

**Decision: use standard serializers and add no ordinary-content bound now.** Header values use `JSON.stringify()`. Literal content uses `h.parse()`, tree transformation, and `h.stringify()`. No new message content, visible attribute, or formatter-value limits/configuration are introduced in this change.

### Q17. Who owns receipt time and public event publication?

**Decision: core owns receipt time once.** Core captures one `receivedAt` immediately at `internal/session` collection and preserves it through normalization, routing, persistence, and dispatch. Public `platform.publish()` accepts only an Event draft without `receivedAt`, stamps it once at entry, and synchronously publishes it. It never accepts messages.

### Q18. How does the core formatter know whether to include MSGID?

**Decision: channel plugins declare a static capability.** A plugin that exposes a message-operation tool sets `requiresMessageId: true`; core derives the formatter boolean while constructing the channel's plugins. This remains core formatter policy, does not give adapters header control, and avoids model-time tool enumeration.

## Rejected Alternatives

- Keeping the generic resource/presentation stack: it solves recursive cases that current product paths intentionally avoid.
- Storing full forward/quote snapshots: it makes every inbound forward expensive and duplicates the explicit tool.
- Downloading forward-tool media: tool result IDs cannot currently become multimodal bytes, so it adds I/O without model benefit.
- Event JSONL/LLM admission: it would turn agent history into an event archive before any event consumer is defined.
- User templates or adapter-produced ModelMessages: they recreate the removed prompt-language and ownership problems.
- A global asset/resource URI system: no current lifecycle requires it.

## Decision Status

Original Q1–Q18 authorized the first simplify draft. A later architecture review revised engineering shape without reopening product non-goals (see **Revision R1** below). Design/proposal/specs/tasks/plan MUST follow R1 + design.md; where Q2/Q7/Q11–Q13 conflict with R1, **R1 wins**.

## Scope Boundary

`tasks.md` and `plan.md` are authorized planning artifacts and must stay coherent with R1. No implementation task has been applied yet.

## Revision R1 (post-review): Domain model and module cohesion

Trigger: critique that string-only pipelines + free-function modules lack an engineering spine; comparison with AstrBot (element/component model) and Hermes (thin gateway + hard adapter boundary).

### R1.1 Message name and shape

**Decision:** Public type is **`Platform.Message`** (not `InboundMessage`). It is **pure data**. Working content field is **`elements: Element[]`** (Koishi message elements via `h`). No class API; behavior is module functions.

### R1.2 No parallel BodyPart algebra

**Decision:** Do not reimplement message components. Use Koishi Element trees. Literal string is an optional storage/codec form, not the only domain type.

### R1.3 Forward sealed encoding

**Decision:** Normalize to **`<forward id="…" summary="…"/>`**. Do not seal nested `<message forward>` trees. Quote remains `<quote id/>`.

### R1.4 Adapter identity

**Decision:** **No `AdapterIdentity` type.** Keep `id` / `platform` / `adapter` / `profile` flat on `Adapter`.

### R1.5 Prepare contract

**Decision:** `prepare(ctx: PrepareContext): Promise<Element[] | void>` may fully rewrite elements. Context carries **`images: ImagePrepareSink`** (keep this type; do not pass put methods as loose parameters) plus budget and readonly message/session. No `AbortSignal`.

### R1.6 Module layout

**Decision:** Top-level modules: `types`, `config`, `assets`, `message`, `service`, narrow `index`. Shared multi-caller helpers under **`utils/`** and **not** public exports. Single-caller helpers **inline**. Do not ship public top-level `sanitize.ts` / `formatter.ts` / `prepare.ts` / `projection.ts` as the architecture.

### R1.7 Unchanged product boundaries

Destructive no-legacy; image-only freeze; quote shallow; forward tool; publish-only events; FIFO lifecycle; core-owned fixed header; `requiresMessageId` static capability — all remain.

### Additional rejected alternatives (R1)

- `BodyPart` / `InboundMessage` naming and parallel component systems.
- Nested `AdapterIdentity`.
- Passing bare `putImage` callbacks instead of `ImagePrepareSink`.
- Top-level public free-function transform APIs as the module story.
