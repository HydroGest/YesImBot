# platform-message-ingestion Specification

## Purpose

Define collection, adapter refinement, element preparation, normalization, and channel-local asset handling for inbound platform messages.

## Requirements

### Requirement: Incompatible Element-Based Platform Message

Core MUST represent each eligible inbound message during collection and preparation as a versionless pure-data `Platform.Message` whose working content is a Koishi `Element[]` tree plus stable metadata. The shape MUST retain source, channel scope, required channel type (`private` or `group`), sender identity, original platform message ID, receipt time, optional platform timestamp, and `elements`. Core MUST capture channel type from the real Koishi Session while drafting the message and MUST NOT reconstruct or spread a Session-shaped object to preserve that fact. It MUST NOT retain legacy data, a version field, an extensions map, raw Session/Bot/native payload, generic references/readers/snapshots, semantic BodyPart/MessagePart/MessageView types, plain-text duplicates as a second working-content truth, or rendered-presentation cache. Core MUST use Koishi `Element` directly and MUST NOT introduce a parallel public element algebra or hand-written pseudo-elements. Core MUST NOT runtime-schema-validate the platform message.

At the persistence boundary, core MUST encode sealed elements into `Platform.MessageRecord` with the same stable metadata, including channel type, and literal `content: string`. The runtime domain object and persisted record MUST remain distinct; persisted custom-message data MUST NOT use `Element[]` as its storage encoding.

#### Scenario: Direct Session uses an accessor

- **WHEN** an eligible message arrives through a Koishi Session whose directness is exposed by an accessor or another non-enumerable property
- **THEN** core MUST read that fact from the real Session while drafting the platform message
- **AND** the resulting message scope MUST contain `channelType: "private"`

#### Scenario: Canonical message drives downstream routing

- **WHEN** collection and adapter refinement produce a `Platform.Message`
- **THEN** core MUST derive self-message, mention, runtime scope, Agent context, and persistence behavior from that message
- **AND** it MUST NOT re-read sender, scope, content, or channel type from a reconstructed Session

#### Scenario: Eligible message is persisted

- **WHEN** a non-self message is admitted by core routing and preparation completes
- **THEN** core MUST persist a `Platform.MessageRecord` whose literal `content` is derived from normalized and sealed `elements`
- **AND** the record MUST preserve the canonical channel type
- **AND** it MUST NOT persist a legacy compatibility representation or generic presentation model

#### Scenario: Legacy record is encountered

- **WHEN** storage contains a platform-message record without the required channel type or in another legacy shape
- **THEN** the new framework MUST NOT decode, render, infer, or migrate that record at runtime
- **AND** deployment documentation MUST require prior history removal or one-time replacement

### Requirement: Flat Adapter Refinement Contract

An adapter MUST expose flat identity fields `id`, optional `platform`, optional `adapter`, and optional `profile`. Its optional synchronous `refine({ session, base })` hook MUST return this discriminated result:

```ts
type RefineResult =
  | { kind: "keep" }
  | { kind: "ignore" }
  | { kind: "message"; message: Platform.Message }
  | { kind: "event"; event: Platform.Event }
```

`keep` MUST preserve an existing core base and otherwise act as ignore. `ignore` MUST produce no message or event. `message` MUST replace an existing base message, preserve the base `receivedAt`, and is invalid when no core base exists. `event` MUST provide one complete semantic event. `accepts() === false` MAY decline to the next eligible candidate. If `accepts()` or `refine()` throws, core MUST record a diagnostic, MUST NOT select another adapter, and MUST skip that adapter's `prepare()` for the Session. An invalid no-base `message` result MUST likewise record a diagnostic, be ignored, and skip preparation.

#### Scenario: Adapter explicitly declines

- **WHEN** an eligible adapter returns `false` from `accepts()`
- **THEN** core MAY evaluate the next eligible candidate

#### Scenario: Selected adapter refinement fails

- **WHEN** the selected adapter throws from `accepts()` or `refine()`
- **THEN** core MUST preserve the core base when one exists and record a diagnostic
- **AND** it MUST NOT select another adapter or run that adapter's `prepare()`

