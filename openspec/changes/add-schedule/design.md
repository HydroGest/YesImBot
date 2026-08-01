## Context

Core has an established trusted-host proactive path. `YesImBotService.trigger()` admits a complete EventRecord only after it finds the exact current Bot, `RuntimeManager.trigger()` selects the channel runtime, and `ChannelRuntime.trigger()` enters the normal channel FIFO, appends the event, emits `yesimbot/event`, and forces an idle run or joins a busy turn without evaluating Will. The service owns Bot-based output delivery; RuntimeManager, ChannelRuntime, Agent history, and JSONL retain no Session.

That path deliberately has no durable source of future work. Schedule supplies one focused source: an optional Koishi plugin that can submit one or recurring event at a future time without a new inbound message. The plugin must preserve Core's narrow facade, raw ChannelScope vocabulary, EventRecord input model, immutable runtime snapshots, JSONL ownership, and global lifecycle behavior.

## Goals / Non-Goals

**Goals:**

- Add a channel-scoped, persistent Schedule capability that proves autonomous triggers can produce an Agent turn without an inbound Session.
- Support once and five-field cron schedules, user-visible lifecycle state, next execution time, and the latest submission result.
- Let the current-channel Agent manage schedules autonomously and let authority-4 operators manage the current channel through Koishi commands.
- Recover safely after restart, avoid catch-up bursts, prevent duplicate occurrence submission, and bound scheduling-specific resource use.
- Reuse EventMap, EventRecord, `ctx.yesimbot.trigger()`, RuntimeManager, ChannelRuntime FIFO, Agent persistence, and Bot delivery unchanged.

**Non-Goals:**

- A Core scheduler service, public runtime API, ChannelKey, SchedulerContext, or cross-channel management interface.
- Session synthesis or retention, a second output consumer, direct Bot delivery by the plugin, or a separate Agent input model.
- Timezone configuration, persisted per-schedule timezones, natural-language parsing infrastructure, retry/backoff, output history, delivery history, task dependencies, distributed locking, or workflow orchestration.
- Migration, dual read, aliases, or legacy schedule data support.

## Decisions

### D1: Implement Schedule as an optional plugin

- **Choice:** Add `plugins/schedule/` as `koishi-plugin-yesimbot-schedule`. It registers one AgentPlugin factory, current-channel Koishi commands, and its own lifecycle handler. It does not modify the Core facade or export scheduler internals.
- **Reason:** The existing trigger facade already carries a trusted final EventRecord across the required runtime and delivery path. A plugin owns only the new persistence and timing concern, keeping Core's interface small and its locality intact.
- **Rejected:** A timer inside an AgentPlugin cannot recover a dormant channel after restart. A Core scheduler would broaden Core's storage, lifecycle, and configuration responsibility without a demonstrated second use.

### D2: Keep Schedule records flat and scoped by existing coordinates

- **Choice:** Persist one row per Schedule in a plugin-owned Minato table named `yesimbot_schedule`. Each row contains the raw `type`, `platform`, `selfId`, and `channelId` columns plus id, title, prompt, kind, either `at` or `cron`, state, `nextRunAt`, latest result, and audit timestamps.
- **Reason:** A startup scheduler must discover future work across known channels. Core intentionally has no channel enumeration facade, so channel-root-only files would require a second global index and dual-source consistency. One table keeps discovery and schedule state in one durable source while preserving exact channel isolation in every query.
- **Rejected:** Persisting a ChannelScope wrapper, directory identity, map key, or a filesystem index would duplicate private Core storage concepts.

A Schedule state is `enabled`, `paused`, `cancelled`, or `completed`. A once Schedule reaches `completed` after an accepted, failed, or missed occurrence. Paused and cancelled schedules retain their rule and latest result but do not arm a timer.

### D3: Fix time interpretation to Asia/Shanghai

- **Choice:** Once schedules receive a canonical RFC 3339 instant. Cron schedules use a five-field expression interpreted in the fixed `Asia/Shanghai` timezone. No `timeZone` row field, tool input, or plugin configuration exists.
- **Reason:** The repository already formats Core message time in Asia/Shanghai. A fixed rule avoids a per-record configuration surface, schema complexity, and ambiguity during recovery.
- **Rejected:** A configurable or persisted timezone adds policy and migration surface that the current product requirement does not justify. A fixed-duration-only repeat cannot express calendar schedules such as weekday reminders.

Natural language is not persisted. Agent conversation must normalize it to canonical `at` or `cron`; ambiguous requests require clarification before mutation.

### D4: Submit `schedule.due` through the existing forced EventRecord path

