## Context

`design-platform-adapter-system` delivered a first Platform Adapter boundary with a generic resource, semantic-view, template, Fact, and legacy-compatibility stack. That stack exceeds current product needs.

This follow-up keeps the useful input boundary while replacing those generalizations with:

- pure-data `Platform.Message` whose working content is a Koishi `Element[]` tree;
- image-only preparation through a narrow `ImagePrepareSink`;
- explicit forward lookup;
- publish-only events;
- a thin module layout (no free-function forest of sanitize/formatter/projection files).

The change is inbound-only. Core owns routing, channel lifecycle, storage, element normalization, formatting, and model role. Adapters own synchronous Session refinement, bounded image preparation, event drafts, and platform tools. `design-platform-adapter-system` remains the historical first implementation and is not rewritten.

A later design review (against AstrBot / Hermes-style adapters) revised the first simplify draft: do not invent a parallel `BodyPart` algebra; do not expose public `sanitizeLiteral` / `formatPlatformMessage` utilities; prefer Koishi elements and a narrow public surface.

## Goals / Non-Goals

**Goals:**

- Persist a versionless incompatible `Platform.Message` with Koishi `elements` as the content model.
- Normalize inbound trees with an allowlist; encode forward as a shallow `<forward>` element (not nested `<message forward>`).
- Freeze admitted inbound images before first persistence; keep model projection local-only.
- Use a fixed core message envelope (not templates).
- Keep forward inspection explicit, bounded, and paginated through OneBot tooling.
- Keep quote handling intentionally shallow.
- Make events typed and frozen but publish-only.
- Restrict adapter I/O to one post-route `prepare` seam with `ImagePrepareSink`.
- Keep platform modules cohesive: orchestrate in `service`, message helpers in `message`, storage in `assets`; shared helpers only under internal `utils/`.

**Non-Goals:**

- Legacy JSONL reading, migration, or compatibility writing.
- A second component type system (`BodyPart`, MessageView, Snapshot, Reader).
- Asset handling for audio, video, files, forwards, quotes, or arbitrary resources.
- Global resource IDs, URI schemes, cross-channel assets, reference counting, or GC.
- Recursive forward/quote resolution, background enrichment, or projection-time network I/O.
- User templates, prompt DSLs, adapter-created ModelMessages, or sender-role policy.
- Event persistence, event LLM admission, world state, willingness, replay, or audit logging.
- Top-level public exports of internal transform/projection helpers.
- Scope beyond authorized `tasks.md` / `plan.md` until those tasks are applied.

## Decisions

### D1: Clean incompatible replacement

- **Choice:** Do not support legacy messages or JSONL. New platform facts are versionless, have no `extensions` map, and have no runtime fact-schema validation.
- **Rationale:** Compatibility keeps duplicate shapes in every consumer.
- **Alternative rejected:** Read-only compatibility, migration, Zod fact schemas, extension maps.

### D2: `Platform.Message` is pure data; content is Koishi `elements`

- **Choice:** `Platform.Message` is a plain data object:

  ```ts
  interface Message {
    source: Source
    scope: Extract<Scope, { type: "channel" }>
    sender: Sender
    messageId: string
    timestamp?: number
    receivedAt: number
    elements: Element[]
  }
  ```

  Behavior lives in module functions (`buildDraft`, normalize/transform, `seal`, literal codec, `toModelMessage`), not on a class. Do not invent `BodyPart` / parallel component types; use Koishi `Element` (`type` / `attrs` / `children`) and `h` parse/transform/stringify.

- **Rationale:** Koishi already defines the message element model. A second algebra duplicates it; string-only pipelines force private attribute dialects to act as a type system.
- **Alternative rejected:** `InboundMessage` class; `BodyPart` unions; working solely on opaque strings with public sanitize/format helpers.

Runtime lifecycle phases `draft | prepared | sealed` may exist in orchestration locals or tests; they need not be persisted on JSONL records. A persisted record is treated as sealed.

Storage encoding may be either a literal string derived from elements or a serialized element tree. The domain working form is always `elements`. Prefer literal storage if it simplifies JSONL tooling; switch only if repeated parse cost matters.

### D3: Forward is a shallow `<forward>` element

- **Choice:** After normalization, forwards are represented as:

  ```html
  <forward id="…" summary="…"/>
  ```

  Use a single encoding (attribute `summary`). Do not persist nested `<message forward>` bodies or Koishi send-style forward trees as the sealed form. Inbound Satori `<message forward>` (and equivalents) MUST be collapsed to one `<forward id summary>` during normalization.

- **Rationale:** Product path is id + fixed summary + explicit tool. Reusing `<message forward>` confuses send semantics with sealed history and invites nested expansion.
- **Alternative rejected:** Inline full forward snapshots; keep `<message id forward/>` as the sealed representation.

Quotes remain `<quote id="…"/>` with no body fetch.

