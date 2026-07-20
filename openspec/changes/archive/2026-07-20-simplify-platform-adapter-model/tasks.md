## 1. Platform Fact and Adapter Contracts

- [x] 1.1 Replace legacy Platform message/event/resource/view types with pure-data `Platform.Message` (`elements: Element[]`), Event, Sender, PlatformEventVariants, flat Adapter (`id`/`platform`/`adapter`/`profile` + `adapt` + `prepare`), `PrepareContext`, and `ImagePrepareSink`; remove runtime fact schema and extension/reader/event-definition registries.
- [x] 1.2 Simplify Session normalization to draft Message/Event + single refiner, publish-only event dispatch, and single-source `receivedAt` without runtime fact validation.

## 2. Element Normalization and Core Projection

- [x] 2.1 Implement element allowlist normalization in `message` module (and internal `utils/elements` only if shared): forward → `<forward id summary>`, quote → `<quote id>`, image/file states, unwrap unknown/components.
- [x] 2.2 Implement fixed core envelope + local-only image projection inside service/message helpers (no public top-level formatter/sanitize modules); remove legacy template/Fact/EventView/stored-presentation paths.

## 3. Image Preparation and Platform Integration

- [x] 3.1 Replace Reader/Snapshot preparation with adapter `prepare(ctx)` returning `Element[] | void`, core default unavailable fallback, `ImagePrepareSink` over AssetStore, and fixed image budgets.
- [x] 3.2 Move OneBot image acquisition into `prepare`, retain synchronous reaction-event adaptation, remove OneBot readers/deep-forward resolution.

## 4. Ordered Channel Lifecycle

- [x] 4.1 Serialize per-channel route, preparation, asset commit, and initial runtime submission in FIFO order; enqueue reset in the same lifecycle and preserve turn-stream concurrency.
- [x] 4.2 Remove obsolete platform resource/presentation modules, exports, configuration, and tests made unreachable by the new lifecycle; keep public index exports thin.

## 5. OneBot Explicit Forward Access

- [x] 5.1 Replace raw `onebot_get_forward_message` output with the sanitized, bounded, paginated text-only forward contract (prefer reusing element transforms).

## 6. Verification and Migration Coverage

- [x] 6.1 Rewrite focused core and OneBot tests for element message contract, `<forward>` normalization, ImagePrepareSink prepare path, publish-only events, forward tool, FIFO reset ordering, and destructive legacy-data boundary.
- [x] 6.2 Run package-scoped typecheck, build, and focused test suites; resolve regressions and document the destructive history-reset upgrade behavior.