#### Scenario: Message result has no base

- **WHEN** an adapter returns `message` for a Session with no core base
- **THEN** core MUST record a diagnostic and ignore the result
- **AND** it MUST skip adapter preparation for that Session

### Requirement: Adapter-Limited Message Preparation

The selected platform adapter MAY provide one asynchronous `prepare(ctx)` hook. Preparation MUST reuse the adapter selected during collection and MUST NOT match adapters again. `PrepareContext` MUST provide transient Session access, a read-only `Platform.Message`, a write-only `ImagePrepareSink`, and fixed image budget policy. The hook MUST NOT receive a reset `AbortSignal`; FIFO lifecycle serialization is the sole reset coordination mechanism. The hook MAY return one complete replacement `Element[]` or void and MUST NOT return a string. Core MUST preserve all message metadata, apply returned elements when present, and always run final normalization and sealing before persistence. Core MUST NOT runtime-schema-parse the returned tree as a Zod fact.

#### Scenario: Adapter prepares image content

- **WHEN** a selected adapter prepares an admitted message with image elements
- **THEN** it MUST obtain local assets only through `ImagePrepareSink`
- **AND** it MAY return a complete rewritten `Element[]`
- **AND** core MUST retain the original source, scope, sender, message ID, and timestamps

#### Scenario: Preparation follows collection

- **WHEN** collection selected an adapter and the admitted message reaches preparation
- **THEN** core MUST reuse that exact adapter and Session association
- **AND** it MUST NOT rerun adapter matching

#### Scenario: Adapter attempts post-route metadata change

- **WHEN** adapter preparation would change message metadata rather than elements
- **THEN** core MUST NOT accept that metadata change
- **AND** only the element tree path MAY enter the sealed message content

### Requirement: ImagePrepareSink Boundary

Core MUST expose image writes to adapters only through `ImagePrepareSink.put(bytes: Uint8Array): Promise<{ assetId: string; mime: string }>` rather than a full `AssetStore` API. The sink MUST determine MIME only from verified bytes and MUST NOT accept a MIME hint. `AssetStore`, asset read or clear operations, storage layout, and fixed budget constants MUST NOT be exported to adapters. Adapters MUST NOT clear channel assets, choose storage layout, or read arbitrary asset ids through the preparation seam.

#### Scenario: Adapter stores an image

- **WHEN** adapter preparation successfully freezes an image
- **THEN** it MUST call `ImagePrepareSink.put(bytes)`
- **AND** the sealed `<img>` element MUST reference the returned private asset id and verified mime
- **AND** the adapter MUST NOT receive channel-clear or cross-message asset APIs on that context

### Requirement: Bounded Pre-Persistence Image Freezing

Core MUST prepare images only after routing has admitted a message and before its first agent persistence. Preparation MUST recursively enumerate image nodes in document order, and only the first four image nodes are eligible for retrieval; a fifth or later image MUST become unavailable without starting a request. It MUST issue at most two concurrent downloads per message. Each HTTP download MUST use a ten-second abortable timeout, count every streamed chunk before retention, and abort the underlying request immediately if actual bytes exceed five MiB regardless of declared content length. `data:` input MUST be bounded during decoding and after decoding.

Successful per-image results MUST remain bounded candidates. Core MUST admit candidates to the ten-MiB total message budget in original document order, independent of network completion order, and MUST call `ImagePrepareSink.put(bytes)` only for admitted candidates. MIME MUST come only from verified JPEG, PNG, WebP, or GIF byte signatures. Unknown bytes, SVG, and MIME-spoofed content MUST be rejected.

#### Scenario: Eligible image is prepared

- **WHEN** an admitted message contains an allowed image within every fixed limit
- **THEN** preparation MUST store its bytes through the current channel's private image sink
- **AND** the sealed elements MUST replace the external reference with a private asset id on an `<img>` element

#### Scenario: Image is rejected or fails

- **WHEN** an image exceeds count, byte, MIME, or timeout limits, or its retrieval fails
- **THEN** preparation MUST replace only that image with an unavailable `<img>` form
- **AND** later model projection MUST NOT retry the external read

