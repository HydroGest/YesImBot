## 1. Reply Parsing On Koishi Elements

- [x] 1.1 Rewrite `core/src/reply/parse.ts` as `parseReply(raw: string): Element[][]` running the fixed five-stage pipeline (extract `<raw>` regions with a per-parse nonce, `h.parse()` the remainder, discard `<inner_thought>` subtrees, partition on `<sep/>`, restore captured raw substrings into text nodes), deleting `ReplyPlan`, `ReplyDegradation`, `findProtectedRanges`, `isProtected`, `findControls`, `splitVisibleSegments`, `degradedReply`, `stripControls`, `hasRecognizedControl`, `unescapeControlText`, and `PROTECTED_LITERAL`.
- [x] 1.2 Remove `reply.segmentation` from `core/src/config.ts`: the `ReplySegmentationConfig` interface, `DEFAULT_REPLY_SEGMENTATION_CONFIG`, the `Config["reply"]["segmentation"]` field, and its Koishi Schema block.
- [x] 1.3 Update `core/src/runtime/index.ts` so `parseAssistantContent` returns `Element[][]`, `ChannelOutput.segments` carries `readonly Element[][]`, and every `maxSegments` field, constructor option, and call argument is deleted.
- [x] 1.4 Update `core/src/gateway/index.ts` to send structured segments through `session.send(segment)` instead of `session.send(segment.text)`.
- [x] 1.5 Rewrite `core/tests/ocl.test.ts` against element segments, covering raw byte fidelity, markup-like text inside `<raw>`, an unterminated `<raw>`, a forged nonce placeholder, `<at>` passthrough, entity `&lt;sep/&gt;`, inner-thought removal, and empty-segment trimming.

## 2. Prompt Resources And The `<raw>` Instruction

- [x] 2.1 Create `core/resources/constitution.md` and `core/resources/athena-persona.md` holding the prose currently inside `core/src/runtime/prompts/constitution.ts` and `core/src/runtime/prompts/athena.ts`.
- [x] 2.2 Add the `<raw>` control-element instruction to `core/resources/constitution.md` and bump `CORE_CONSTITUTION_VERSION` to 3.
- [x] 2.3 Replace `core/src/runtime/prompts/constitution.ts` and `athena.ts` with a resource loader that reads the packaged Markdown files, keeping `CORE_CONSTITUTION_VERSION` in TypeScript and holding zero prose.
- [x] 2.4 Add `resources` to `core/package.json` `files`, then verify the loader resolves correctly from both `dist/index.js` (ESM) and `dist/index.cjs` (CJS) after a real build.
- [x] 2.5 Update `core/tests/prompt.test.ts` for the resource-backed constitution and persona, including a missing-resource failure case.

## 3. Sealed Elements As The Single Source Of Truth

- [x] 3.1 In `core/src/event/index.ts`, remove `text` from `MessageRecord` and `ResolvedMessageDraft`, keep `EventBase.text`, and bump the `schemaVersion` literal from `2` to `3` on both `MessageRecord` and `EventBase`.
- [x] 3.2 In `core/src/gateway/index.ts`, persist sealed elements in both the Satori fallback and resolver paths, reduce sealing to one `sealElements(...)` call site per path, remove the redundant outer `normalizeElements`, and delete both `text` derivations.
- [x] 3.3 In `core/src/event/formatter.ts`, render message text from `data.elements` at projection time instead of reading `data.text`.
- [x] 3.4 In `core/src/media/index.ts`, discover asset ids by walking `data.elements` in document order including nested children, and delete `imageAssetIds` with its `h.normalize` text round trip.
- [x] 3.5 In `core/src/will/`, match interest keywords against text joined from element text nodes, and keep exactly one `isSelfMention` implementation.
- [x] 3.6 In `core/src/platforms/onebot/index.ts`, stop supplying `text` on the resolved message draft and delete its local text derivation.
- [x] 3.7 Update every affected test fixture and assertion in `core/tests/` (`event`, `formatter`, `gateway`, `gateway-delivery`, `channel-runtime`, `runtime-manager`, `will`, `storage`, `platform/onebot`) to construct records without `text` and to assert sealed persisted elements.

## 4. Pacing Reduced To Two Knobs

- [x] 4.1 Rewrite `core/src/reply/pacing.ts` with `PacingInput = { text, consumedDeliveryMs, config }`, a single `charactersPerSecond` rate over all visible characters, module constants for minimum delay, per-segment ceiling, and jitter range, deleting `PacingLimits`, `normalizeLimits`, `nonNegative`, `positive`, `residualDelayMs`, the CJK/Latin split, and the first-segment compensation branch.
- [x] 4.2 Reduce the `reply.pacing` interface, defaults, and Koishi Schema in `core/src/config.ts` to `charactersPerSecond` and `maxTotalDelayMs`.
- [x] 4.3 Update `core/src/gateway/index.ts` to derive the segment's visible text from its elements and to stop passing `isFirst` and `elapsedGenerationMs`.
- [x] 4.4 Rewrite `core/tests/pacing.test.ts` to assert delay bounds, monotonicity in character count, identical treatment of the first segment, and minimum spacing without dropped segments once the total ceiling is reached.

