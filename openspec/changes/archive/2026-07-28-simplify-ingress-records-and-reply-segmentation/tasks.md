## 1. Redefine Host-Owned Ingress Types

- [x] 1.1 Replace `MessageData extends Universal.Event` with a closed `MessageRecord` and closed message custom payload shape in `core/src/event`.
- [x] 1.2 Introduce a closed `EventBase` plus `EventRecord<K> = EventBase & { eventType: K } & EventMap[K]` while preserving declaration merge for variant fields.
- [x] 1.3 Update `createMessage`, `createEvent`, `createInput`, and related type guards to use the new host-owned message/event shapes without inherited `Universal.Event` resources.

## 2. Move Final Record Assembly Into Gateway

- [x] 2.1 Remove `ResolveContext.base` and replace resolver output with smaller host-defined message and event drafts.
- [x] 2.2 Refactor Gateway fallback message assembly so it constructs the final `MessageRecord` from an explicit whitelist and never spreads `session.event` residue.
- [x] 2.3 Refactor resolver-backed ingress assembly so Gateway normalizes drafts into final `MessageRecord` or `EventRecord` before persistence and runtime routing.
- [x] 2.4 Add negative tests proving `_data`, `_type`, `sn`, `login`, `referrer`, `guild`, `member`, and similar platform residue no longer persist through either fallback or resolver paths.

## 3. Update Event Variants And Runtime Consumers

- [x] 3.1 Rewrite platform event resolvers such as OneBot poke and message-reactions-updated to emit the new flat `EventRecord` variants without inherited `Universal.Event` shells.
- [x] 3.2 Keep non-message model projection minimal by updating formatter and runtime tests to assert the `eventType + text` wrapper contract only.
- [x] 3.3 Update committed-input observation tests and any `yesimbot/event` listeners to assert the new message/event payload shapes rather than inherited resource fields.

## 4. Simplify Reply Control Parsing

- [x] 4.1 Replace the current four-control OCL grammar with a smaller reply-control parser that recognizes only `inner_thought` and `sep`.
- [x] 4.2 Remove `skip`, `sleep`, and `mergeExcessSegments`, and keep guardrails limited to normalization, bounded segment count, and degrade-to-one-message behavior.
- [x] 4.3 Rework parser internals to use Koishi element parsing/transformation helpers where they simplify literal-text handling and control stripping.
- [x] 4.4 Update reply parser and runtime tests so they cover `inner_thought`, explicit segmentation, literal escaped controls, and failure degradation without any `skip` or `sleep` cases.

## 5. Reconcile Runtime, Delivery, And Verification

- [x] 5.1 Update `ChannelRuntime` output planning and delivery metadata so the runtime no longer depends on removed `skip`/`sleep` semantics.
- [x] 5.2 Keep Gateway delivery pacing host-owned and verify unchanged behavior for ordinary single-message replies and segmented replies without model-authored sleep hints.
- [x] 5.3 Run targeted typecheck and test coverage for gateway ingress, event formatting, OneBot event resolution, reply parsing, channel runtime delivery, and JSONL persistence boundaries.