#### Scenario: Nested images complete out of order

- **WHEN** recursively discovered image downloads finish in a different order from their source nodes
- **THEN** preparation MUST preserve document order when applying the ten-MiB admission budget and rewriting elements
- **AND** no more than two downloads may be active at once

#### Scenario: Fifth image is encountered

- **WHEN** an admitted message contains more than four image nodes at any tree depth
- **THEN** the fifth and later images MUST become unavailable without starting a request

#### Scenario: Ignored message contains image

- **WHEN** a self or otherwise ignored message contains an image reference
- **THEN** core MUST NOT download, validate, or store that image

### Requirement: Fixed Forward and Quote Element Forms

Core MUST normalize forwards to a shallow `<forward id summary>` element (attribute summary encoding) and quotes to `<quote id>`. Core MUST NOT fetch, inline, recursively resolve, or automatically expand forward or quote bodies during inbound preparation or model projection. Core MUST NOT seal nested `<message forward>` trees as the history representation; inbound Satori `<message forward>` forms MUST collapse to one `<forward>` element.

#### Scenario: Forward is received

- **WHEN** an admitted message contains a forward reference
- **THEN** sealed elements MUST contain `<forward id="…" summary="…">` (or equivalent single forward element with id + summary)
- **AND** the summary MUST identify the explicit detail tool when available
- **AND** nested forward body elements MUST NOT be retained

#### Scenario: Quote is received

- **WHEN** an admitted message contains a quote reference
- **THEN** sealed elements MUST retain `<quote id="…">` without body content
- **AND** core MUST NOT call a platform message lookup API

### Requirement: Minimal Element Allowlist Normalization

Core MUST transform each inbound element tree using a fixed allowlist: text; `br`/`p`; `at` with `id` and optional `name`; `face`/`emoji` with `id` and optional `name`; `img` with prepare/seal-owned asset or unavailable state; `audio`/`video`/`file` with safe name/MIME/omitted metadata; `quote`; and `forward`. It MUST unwrap unknown, private, and component elements while recursively normalizing children. It MUST NOT execute components. It MUST strip disallowed attributes per policy after preparation states are applied.

#### Scenario: Unknown wrapper contains safe child content

- **WHEN** an unknown or private element contains text or an allowed child element
- **THEN** normalization MUST remove the wrapper and disallowed attributes
- **AND** it MUST retain the recursively normalized child content

#### Scenario: Component element is received

- **WHEN** an inbound tree contains a Koishi component element
- **THEN** normalization MUST NOT execute the component
- **AND** it MUST remove the component wrapper and recursively normalize its children

### Requirement: Fallback Without Adapter Preparation

Core MUST normalize every admitted message even when no selected adapter implements `prepare()`. Every image that was not frozen as a local asset MUST become unavailable; core MUST retain otherwise allowed text and elements; external image URLs MUST NOT remain in sealed content.

#### Scenario: Adapter lacks preparation hook

- **WHEN** an admitted message selects no adapter or selects an adapter without `prepare()`
- **THEN** core MUST persist normalized ordinary content
- **AND** it MUST replace every external/unfrozen image with an unavailable form
- **AND** it MUST NOT retain the external image URL

### Requirement: No Initial Ordinary-Content Cap

Core MUST NOT impose a new message-content, visible-attribute, or formatter-value character cap in this capability.

#### Scenario: Admitted content is long

- **WHEN** an admitted message has long allowed text or allowed attribute values
- **THEN** core MUST preserve that normalized content without a new truncation marker or cap configuration

### Requirement: Narrow Channel-Local Asset Ownership

Core's private channel asset storage MUST store image bytes only and remain scoped to the channel that admitted the message. Only core MAY read or clear those assets. Core MUST NOT expose storage capabilities to adapters or define a global resource manager, cross-channel asset index, generic content store, resource URI scheme, reference-counting database, or garbage collector.

#### Scenario: Non-image media is received

- **WHEN** an admitted message contains audio, video, or file content
- **THEN** core MUST NOT download or store its bytes
- **AND** sealed elements MAY retain only safe name/type metadata with an omitted state