## 5. Validation At The Two Trust Boundaries

- [x] 5.1 Delete `isRecord`, `hasScope`, and `containsReference` from `core/src/gateway/index.ts` together with their admission branch.
- [x] 5.2 Add zod read-back validation to `core/src/runtime/storage.ts` so `createJsonlStorage().read()` validates `yesimbot.message` and `yesimbot.event` payloads once and fails loudly, passing other entries through unchanged.
- [x] 5.3 Narrow `isMessage` and `isEvent` in `core/src/event/index.ts` to the read-back path, and make model projection discriminate on the custom message `type` instead of re-checking fields.
- [x] 5.4 Add a test asserting no `Session` reference survives into a persisted record, replacing the deleted runtime traversal.
- [x] 5.5 Add tests in `core/tests/jsonl-storage.test.ts` proving a malformed stored record throws on read-back and a valid one round-trips.

## 6. Delivery Acknowledgement And Willingness Construction

- [x] 6.1 In `core/src/runtime/index.ts`, replace `ReplyCompletion` and `ReplyEligibility` with a set of acknowledged turn ids that calls `will.onReply()` at most once per turn, and delete `hasRenderableSegment`, `recordReplyCompletion`, `reconcileReplyCompletion`, `replyCompletions`, `replyCompletionTail`, and `enqueueReplyCompletion`.
- [x] 6.2 In `core/src/will/willingness.ts`, call `assertValidConfig` exactly once from the constructor, remove it from `decide()`, `onReply()`, and `decayScore()`, and stop exporting `decayScore` from both `willingness.ts` and `will/index.ts`.
- [x] 6.3 Update `core/tests/will.test.ts` to exercise decay through the public engine interface without importing `decayScore`, and update the delivery-completion assertions in `core/tests/channel-runtime.test.ts` and `core/tests/gateway-delivery.test.ts`.

## 7. Runtime Module Split

- [x] 7.1 Extract one `serialQueue` helper and use it for per-identity lifecycle, per-channel input handling, and delivery bookkeeping, deleting the duplicated `enqueue` and `enqueueLifecycle` chains.
- [x] 7.2 Create `core/src/runtime/delivery.ts` owning `OutputQueue`, delivery leases, abort signals, and the acknowledged-turn set.
- [x] 7.3 Create `core/src/runtime/channel.ts` owning `ChannelRuntime`: the channel FIFO, Agent assembly, prompt and plugin composition, stream consumption, and drain/stop.
- [x] 7.4 Create `core/src/runtime/manager.ts` owning `RuntimeManager`, and reduce `core/src/runtime/index.ts` to a barrel preserving the current import surface.
- [x] 7.5 Delete the `createChannelRuntime` option from `RuntimeManagerOptions` and rewrite `core/tests/runtime-manager.test.ts` to construct real `ChannelRuntime` instances.

## 8. Model Module Consolidation

- [ ] 8.1 Merge `core/src/model/` into `service.ts` and `provider.ts`, folding in `config.ts`, `schema.ts`, and `types.ts`.
- [ ] 8.2 Delete `isModelId`, `EmbeddingModelRef`, `ProviderPluginOptions`, and the single-shape `ModelProvider` / `ModelProviderCapabilities` interfaces.
- [ ] 8.3 Complete `core/src/model/index.ts` as the single entry point and rewrite `core/tests/model.test.ts` to import through it instead of deep paths.
- [ ] 8.4 Verify all four packages under `providers/` still type-check and build against the unchanged `koishi-plugin-yesimbot/model` surface.

## 9. Remaining Housekeeping And Documentation

- [ ] 9.1 Convert `createImageFreezer` in `core/src/media/index.ts` to a class owning `imageCount`, `totalBytes`, `active`, and the waiting queue.
- [ ] 9.2 Delete the unreachable second `return` in `reportAssetFailure` in `core/src/media/index.ts`.
- [ ] 9.3 Delete `core/src/path.ts` and inline its `isAbsolute`/`resolve` logic at its three call sites in `model/service.ts`, `runtime/`, and `service.ts`.
- [ ] 9.4 Correct `AGENTS.md`: remove the `platforms/*` package layout and `plugins/sticker` rows, state that the OneBot adapter lives at `core/src/platforms/onebot/`, restate the split runtime modules, and update the persisted message-field description.
- [ ] 9.5 Update `core/README.md` for the removed message `text` field, the bumped schema version, and the reduced `reply` configuration surface.
- [ ] 9.6 Run the full pipeline — `yarn lint`, `yarn fmt:check`, `yarn check-types`, `yarn build`, `yarn test` — and record any residual failure.
