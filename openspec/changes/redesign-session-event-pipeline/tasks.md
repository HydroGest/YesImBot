## 1. Establish Channel And Shared Foundations

- [x] 1.1 Introduce `ChannelScope` key/path operations and migrate focused channel tests.
- [x] 1.2 Move `AssetStore` into `core/src/shared/asset.ts` without changing scoped persistence semantics.
- [x] 1.3 Define the shared sealed-element protocol and migrate asset/element limit tests.

## 2. Define The Event Contract

- [x] 2.1 Implement declaration-mergeable `EventMap`, mapped `EventRecord`, and `Event` custom-message helpers.
- [x] 2.2 Add Koishi and agent-runtime type augmentations plus OneBot event-variant extension points.
- [x] 2.3 Cover narrowing, creation, detection, persistence shape, and rejected legacy event types.

## 3. Implement Deterministic Event Formatting

- [x] 3.1 Specify and test fixed time, sender, conditional message-id, and content envelope rules.
- [x] 3.2 Implement local frozen-element projection through one async `formatEvent()` function.
- [x] 3.3 Prove replay formatting performs no platform or network access and reports missing assets diagnostically.

## 4. Implement Will Evaluation

- [x] 4.1 Define `Will.Decision`, `Will.State`, `Will.Factory`, and `DefaultWill` using namespace/interface merging.
- [x] 4.2 Test direct, mention, group, non-message, and delivery-failure routing decisions.
- [x] 4.3 Test typed `yesimbot/will` observations and optional Will shutdown behavior.

## 5. Build The One-Channel Runtime

- [ ] 5.1 Make `Agent.append()` register submitted message entries so the same committed Event can start or join a turn without duplicate persistence.
- [ ] 5.2 Create one-channel storage, prompt, Agent construction, and committed Event append flow.
- [ ] 5.3 Implement persist-before-event-before-Will ordering with `wait`, `join`, and `run` results.
- [ ] 5.4 Consume Agent internal events into ordered complete assistant outputs without exposing Agent internals.
- [ ] 5.5 Add the current-bot active send tool with explicit channel targeting and normalized receipts.

## 6. Build RuntimeManager

- [ ] 6.1 Implement atomic get-or-create routing with one `ChannelRuntime` per channel key.
- [ ] 6.2 Implement Will factory replacement, reset ordering, and global stop coordination.
- [ ] 6.3 Verify same-channel concurrency, cross-channel isolation, failure isolation, and data preservation on stop.

## 7. Build Gateway Ingress And Resource Freezing

- [ ] 7.1 Implement one `SessionResolver` per platform with middleware and `internal/session` entry points.
- [ ] 7.2 Implement atomic resolver selection, Satori message fallback, null admission, and authoritative failure handling.
- [ ] 7.3 Implement bounded `freezeImage()` with MIME, byte, count, timeout, concurrency, asset, unavailable, quote, and forward rules.

## 8. Build Gateway Delivery

- [ ] 8.1 Consume `ChannelRuntime.Output` immediately and preserve Koishi `string[]` send receipts.
- [ ] 8.2 Persist one `delivery.failed` EventRecord per rejected passive output and continue later outputs without recursion.
- [ ] 8.3 Keep all delivery operations internal and verify the public facade exposes no `DeliveryService`.

## 9. Switch Service Composition And Public API

- [ ] 9.1 Compose one `AssetStore`, `RuntimeManager`, and `Gateway` in the top-level YesImBot service.
- [ ] 9.2 Expose only model access, resolver/Will/Agent-plugin registration, reset, and stop with live disposers.
- [ ] 9.3 Replace legacy routing configuration and package subpath exports with the confirmed Will/config surface.

## 10. Migrate OneBot To SessionResolver

- [ ] 10.1 Register `createResolver(ctx)` and preserve generic Satori message bases for supported message Sessions.
- [ ] 10.2 Convert supported non-message events to typed `EventRecord` values and unsupported events to `null`.
- [ ] 10.3 Move OneBot image acquisition behind `ResolveContext.freezeImage()` and pass focused tests and type checks.

## 11. Migrate Plugins And Core Imports

- [ ] 11.1 Change `AgentPluginFactory` context consumers from platform wrappers to `{ channel, bot }`.
- [ ] 11.2 Migrate optional plugins while preserving message-id capabilities and existing tool behavior.
- [ ] 11.3 Update providers and core imports to the confirmed root public contracts and internal module paths.

## 12. Remove Legacy Runtime Boundaries

- [ ] 12.1 Delete PlatformService, DeliveryService, the cross-channel ChannelRuntime, extension placeholders, and legacy shared/runtime modules.
- [ ] 12.2 Remove obsolete tests and compatibility exports without adding legacy readers or adapter shims.
- [ ] 12.3 Run package-wide type checks and prove no removed symbol or subpath import remains.

## 13. Complete Cross-Module Behavioral Coverage

- [ ] 13.1 Cover reset/stop races, admission closure, active-send isolation, Will/Agent failure isolation, and output termination.
- [ ] 13.2 Cover passive failure reinjection, ordered continuation, JSONL reload, and local-only replay.
- [ ] 13.3 Cover the clean break from legacy Platform.Message records and run the focused core/OneBot suites.

## 14. Run Final Verification

- [ ] 14.1 Validate OpenSpec strictly and run formatting checks.
- [ ] 14.2 Run lint, type checks, build, and tests in repository CI order.
- [ ] 14.3 Inspect exports, source-tree boundaries, generated-output handling, and `git diff --check` before marking the change complete.
