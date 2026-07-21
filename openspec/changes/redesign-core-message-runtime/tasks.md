## 1. Canonical Message and Routing Policy

- [ ] 1.1 Add required `scope.channelType` data to `Platform.Message` and `Platform.MessageRecord`, capture it from the real Session accessor during drafting, and add draft/record round-trip regression tests that reject records without the field.
- [ ] 1.2 Refactor self, mention, scope, and classification logic to read only canonical `Platform.Message` data, add root direct/mention/group scenario-to-action configuration, and replace plain Session routing tests with message-based policy tests.

## 2. Koishi-First Delivery

- [ ] 2.1 Add `DeliveryService` passive `reply()` and target `send()` operations over Koishi Session/Bot primitives, including ordered fragment submission and conservative `sent`/`partial`/`failed` receipts that preserve returned message ID arrays.
- [ ] 2.2 Add process-local delivery status subscription, listener failure isolation, normalized diagnostics, and focused tests for status order, target resolution, partial failure, missing IDs, and non-recursive error delivery.

## 3. Channel Runtime Ownership

- [ ] 3.1 Create `ChannelRuntime` with channel-key derivation, per-channel FIFO, Agent creation/cache, deterministic classification, preparation, and atomic append/join/run submission; cover same-channel ordering, cross-channel parallelism, and post-prepare busy decisions.
- [ ] 3.2 Move turn stream ownership, assistant output projection, DeliveryService integration, joined-turn behavior, and reply-versus-append error handling into `ChannelRuntime`; verify one stream consumer and one logical delivery per run.
- [ ] 3.3 Move channel reset and global stop behavior into `ChannelRuntime`, preserve `interrupt -> stop -> storage clear -> asset clear -> cache delete`, wait for owned streams on stop, and retain persisted history/assets during disposal.

## 4. Core Service Integration and Verification

- [ ] 4.1 Wire deterministic routing configuration into `ChannelRuntime`, reduce `YesImBotService` to Koishi composition and delegation, and remove reconstructed Session routing plus direct runtime `session.send()` orchestration.
- [ ] 4.2 Update core integration tests to exercise `ChannelRuntime.handle/reset/stop` and `DeliveryService.reply/send/subscribe`, remove tests coupled to deleted helper call order, and run OpenSpec validation, formatting, type checks, build, and the complete core test suite.
