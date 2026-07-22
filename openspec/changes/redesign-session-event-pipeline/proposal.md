## Why

Athena's current platform path duplicates parts of Koishi, keeps Session-linked state across multiple processing stages, and splits one message lifecycle across `PlatformService`, a cross-channel `ChannelRuntime`, and `DeliveryService`. The result is a wide interface with hidden ordering rules, no durable feedback when passive replies fail, and no stable seam for a future Will system. This change replaces that structure with a Session edge, normalized Satori-shaped events, per-channel runtimes, and explicit delivery feedback.

## What Changes

**Session and platform handling**
- From: `PlatformService` selects flat adapters, caches Session state, refines messages, prepares resources, publishes events, projects model messages, and owns channel assets.
- To: `SessionGateway` owns one per-platform `SessionResolver`, Satori fallback, resource freezing, passive Session delivery, and delivery-failure reinjection.
- Reason: Session-specific work must stay at the Koishi edge and complete before persistence.
- Impact: Breaking. `ctx.yesimbot.platform`, `Platform.*` message abstractions, and the old adapter contract are removed.

**Event and channel execution**
- From: messages use `ignore | append | reply`, non-message events are publish-only, and one `ChannelRuntime` manages all cached channels.
- To: accepted messages and non-message events become structured Satori-shaped `EventRecord` custom messages; `RuntimeManager` owns one `ChannelRuntime` per channel; each channel persists the record before a per-channel Will chooses `wait | trigger`.
- Reason: fact retention and turn triggering need separate, replaceable decisions.
- Impact: Breaking. Channel storage records and runtime ownership change.

**Output and delivery feedback**
- From: core waits for a turn to finish, sends accumulated outputs through `DeliveryService`, and only logs failed passive delivery.
- To: complete assistant messages become message-level outbound events as soon as they are appended; `SessionGateway` sends each one through `Session.send()` and persists `delivery.failed` when a send rejects.
- Reason: users should receive complete responses promptly, and future model context must reflect platform delivery failures.
- Impact: Breaking. `ctx.yesimbot.delivery` and delivery listeners are removed.

**Public extension surface**
- Add `ctx.yesimbot.registerSessionResolver()` for one resolver per Koishi platform.
- Add `ctx.yesimbot.registerWillFactory()` for one replaceable per-channel Will implementation.
- Keep Agent plugin registration and the reset facade without exposing Gateway, RuntimeManager, ChannelRuntime, AssetStore, or submit internals.

## Capabilities

### New Capabilities
- `channel-will-evaluation`: Defines per-channel Will instances, read-only channel state, `wait | trigger` decisions, and the default routing implementation.

### Modified Capabilities
- `platform-message-ingestion`: Replaces flat adapter refinement and Session caching with `SessionGateway`, one `SessionResolver` per platform, Satori fallback, and atomic resource freezing.
- `platform-event-contract`: Replaces publish-only platform events with accepted Satori-shaped runtime events persisted as channel EventRecords and observed through typed Koishi events.
- `platform-message-formatting`: Projects all persisted EventRecords from local structured facts plus optional frozen content while preserving the fixed core envelope.
- `core-runtime-integration`: Replaces the cross-channel ChannelRuntime with RuntimeManager plus one ChannelRuntime per channel and defines persistence, Will, busy-turn, output, reset, and stop ordering.
- `message-delivery`: Removes DeliveryService, adds message-level passive output, structured active-send tool receipts, and durable passive `delivery.failed` feedback.

## Impact

- Core runtime, platform, delivery, storage projection, service facade, and channel lifecycle code will change.
- Platform plugins must replace `Platform.Adapter` registration with `SessionResolver` registration.
- Optional Will plugins may replace `DefaultWill` through one `WillFactory` registration.
- Existing platform and delivery public APIs will be removed.
- Existing channel JSONL files will not be read by the new format.
- OneBot event refinement and message-operation integrations must migrate to the new runtime event and resolver types.
- No new external runtime dependency or platform transport abstraction is introduced.
