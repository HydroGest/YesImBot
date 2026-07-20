## Why

The first Platform Adapter implementation solved real boundary problems but introduced a generic resource, semantic-view, template, and legacy-compatibility stack that exceeds current product needs. A follow-up simplify draft still risked a free-function pipeline (`sanitize` / `formatter` / string content) and a parallel body algebra. The revised direction keeps the thin product paths while using pure-data `Platform.Message` with Koishi `elements`, a flat `Adapter` contract, `ImagePrepareSink` for image puts, and a cohesive module layout.

## What Changes

**Platform message representation**
- From: Legacy-compatible messages, generic refs/readers/snapshots, semantic parts, stored presentations, or string-only content with parallel BodyPart ideas.
- To: Versionless pure-data `Platform.Message` with `elements: Element[]` (Koishi message elements) as the working content model; sealed storage may encode literal or serialized elements.
- Reason: Reuse Koishi's element model instead of inventing a second component system or treating opaque strings as the only domain type.
- Impact: Breaking; old JSONL unsupported.

**Image-only media preparation**
- From: Shared Reader/Snapshot resource pipeline.
- To: Adapter `prepare(ctx)` with `ImagePrepareSink` + budget; may fully rewrite `elements`; core seals and projects locally.
- Reason: Only images are model-consumable binary input today.
- Impact: Audio/video/file bytes not cached; Reader/Snapshot/resource policy removed.

**Forward and quote**
- From: Generic snapshot resolution or `<message forward>` sealed trees.
- To: Sealed `<forward id summary/>` and `<quote id/>`; paginated OneBot tool for forward text; no inbound body fetch.
- Reason: On-demand forward inspection is enough; nested message-forward confuses send vs history semantics.
- Impact: Breaking vs raw/tool-expanded forward paths.

**Model presentation and events**
- From: Views, Facts, templates, event history.
- To: Core-owned fixed header envelope + element projection; events typed + frozen content, publish-only.
- Reason: Stable shared formatting without a template language or event archive.
- Impact: Event custom messages / JSONL / LLM admission out of scope.

**Module shape**
- From: Scattered top-level sanitize/formatter/view/render/resources modules as architecture.
- To: `types` + `message` + `service` + `assets` + internal `utils/`; single-use helpers inlined; no public free-function export surface for transforms.
- Reason: Cohesion and a thin public API.

## Capabilities

### New Capabilities
- `platform-message-ingestion`: Versionless message model, element normalization, adapter prepare + ImagePrepareSink, fixed special-reference handling, AssetStore boundary.
- `platform-message-formatting`: Fixed core envelope and local-only element/image projection.
- `platform-event-contract`: Typed, frozen, publish-only events without Facts/templates.

### Modified Capabilities
- `core-runtime-integration`: FIFO per-channel preparation before storage; reset order-safe; single adapter refine/prepare path.
- `onebot-utils`: Sanitized paginated text-only forward tool output.

## Impact

- Affected code: `core/src/platform/`, `core/src/runtime/`, `core/src/service.ts`, channel asset/storage helpers, public platform types, tests.
- Affected plugins: `plugins/platform-onebot/`, `plugins/onebot-utils/`, consumers of public platform messages/events.
- Data: Existing channel JSONL incompatible. New history holds sealed message meta + elements encoding; events do not enter agent storage.
- Dependencies: No runtime dependency, global resource manager, generic reader registry, template engine, or event archive.
