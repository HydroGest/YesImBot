# Schedule — Brainstorm Capture

## Context

YesImBot Core already provides a complete, trusted, Session-free proactive trigger path:

```
ctx.yesimbot.trigger(event)
  -> RuntimeManager.trigger(event)
  -> ChannelRuntime.trigger(event)
  -> append JSONL + emit yesimbot/event
  -> force idle run or join an active turn
  -> YesImBotService delivers through the exact matching Bot
```

`ChannelRuntime.trigger()` enters the normal per-channel FIFO, persists the EventRecord, publishes the existing observer event, bypasses Will, and preserves single-output-consumer semantics. RuntimeManager and ChannelRuntime do not retain Session references. The trigger facade resolves the exact current Bot before admitting the event, and Core drains admitted proactive triggers during stop.

Schedule must validate this path by causing a complete Agent turn without a new inbound user message. It must not introduce a second channel identity, a synthetic Session, a separate Agent input model, a public RuntimeManager API, a general workflow engine, or a distributed scheduler.

## Decisions

### 1. Schedule is an optional plugin, not Core

Create `koishi-plugin-yesimbot-schedule` under `plugins/schedule/`. Core remains unchanged except that the plugin declaration-merges the existing exported EventMap with its `schedule.due` variant. The plugin reuses the confirmed `getStoragePath()`/AgentPlugin/trigger seams where appropriate, but does not add a Core scheduler facade or expose Core internals.

The rejected alternatives were:

- An AgentPlugin-only timer, because a missing runtime or process restart would prevent autonomous execution.
- A Core-owned scheduler, because it would expand Core's storage, configuration, lifecycle, and public responsibility beyond the verified trigger seam.

### 2. A Schedule belongs to one existing ChannelScope

A Schedule is a persisted future-trigger rule attached to the existing raw ChannelScope. There is no ChannelKey, channel identity wrapper, scheduler-specific context, or target-channel parameter for Agent tools.

A record contains an id, title, prompt, `kind` (`once` or `cron`), `at` for one-time tasks or five-field `cron` for recurring tasks, lifecycle state, next execution time, the latest submission result, and audit timestamps.

- `enabled`: eligible for scheduling.
- `paused`: retained but has no armed next execution.
- `cancelled`: permanently removed from future scheduling but retained for inspection.
- `completed`: terminal state for a one-time task after acceptance, failure, or a missed occurrence.

### 3. Time is deliberately simple

One-time tasks use an RFC 3339 absolute instant. Recurring tasks use a five-field cron expression. Natural-language time remains a conversational concern: the Agent must normalize it to one of these forms and ask for clarification when date or recurrence is ambiguous.

Schedule has no persisted timezone field and no timezone configuration. Cron and natural-language time are interpreted in the fixed `Asia/Shanghai` convention already used by Core's message formatter. The fixed value is an internal implementation constant, not a tool parameter or user configuration.

### 4. Do not catch up missed work

When the process is offline, stopped, or cannot run at an occurrence:

- A one-time task records `missed` and becomes `completed`.
- A cron task records one `missed` result and advances directly to its first future occurrence.

No past occurrence is replayed. This prevents long downtime from becoming a burst of model calls and outbound messages.

### 5. Agent autonomy and command administration are intentionally uncomplicated

The Agent may autonomously create, list, update, pause, resume, and cancel schedules for its current channel. Its tools do not accept a target ChannelScope or a target channel id.

Administrators receive a `yesimbot.schedule` command family with `authority: 4`, matching the existing reset command convention. The command derives the current scope from its active Session only for the immediate operation and never retains that Session.

The first version does not expose a general schedule-registration interface for other plugins. A trusted plugin can already use the confirmed Core trigger facade for one-off proactive work; a cross-plugin recurring scheduler registry has no demonstrated requirement.

### 6. Persist schedules in one Minato table

Use a plugin-owned `yesimbot_schedule` table as the sole source of truth. Store `type`, `platform`, `selfId`, and `channelId` as the raw scope columns together with the Schedule fields.

A channel-root-only file cannot recover all schedules after restart because Core intentionally exposes no channel enumeration API; introducing a second global index would create dual-source consistency work. The database table supports startup discovery by `state` and `nextRunAt` without adding `listChannels()` to Core.

The table does not replace Agent JSONL. A real due occurrence is still submitted as a normal `schedule.due` EventRecord and is persisted in that channel's `sessions/messages.jsonl` by the existing Agent pipeline. The schedule table holds only future rules and the latest scheduling outcome, not model output or delivery history.