### D4: Adapter-limited image preparation with `ImagePrepareSink`

- **Choice:** After routing, the selected adapter may implement:

  ```ts
  prepare?(ctx: PrepareContext): Promise<Element[] | void>
  ```

  ```ts
  interface PrepareContext {
    session: Session
    message: Readonly<Platform.Message>
    images: ImagePrepareSink
    budget: ImageBudget
  }

  interface ImagePrepareSink {
    put(
      bytes: Uint8Array,
      mimeHint?: string,
    ): Promise<{ assetId: string; mime: string }>
  }
  ```

  `prepare` may fully replace `elements` (complete rewrite allowed). Core preserves all meta fields, applies returned elements, runs final normalization/seal, and never runtime-schema-validates the message. `prepare` has no `AbortSignal`; FIFO channel lifecycle is the sole reset coordination.

  Core wraps `AssetStore` as `ImagePrepareSink` so adapters can put image bytes but cannot clear channels, invent storage layout, or treat AssetStore as a public API.

- **Rationale:** Platform image acquisition belongs in the adapter; storage ownership stays in core; returning `Element[]` keeps one algebra end-to-end.
- **Alternative rejected:** Returning content strings (forces dual parse); passing bare `putImage` functions without a sink type; exposing full `AssetStore`; generic Reader registries.

Fixed image policy: max 4 images/message, 5 MiB/image, 10 MiB total, 10s/image timeout, 2 concurrent downloads, JPEG/PNG/WebP/GIF only. Streamed/`data:` bytes are bounded. SVG rejected. Failure → permanent unavailable image element.

### D5: FIFO per-channel lifecycle serialization

- **Choice:** Serialize routing, preparation, asset commit, and initial agent submission in a FIFO channel mutex. Reset joins the same queue. Do not hold the mutex for full model-stream consumption.
- **Rationale:** Deterministic reset without epoch/Abort bookkeeping.
- **Alternative rejected:** Epoch/Abort coordination; uncoordinated reset.

### D6: Distinct product paths per reference kind

| Kind | Behavior |
| --- | --- |
| Image | Bounded download → local asset on element attrs |
| Audio/video/file | No download; safe metadata + omitted |
| Forward | `<forward id summary>`; tool for detail |
| Quote | `<quote id>`; no lookup |
| Ordinary elements | Allowlist retain |

- **Alternative rejected:** Shared Ref/Reader/Snapshot resource system.

### D7: Narrow AssetStore

- **Choice:** Channel-local image bytes only; implementation-private asset ids (e.g. `asset_<sha256>`).
- **Alternative rejected:** ContentStore, global URI, cross-channel index.

### D8: Core owns fixed projection (single outlet)

- **Choice:** Core builds the user model message: fixed header + element text + local image bytes for multimodal paths. Adapters do not implement `toModelMessages` or emit ModelMessages.

  Header:

  ```text
  [time="2026/7/18 20:34" id="123456" sender="Alice (10001)"]
  <stringified sealed elements>
  ```

  Field order: `time`, conditional `id`, `sender`. Time: platform timestamp or `receivedAt`, `Asia/Shanghai`, `zh-CN`, minute precision. `id` only when an active channel plugin declares static `requiresMessageId: true` (derived before constructing the formatter plugin). Header values use `JSON.stringify()` escaping.

- **Rationale:** One projection outlet avoids template language and adapter header politics.
- **Alternative rejected:** Public `formatter.ts` / `sanitize.ts` as plugin-facing APIs; adapter projection hooks.

### D9: Element allowlist and internal state

- **Choice:** Retain text, `br`/`p`, `at`, `face`/`emoji`, image, audio/video/file (metadata only), `quote`, `forward`. Unwrap unknown/private/component elements while recursively keeping children. Never execute components. Strip inbound `src`/`url`/`href`/`style`/`class`/original `data-*`/native private attrs per policy after preparation states are applied.

  Image asset binding uses element attrs on `<img>` (private asset id + mime). Unavailable/omitted/unread/summary semantics are expressed with fixed attrs or the dedicated `<forward summary>` / empty quote form—not a parallel type enum exported to plugins.

- **Alternative rejected:** Keeping unknown elements with open attribute policy; pure text placeholders that drop structure.

No new ordinary-content character caps in this change.

### D10: Publish-only typed events

- **Choice:** `Platform.Event` has typed `data` + adapter-frozen `content` string. Synchronously published to platform subscribers only. No runtime Zod validation of event shape. No agent custom message / JSONL / LLM admission.
- **Alternative rejected:** EventView/Fact/templates; JSONL event archive.

### D11: Single synchronous adapter refiner on flat `Adapter`

