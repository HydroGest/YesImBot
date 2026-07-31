## Why

Core can persist a host-created event through `RuntimeManager.route()`, but both built-in Will engines wait for non-message events. Gateway also owns the only output consumer and relies on a live `Session`. Core and trusted plugins therefore cannot initiate an autonomous Agent turn and deliver its reply to a channel without exposing runtime internals or fabricating a Session.

## What Changes

**Trusted autonomous trigger**
- From: Core accepts resolved Session records through Gateway, and non-message records enter normal Will evaluation.
- To: `ctx.yesimbot.trigger(event: EventRecord)` accepts a trusted, complete host event and forces an idle turn or joins the active turn without evaluating Will.
- Reason: Host work such as schedules and plugin-owned automation needs a Session-free Agent ingress.
- Impact: Additive public facade capability for Core and trusted in-process plugins.

**Autonomous output delivery**
- From: Gateway contains the only delivery loop and sends output through an originating Session.
- To: a private shared delivery function handles pacing, acknowledgement, cancellation, and failure feedback for both Session and Bot senders. `YesImBotService` owns the Bot sender for `trigger()`.
- Reason: A host-created event has no Session while its output must reach its declared channel.
- Impact: Gateway keeps passive Session delivery; RuntimeManager continues to avoid platform sends.

## Capabilities

### New Capabilities
- `proactive-agent-trigger`: Trusted Core and plugin code can force a typed event through a channel runtime and deliver the resulting output through the matching Bot.

### Modified Capabilities
- `core-runtime-integration`: Extend the public Core facade and runtime integration flow for a Session-free, forced event path while preserving RuntimeManager's transport boundary.
- `channel-will-evaluation`: Define forced event handling that appends and observes an event without evaluating or observing Will.
- `ingress-record-boundary`: Define the separate trusted-host EventRecord ingress route alongside Gateway's Session-derived ingress authority.
- `message-delivery`: Reuse delivery semantics for autonomous Bot sends while retaining Gateway ownership of passive Session sends.

## Impact

The change affects `core/src/service.ts`, `core/src/runtime/manager.ts`, `core/src/runtime/channel.ts`, the delivery logic currently in `core/src/gateway.ts`, and a new private `core/src/delivery.ts` module. It adds no dependency, storage layout, or persisted-record migration. Focused Core tests will cover facade access, forced turn behavior, busy joins, Bot delivery, and delivery-failure feedback.
