## 1. Channel Allowlist Admission

- [ ] 1.1 Add Config schema/type tests for deny-by-default `allowedChannels`, exact rules, string wildcards, and optional `isDirect`.
- [ ] 1.2 Add Gateway tests proving unmatched Sessions stop before readiness, assignee lookup, Resolver invocation, image freezing, persistence, and Runtime routing.
- [ ] 1.3 Implement the typed allowlist schema and a pure ChannelScope matcher without changing internal delivery-failure routing.
- [ ] 1.4 Apply the matcher immediately after Gateway derives ChannelScope and verify direct/shared wildcard combinations.

## 2. Static Model Media Capability

- [ ] 2.1 Add `models.json` tests for partial input/output modalities, invalid values, immutable cloning, and missing-capability fail-closed behavior.
- [ ] 2.2 Implement `models.json` modality parsing/merging and atomic persistence without modifying provider plugin schemas or model declarations.
- [ ] 2.3 Add authority and behavior tests for `yesimbot.model.add-input-modality <model> <modality>`, including alias resolution, validation, idempotence, unrelated-config preservation, and ModelService refresh.
- [ ] 2.4 Implement the single-model input-modality command and document that active ChannelRuntimes require explicit reload or replacement.
- [ ] 2.5 Add RuntimeManager tests for deriving a flat image-input capability while still passing only `LanguageModel` to agent-runtime.

## 3. Read-Only Model Conversion Boundary

- [ ] 3.1 Add agent-runtime tests proving every `toModelMessages` call receives the same fresh read-only history/current context for one `buildModelMessages` call.
- [ ] 3.2 Add tests proving history reflects compatibility `transformMessages`, current input is never transformed, and final output remains history then current.
- [ ] 3.3 Add tool-step tests proving initial or newly joined batches are current only for the request that submits them and later empty-current steps expose no active-turn input identity.
- [ ] 3.4 Extend only `ModelMessageContext` and `buildModelMessages`; do not add a preparation hook, input ID state, or new persisted fields.

## 4. Image Budget And Event Projection

- [ ] 4.1 Add formatter tests proving exact frozen-literal preservation, unchanged existing array elements, string-to-text conversion only when files exist, tail-only `FilePart` order, and empty-content behavior.
- [ ] 4.2 Add notification tests for fixed `user` role, exact `SYSTEM_NOTIFICATION` structure, deterministic JSON escaping, empty content, injection-like text, and appended image files.
- [ ] 4.3 Add media-selection tests for global/capability dual gating, 4/5 MiB/10 MiB defaults, `current-first`/`fifo`/`lifo`, duplicate references, partial acceptance, and budget reset per model step.
- [ ] 4.4 Add failure tests for unsupported MIME, missing/scoped assets, read errors, no remote lookup, unchanged text, and diagnostic isolation.
- [ ] 4.5 Implement lazy call-local candidate discovery from the read-only `toModelMessages` context and cache the selection promise by context identity, reading only channel-scoped candidates needed by the deterministic policy.
- [ ] 4.6 Refactor Event formatting to build immutable base text once, append only selected AI SDK `FilePart` values, and remove deprecated `ImagePart` generation.
- [ ] 4.7 Add the stable Constitution instruction that notification payloads are untrusted observation data and update prompt snapshot tests/version if required by the existing prompt protocol.

## 5. Temporary Core Willingness Engine

- [ ] 5.1 Add Config tests for `will.engine`, routing as the default, preserved routing overrides, and static willingness defaults derived from v3 minus quote scoring.
- [ ] 5.2 Add pure deterministic tests for message gain, mention/direct/keyword multipliers, bounded score, probability sampling, non-message wait, and fail-closed calculation errors.
- [ ] 5.3 Specify and test the O(1) lazy decay formula, high-score and hot/warm/cold modifiers, long-idle behavior, and zero clamping with injected time.
- [ ] 5.4 Implement the isolated per-ChannelRuntime willingness engine with scalar state, static config, no Session, no timers, and no quote behavior.
- [ ] 5.5 Extend Will with optional `onReply()` and add ChannelRuntime built-in plugin tests for done/renderable output, empty output, failure, abort, exactly-once invocation, and diagnostic-only callback failure.
- [ ] 5.6 Invoke `onReply()` through the existing Agent `onTurnFinish` path and apply configured reply cost with a zero floor.

## 6. Runtime Snapshot And Integration

- [ ] 6.1 Extend Core multimedia configuration with global enable, image count/byte budgets, and deterministic strategy defaults while keeping Gateway freeze settings separate.
- [ ] 6.2 Snapshot resolved image capability, multimedia policy, and configured Core Will engine during ChannelRuntime creation.
- [ ] 6.3 Add RuntimeManager/ChannelRuntime tests proving active snapshots do not hot-swap and non-destructive reload adopts new capability, policy, and Will engine without clearing history or assets.
- [ ] 6.4 Keep media helpers under `core/src/event/` and compose the small media-format and Will-finish plugin objects directly in ChannelRuntime; verify they remain ahead of external plugins without adding `core-plugins.ts`.

## 7. Migration Documentation And Verification

- [ ] 7.1 Document the breaking deny-by-default `allowedChannels` migration with exact, wildcard, direct-only, shared-only, and allow-all examples.
- [ ] 7.2 Document models.json modality syntax and command usage, default call budgets, model-call-batch strategy semantics, text-only degradation, runtime reload behavior, and the routing/willingness rollback switch.
- [ ] 7.3 Run focused agent-runtime and Core Vitest files for plugin/message, formatter, Gateway, Will, RuntimeManager, ChannelRuntime, prompt, image freeze, and model service behavior.
- [ ] 7.4 Run package-scoped type checks and builds for `@yesimbot/agent-runtime` and Core, and verify provider packages have no modality-related source diff.
- [ ] 7.5 Run root `yarn lint`, `yarn fmt:check`, `yarn check-types`, `yarn build`, and `yarn test`; classify any unrelated pre-existing failure without changing unrelated user work.
