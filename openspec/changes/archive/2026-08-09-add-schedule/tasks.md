## 1. Package Foundation and Public Schedule Shape

- [x] 1.1 Create the `plugins/schedule` workspace package with Koishi, Core, agent-runtime, Minato, cron parsing, TypeScript, and Vitest configuration consistent with existing optional plugins.
- [x] 1.2 Define flat Schedule, latest-result, rule, state, validation-limit, and due-event types; declaration-merge `schedule.due` into the exported Core EventMap without adding Core source changes or a new channel identity.
- [x] 1.3 Register the plugin-owned `yesimbot_schedule` Minato model with raw ChannelScope columns and the fields required for schedule discovery, state, and latest result.

## 2. Durable Channel-Scoped Schedule Store

- [x] 2.1 Add focused Store tests for scoped create/list/update, rule validation, state transitions, count and text limits, and fixed Asia/Shanghai time interpretation.
- [x] 2.2 Implement the serialized Schedule Store over the single Minato table, including exact-scope queries and no persisted timezone or standalone claim field.
- [x] 2.3 Implement durable occurrence claiming by writing `lastResult.status: "submitting"` and advancing the rule before submission; finalize accepted, failed, missed, and interrupted outcomes without retries.

## 3. Timer Scheduling and Recovery

- [x] 3.1 Add fake-timer tests using Vitest's standard global timer and system-time controls for once schedules, cron schedules, missed recovery, duplicate wakes, submission-slot exhaustion, and restart after `submitting`.
- [x] 3.2 Implement startup recovery, fixed Asia/Shanghai cron calculation, earliest-due timer arming, concurrent-trigger admission, and no-backlog missed behavior using direct `Date.now()`, `setTimeout()`, and `clearTimeout()` calls.
- [x] 3.3 Implement plugin shutdown that closes scheduler admission, clears timers, preserves rows, and leaves already admitted Core trigger work under Core lifecycle ownership.

## 4. Agent and Administrator Management

- [x] 4.1 Add current-channel Agent tools for create, list, update, pause, resume, and cancel, with schemas that expose canonical once-or-cron inputs and never accept a target channel.
- [x] 4.2 Add `yesimbot.schedule` authority-4 current-channel commands that derive scope only from the active command Session and discard it after the operation.
- [x] 4.3 Register the AgentPlugin factory and plugin lifecycle so tools enter newly created runtime snapshots while schedule recovery remains independent of runtime creation.

## 5. Trigger Integration and End-to-End Coverage

- [x] 5.1 Add an integration test showing that a due Schedule, without any new inbound message, constructs one `schedule.due` EventRecord and reaches the existing Core trigger, channel FIFO, Agent turn, JSONL event append, and matching Bot delivery path.
- [x] 5.2 Cover busy-turn join, missing Bot/model failure, Core reset preservation, plugin/Core stop behavior, and accepted-trigger delivery-failure feedback without adding retries or direct plugin delivery.
- [x] 5.3 Run the new package's focused Vitest suite and TypeScript check, then run the narrow existing Core proactive-trigger suites that prove reused contracts remain intact.