- **Choice:** The package declaration-merges `schedule.due` into EventMap. At a claimed occurrence it reconstructs a complete EventRecord from the stored raw scope fields and calls `ctx.yesimbot.trigger(event)`.
- **Reason:** ChannelRuntime already guarantees durable event append, observer notification, FIFO ordering, idle run/busy join behavior, and single-consumer output ownership. Schedule should not duplicate any of them.
- **Rejected:** A synthetic MessageRecord would falsely represent a user message. Calling RuntimeManager directly, returning an output iterable, or sending through Bot directly would expose or duplicate Core mechanics.

The event has actual submission time as its timestamp and includes `schedule.id`, `title`, `kind`, and `scheduledFor` as structured extension fields. Its text is ordinary untrusted runtime-event data. Existing model projection therefore sees only the current event wrapper's type and text; the extension fields remain available to Core observers and plugins.

### D5: Use the latest result as the durable occurrence claim

- **Choice:** `lastResult` has `occurrenceAt`, a status of `submitting`, `accepted`, `failed`, `missed`, or `interrupted`, optional completion time, and optional diagnostic. The Store serially writes `submitting` and advances `nextRunAt` before it calls Core trigger. There is no separate `claimedFor` column.
- **Reason:** The `submitting` result identifies the owned occurrence and is enough to distinguish normal completion from a crash between submission and result persistence. Folding the claim into the user-visible latest result removes redundant schema.
- **Rejected:** A standalone claimed timestamp duplicates occurrence identity. Retrying an unresolved submission risks duplicate autonomous speech.

This guarantees at-most-once submission within one Koishi process. On restart, a past `submitting` occurrence becomes `interrupted` and is not resubmitted.

### D6: Skip missed occurrences and do not retry failures

- **Choice:** On recovery, a past one-time occurrence becomes `missed` and `completed`; a past cron occurrence becomes one `missed` result and advances directly to the first future occurrence. A rejected trigger becomes `failed`; neither case receives retry or backoff.
- **Reason:** Autonomous output must remain controlled after downtime, Bot absence, model failure, or stop. A no-catch-up policy prevents accumulated work from producing a model and message burst.
- **Rejected:** Replaying every elapsed occurrence or maintaining a retry queue requires delivery and idempotency policy beyond the trigger validation goal.

A normal `trigger()` resolution is `accepted`. It does not assert assistant delivery: detailed delivery failures remain the existing same-channel `delivery.failed` events.

### D7: Restrict management to the current channel and use simple limits

- **Choice:** Agent tools expose create, list, update, pause, resume, and cancel only for the factory's current ChannelScope. `yesimbot.schedule` commands use `authority: 4` and derive the current scope from the live command Session without retaining it. No generic plugin registration API is added.
- **Reason:** The Schedule plugin must not manufacture a cross-channel control plane. Agent autonomy and a privileged current-channel command are enough for this capability.
- **Rejected:** Target-scope arguments, plugin registries, user identity snapshots, and per-user authorization flows add new control abstractions without a present requirement.

The plugin defaults to 20 enabled schedules per channel, a 15-minute minimum cron interval, five concurrent trigger calls, a 120-character title limit, and a 2000-character prompt limit. If a due occurrence has no available trigger slot, it is recorded as missed instead of entering a delayed backlog.

### D8: Keep lifecycle and production time APIs ordinary

- **Choice:** The plugin clears timers and closes scheduler admission during its disposal lifecycle while preserving rows. Already admitted trigger calls remain owned by the existing Core trigger drain and runtime stop behavior. Production code calls `Date.now()`, `setTimeout()`, `clearTimeout()`, and the cron parser directly.
- **Reason:** Schedule must not retain a Session or outlive plugin shutdown, but it also must not wrap existing Core lifecycle or standard time APIs. A reset continues to clear only Core sessions/assets and leaves schedule rows intact.
- **Rejected:** A production Clock interface, constructor-injected time source, or scheduler-specific timeout/cancellation layer would create a test abstraction in the live path and compete with Core's turn lifecycle.

Tests use Vitest's existing process-level fake timers and system time controls.

## Risks / Trade-offs

- An Agent can autonomously create schedules in its own channel. Count, interval, text, and global submission limits bound the new durable amplification surface; the scheduler never derives new work from Agent output or delivery feedback.
- At-most-once submission may lose an occurrence if the process fails immediately after the durable `submitting` write. This is accepted over duplicate speech, and the resulting `interrupted` state exposes the outcome.
- A trigger accepted by Core can still encounter a downstream delivery failure. Schedule intentionally relies on the existing `delivery.failed` Event instead of duplicating segment-level delivery history.
- A fixed Asia/Shanghai convention favors the project's current operating context over per-channel portability. It is intentionally non-configurable in this scope.

## Migration Plan

This is a new optional package and a new empty database table. There is no legacy Schedule format, no existing scheduler to migrate, and no Core data migration. Installing the plugin begins with no Schedule rows; removing it leaves its rows inert and does not alter Core JSONL or channel storage.
