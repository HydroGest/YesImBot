## Why

Core now supports trusted, Session-free proactive EventRecord triggers, but there is no durable way to cause one when no new user message arrives. A focused channel schedule plugin will exercise that path end to end while giving Agents and operators bounded, inspectable once and cron-triggered autonomous work without expanding Core into a workflow platform.

## What Changes

- **Optional Schedule plugin**
  - Add `koishi-plugin-yesimbot-schedule` under `plugins/schedule/`.
  - Persist channel-scoped once and five-field cron schedules in one plugin-owned Minato table.
  - Add Agent tools and `authority: 4` current-channel management commands for creating, listing, updating, pausing, resuming, and cancelling schedules.

- **Due-event execution**
  - Declaration-merge `schedule.due` into the existing EventMap.
  - Submit due work only through `ctx.yesimbot.trigger()` so the existing RuntimeManager, ChannelRuntime FIFO, JSONL append, forced-turn, Bot delivery, and stop semantics remain authoritative.
  - Treat schedule event text as existing untrusted runtime event data; no synthetic MessageRecord or Session is created.

- **Recovery and bounded operation**
  - Recover future schedules at plugin start, skip missed occurrences without catch-up, and use a durable `lastResult.status: "submitting"` transition to provide at-most-once submission after crashes or duplicate timer wakes.
  - Fix scheduling interpretation to `Asia/Shanghai` without a timezone field or configuration surface.
  - Enforce schedule count, cron frequency, text-size, and concurrent-trigger limits; do not add retry queues, output paths, model timeouts, or cross-channel controls.

## Capabilities

### New Capabilities

- `schedule`: Channel-scoped durable once and cron schedules that submit untrusted due events through the existing proactive trigger path.

### Modified Capabilities

- None. The existing `proactive-agent-trigger` capability is consumed unchanged; Schedule adds a plugin-owned source of valid EventRecords rather than changing its contract.

## Impact

- New package: `plugins/schedule/`, including Koishi plugin wiring, Minato schema/store, timer scheduler, AgentPlugin tools, commands, and tests.
- Existing public contracts reused unchanged: `ChannelScope`, `EventMap` declaration merging, `ctx.yesimbot.trigger()`, `registerAgentPlugin()`, and Core JSONL event persistence.
- One cron parsing dependency will be added to the new package; Core and `@yesimbot/agent-runtime` remain free of scheduling dependencies.
- No migration, legacy data read, Core public scheduler interface, Session retention, or implementation/apply work is included in this change.