- **Choice:**

  ```ts
  interface Adapter {
    id: string
    platform?: string
    adapter?: string
    profile?: string
    accepts?(session: Session): boolean
    adapt?(session: Session, fact?: Message | Event): Message | Event | void
    // preferred structured result may use RefineResult in implementation:
    // keep | ignore | message | event — void/keep preserves base
    prepare?(ctx: PrepareContext): Promise<Element[] | void>
  }
  ```

  No nested `AdapterIdentity` type—identity fields live on `Adapter`. Deterministic match: profile > adapter name > platform; one winner; conflict is error; failure does not fall through.

  Implementation SHOULD prefer an explicit `RefineResult` discriminant internally (`keep` | `ignore` | `message` | `event`) even if the public method name remains `adapt` for continuity with existing code.

- **Rationale:** Identity nesting adds names without behavior; flat Adapter matches current registration.
- **Alternative rejected:** `AdapterIdentity` wrapper; multiple normalizer hooks; reader/event/extension registries on the adapter object.

### D12: Core-stamped receipt time; event-only public publish

- **Choice:** One `receivedAt` at `internal/session` collection (or public event publish entry). `platform.publish()` accepts event drafts only (no `receivedAt`), stamps once, notifies synchronously. Messages cannot bypass the Session lifecycle via public publish.
- **Alternative rejected:** Adapter-supplied receipt clocks; public Message publish.

### D13: Fallback without adapter prepare

- **Choice:** If no `prepare`, core still normalizes and turns every non-asset image into unavailable; text retained; external URLs must not enter sealed storage/model input.
- **Alternative rejected:** Drop whole message; keep external image URLs.

### D14: Paginated text-only OneBot forward tool

- **Choice:** Unchanged product contract: `messageId`, `offset` default 0, `limit` default 10 max 20; result `{ forwardId, offset, messages, hasMore }` with `{ sender, time?, content }`; caps 1000/record and 6000/page; no child ids; no media download/AssetStore; sanitize content (reuse element transform where practical).
- **Alternative rejected:** Raw OneBot dump; one-shot truncation only.

### D15: Module layout (cohesion over scatter)

- **Choice:** Target layout:

  ```text
  core/src/platform/
    types.ts      # public contracts
    config.ts     # profiles only
    assets.ts     # AssetStore
    message.ts    # draft/normalize/seal/literal helpers for Platform.Message
    service.ts    # orchestration: collect, match, register, publish,
                  # prepare dispatch, createMessagePlugin projection
    utils/        # INTERNAL only — not re-exported from index
      elements.ts # shared element allowlist/transform if ≥2 callers
    index.ts      # PlatformService, types, config only
  ```

  Rules:

  - If a helper is used by only one module, inline it there (e.g. default prepare and header formatting live in `service` or `message`, not top-level `prepare.ts` / `projection.ts` / `formatter.ts` / `sanitize.ts`).
  - If shared by two or more modules, put it under `utils/` and do not export from `index.ts`.
  - Delete `view.ts`, `render.ts`, `resources.ts`, `schema.ts` and the generic Reader/Snapshot stack.

- **Rationale:** Engineering shape should be a small public surface and cohesive modules, not a free-function forest.
- **Alternative rejected:** Top-level public `sanitize.ts` + `formatter.ts` + `prepare.ts` + `projection.ts` as the architecture.

### D16: Static `requiresMessageId` capability

- **Choice:** Channel agent plugins that expose message-operation tools set `requiresMessageId: true`. Core derives `includeMessageId` before constructing the platform message plugin. Adapters do not choose headers.
- **Alternative rejected:** Adapter header flags; model-time tool enumeration.

## Risks / Trade-offs

- **[Destructive upgrade]** Old histories unreadable → document clear/replace data dirs; rollback = old binary + old data.
- **[Reset wait]** Reset waits for in-flight prepare → bounded by image limits; mutex never waits on full streams.
- **[No passive forward/quote body]** Models do not auto-see bodies → forward tool; quote intentionally shallow.
- **[Limited media]** Non-image binaries not model bytes → safe metadata only until a real consumption path exists.
- **[Custom `<forward>` element]** Not a Koishi send standard → document as sealed-history dialect; map only on normalize/persist paths.
- **[Trusted events]** No runtime event validation → TypeScript contracts; publish-only non-persistent events.
- **[Partial tree rewrite risk]** Full `elements` replace in prepare could drop text → seal/normalize after prepare; tests assert meta + non-image retention.

## Migration Plan

1. Keep `design-platform-adapter-system` as historical first implementation.
2. Release new message shape as a destructive storage boundary.
3. Replace first implementation atomically; do not mix legacy/new readers.
4. Verify FIFO reset clears JSONL + image assets after earlier prepare commits.
5. Roll back only with preceding binary and prior data directory.

## Open Questions

- Storage encoding default (literal string vs serialized elements) can be chosen at implementation time under D2; prefer literal unless tests show pain.
- Exact attr names for unavailable/omitted image/file states can be fixed in implementation tests (`message.ts` / element utils) without reopening architecture.
