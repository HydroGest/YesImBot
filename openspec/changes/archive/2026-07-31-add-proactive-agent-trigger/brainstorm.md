# Proactive Agent Trigger — Brainstorm Capture

## Context

`RuntimeManager.route()` accepts a host-owned record and does not require a live Koishi `Session`. It already provides the persistence, per-channel FIFO, Agent lifecycle, and runtime replacement needed for autonomous work.

The current route result leaves reply delivery to `Gateway`. That works for inbound sessions because Gateway owns `Session.send()`. A host-created record has no Session and therefore needs a Bot-based delivery path.

## Decisions

### Q1. Should an autonomous event follow Will routing?

**Decision: no.** `trigger()` forces a turn when the runtime is idle and joins the active turn when it is busy.

`ChannelRuntime.handle()` calls `WillEngine.decide()` for every record. The routing and willingness engines both return `wait` for a non-message event, so reusing that path cannot produce autonomous replies. A trusted host trigger must append and observe the event while bypassing the Will decision.

### Q2. What is the public input?

**Decision: accept a complete `EventRecord`.**

`ctx.yesimbot.trigger(event: EventRecord): Promise<void>` reuses the existing public, declaration-mergeable event model. The event already holds the target platform, bot identity, channel, timestamp, event type, text, and extension data. A separate scope plus draft would duplicate routing data and create a mismatch path.

The trigger does not accept `MessageRecord`. Message records represent actual user input; a host-created autonomous action is an event.

### Q3. Who consumes generated output?

**Decision: Core consumes it internally and returns `Promise<void>`.**

An output stream has a single-consumer lifecycle. Exposing it to plugins would leak ChannelRuntime mechanics and permit competing delivery loops. `trigger()` resolves after its model turn and delivery handling finish. Plugins can observe the existing `yesimbot/event` event and use AgentPlugin hooks without taking ownership of reply delivery.

### Q4. How does autonomous delivery share Gateway behavior?

**Decision: extract a private delivery function, not a public delivery module or service.**

The function consumes a running result and a sender callback. Gateway supplies `Session.send()`. The autonomous path supplies `Bot.sendMessage(event.channel.id, segment)`. Both paths retain reply pacing, first-success acknowledgement, abort handling, and `delivery.failed` feedback.
`YesImBotService` owns the autonomous Bot sender after RuntimeManager returns the internal run result. RuntimeManager stays responsible for channel runtime lifecycle and scheduling; it does not send platform messages.
The shared helper lives in the private top-level `core/src/delivery.ts` module, so both transport adapters depend on Core delivery rules without making transport a runtime responsibility.

### Q5. Does the autonomous path repeat inbound admission checks?

**Decision: no.**

Allowlist and shared-channel assignee checks protect external Session ingress. `trigger()` is a capability granted to Core and trusted in-process plugins. It does not construct a fake Session or re-run external admission.

### Q6. What model context does a triggered event expose?

**Decision: keep the current event projection.**

The model sees only `eventType` and `text` inside the existing untrusted runtime-event wrapper. Extension fields remain structured runtime data for plugins and observers. Forcing a turn does not grant event text system-instruction authority.

## Agreed Shape

```ts
ctx.yesimbot.trigger<K extends keyof EventMap>(event: EventRecord<K>): Promise<void>
```

The internal flow is:

```text
Core / trusted plugin
  -> YesImBotService.trigger(event)
  -> RuntimeManager.trigger(event)
  -> ChannelRuntime.trigger(event)
  -> append JSONL + emit yesimbot/event + force run or join
  -> YesImBotService uses the private delivery function
  -> Bot.sendMessage(event.channel.id, segment)
```

The inbound flow remains:

```text
Session -> Gateway -> RuntimeManager.route(record) -> private delivery function -> Session.send(segment)
```

## Required Failure Semantics

- Resolve the matching Bot before starting a forced turn. Reject without appending the event when no matching Bot exists.
- A busy runtime joins the active turn and creates no second output consumer.
- A successful Bot send, including an empty message-id array, acknowledges the turn once on its first delivered segment.
- A Bot send failure records `delivery.failed` in the same channel and stops remaining segments.
- A model or turn-stream failure rejects `trigger()` so the caller can own any retry policy.
- Stop and reset keep the existing abort and runtime lifecycle behavior.