Reset preserves schedules, like other plugin-owned data; it clears only Core sessions and assets. Stop preserves schedules and prevents new scheduler admission after plugin shutdown.

### 7. Fold the durable claim into lastResult

A standalone `claimedFor` field was initially proposed to identify an occurrence durably acquired before `trigger()`. Its purpose was to prevent duplicate submission from duplicate timer wake-ups, concurrent dispatch, or a crash after trigger submission but before result persistence.

That field is redundant. Use the latest result itself as the durable claim:

```ts
type LastResult = {
  occurrenceAt: string
  status: "submitting" | "accepted" | "failed" | "missed" | "interrupted"
  finishedAt?: string
  error?: { name: string; message: string }
}
```

Before calling Core trigger, the Store serially verifies that the task is still enabled for the expected `nextRunAt`, writes `status: "submitting"`, and advances the next cron occurrence or completes the one-time task. The caller then invokes `trigger()`.

On normal resolution the result becomes `accepted`; a rejection becomes `failed`. On restart, a past `submitting` result becomes `interrupted` and is not retried. This gives deliberate at-most-once submission semantics for one Koishi process without pretending to provide a distributed lock.

### 8. Due execution reuses EventRecord and FIFO

At due time, the plugin reconstructs the target EventRecord from its stored raw scope fields:

```ts
{
  eventType: "schedule.due",
  platform,
  selfId,
  timestamp: Date.now(),
  channel: { id: channelId, type },
  text: /* untrusted schedule notification */,
  schedule: { id, title, kind, scheduledFor }
}
```

The default model projection remains the existing untrusted event wrapper and sees only the event type and text. The structured `schedule` extension is available to Core observers and Agent plugins, not projected by default.

The scheduler neither caches a runtime nor directly sends a message. RuntimeManager creates or selects the current channel runtime. An idle runtime creates a turn; a busy runtime joins the existing turn. A missing Bot, stopped runtime, or failed model turn records `failed` and is not retried. Existing `delivery.failed` events remain the detailed delivery record; an `accepted` trigger result does not promise delivery success.

### 9. Bound resource use and prevent self-trigger storms

The proposed plugin defaults are:

| Limit | Default |
| --- | ---: |
| Enabled schedules per channel | 20 |
| Minimum cron interval | 15 minutes |
| Concurrent trigger calls | 5 |
| Title length | 120 characters |
| Prompt length | 2000 characters |

Invalid or past one-time timestamps, invalid cron rules, over-frequent cron rules, mutually supplied `at` and `cron`, and exceeded limits fail before any record is written.

The scheduler has no delayed backlog. If no global trigger slot is available when an occurrence is due, it records that occurrence as `missed` and advances normally. It does not reschedule based on Agent output, event observers, or delivery failure. The plugin adds no independent model timeout, output truncation, or send path: Core owns turns, output consumption, delivery pacing, interruption, and stop.

### 10. Test production code through standard fake timers

Production code directly uses `Date.now()`, `setTimeout()`, `clearTimeout()`, and the cron library's ordinary APIs. Do not introduce a Clock interface, constructor parameter, wrapper, or test-only abstraction into production code.

Tests use the repository's established Vitest process-level fake timer convention:

```ts
vi.useFakeTimers()
vi.setSystemTime(...)
await vi.advanceTimersByTimeAsync(...)
```

Required coverage:

1. A one-time task triggers a complete Agent turn and Bot delivery with no new inbound message.
2. Cron computes successive future occurrences in the fixed timezone.
3. Pause, resume, and cancellation prevent the correct future submissions.
4. Restart recovery retains future work and records missed work without catch-up.
5. A due event shares the target runtime FIFO and joins a busy turn without a second output consumer.
6. Runtime absence, reset, plugin stop, and Core stop preserve their existing lifecycle semantics.
7. Missing Bot, failed model turn, and delivery failure retain the documented outcome behavior.
8. Duplicate timer wake-ups and recovery from a persisted `submitting` result do not re-submit one occurrence.
9. Invalid inputs and every limit return a deterministic failure without an Agent turn.

## Scope Check

The work is intentionally limited to persistent once/cron schedules as a proof carrier for the proactive trigger path. It excludes cross-channel control, plugin scheduling registries, natural-language parser infrastructure, retry/backoff, delivery history, task dependency graphs, distributed scheduling, old-data migration, Session retention, and implementation work.
