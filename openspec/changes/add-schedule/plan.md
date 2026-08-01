# Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional channel-scoped Schedule plugin that submits bounded once and cron due events through the existing Session-free proactive trigger path.

**Architecture:** `plugins/schedule` owns a single Minato table, validation, the earliest-due timer, recovery, and current-channel management tools/commands. At an accepted occurrence it declaration-merges and constructs `EventRecord<"schedule.due">`, then calls the existing `ctx.yesimbot.trigger()` facade; Core continues to own runtime selection, FIFO, Agent lifecycle, JSONL, output consumption, Bot delivery, and delivery failure feedback.

**Tech Stack:** TypeScript 5.9, Yarn 4 workspaces, Koishi 4.18, Minato through `ctx.database` and `ctx.model`, `@yesimbot/agent-runtime`, `cron-parser`, Vitest 4, pkgroll.

## Global Constraints

- Create only `plugins/schedule/`; do not change Core's public facade, RuntimeManager, ChannelRuntime, Agent runtime, or existing main specs.
- Persist raw `ChannelScope` fields, not ChannelKey, directory name, or an opaque identity wrapper.
- Use one `yesimbot_schedule` Minato table as the schedule source of truth. Do not write schedule rules to JSONL or a second channel-root index.
- Use fixed `Asia/Shanghai` in cron parser calls. Do not add a timezone field, tool input, or configuration setting.
- Production code MUST call `Date.now()`, `setTimeout()`, and `clearTimeout()` directly. Do not add a Clock abstraction, constructor-injected clock, or standard-library replacement parameter.
- Tests MUST use `vi.useFakeTimers()`, `vi.setSystemTime()`, and `vi.advanceTimersByTimeAsync()` around the real timer calls.
- A due task MUST enter only through `ctx.yesimbot.trigger(EventRecord)`; never retain or synthesize Session, call RuntimeManager directly, consume output, or send through Bot.
- No catch-up, retry, delayed backlog, direct delivery, cross-channel management, plugin schedule registry, migration, dual read, aliases, output history, or model-timeout layer.

---

### Task 1: Create the Schedule workspace and domain vocabulary

**Files:**
- Create: `plugins/schedule/package.json`
- Create: `plugins/schedule/tsconfig.json`
- Create: `plugins/schedule/vitest.config.ts`
- Create: `plugins/schedule/src/types.ts`
- Create: `plugins/schedule/tests/types.test.ts`

**Interfaces:**
- Produces `Schedule`, `ScheduleState`, `ScheduleLastResult`, `ScheduleCreateInput`, `ScheduleUpdateInput`, and declaration-merged `EventMap["schedule.due"]` for every later task.
- Consumes exported `ChannelScope` and `EventMap` from `koishi-plugin-yesimbot`.

- [ ] **Step 1: Add the workspace package configuration and test discovery configuration.**

  Mirror `plugins/workspace/package.json` and `plugins/workspace/tsconfig.json`: name the package `koishi-plugin-yesimbot-schedule`, set `dist` exports, use `npx pkgroll`, `tsc --noEmit`, and `vitest run`, extend `../../tsconfig.base.json`, and include `src`. Add `cron-parser` as the only new runtime dependency; list `koishi`, `koishi-plugin-yesimbot`, `@yesimbot/agent-runtime`, and `vitest` with the same peer/dev workspace conventions as other optional plugins.

  ```ts
  // plugins/schedule/vitest.config.ts
  import { defineConfig } from "vitest/config";

  export default defineConfig({
    test: { root: ".", include: ["tests/**/*.test.ts"] },
  });
  ```

- [ ] **Step 2: Write the failing domain-contract tests.**

  In `tests/types.test.ts`, assert that a direct Schedule keeps `selfId`, a shared Schedule uses the same raw fields, a due extension has only schedule metadata, and no type admits `timeZone` or `claimedFor`.

  ```ts
  const schedule = {
    id: "schedule-1",
    type: "shared",
    platform: "test",
    selfId: "bot-1",
    channelId: "room-1",
    kind: "once",
    at: "2026-08-01T01:00:00.000Z",
    state: "enabled",
    nextRunAt: "2026-08-01T01:00:00.000Z",
  } satisfies Schedule;
  ```

- [ ] **Step 3: Run the type-contract test to establish the missing exports.**

  Run: `npx vitest run plugins/schedule/tests/types.test.ts`

  Expected: FAIL because the Schedule module and exported types do not exist.

- [ ] **Step 4: Define the flat types and EventMap augmentation.**

  In `src/types.ts`, define the state and result unions exactly once. Keep the durable claim inside `lastResult`:

  ```ts
  export type ScheduleLastResult = {
    occurrenceAt: string;
    status: "submitting" | "accepted" | "failed" | "missed" | "interrupted";
    finishedAt?: string;
    error?: { name: string; message: string };
  };

  declare module "koishi-plugin-yesimbot" {
    interface EventMap {
      "schedule.due": {
        schedule: {
          id: string;
          title: string;
          kind: "once" | "cron";
          scheduledFor: string;
        };
      };
    }
  }
  ```

  Define `Schedule` with raw `type`, `platform`, `selfId`, and `channelId`, never a nested ChannelScope or derived key. Export no Clock or timezone option type.

- [ ] **Step 5: Re-run the type-contract test and package type check.**

  Run: `npx vitest run plugins/schedule/tests/types.test.ts && npx tsc --noEmit -p plugins/schedule/tsconfig.json`

  Expected: PASS.

### Task 2: Implement canonical time validation and the Minato Store

**Files:**
- Create: `plugins/schedule/src/time.ts`
- Create: `plugins/schedule/src/store.ts`
- Create: `plugins/schedule/tests/store.test.ts`
- Modify: `plugins/schedule/src/types.ts`

**Interfaces:**
- Produces `nextRunAt(schedule, after)`, `validateCreate(input, now)`, and `ScheduleStore` methods `create`, `list`, `update`, `pause`, `resume`, `cancel`, `claim`, `finish`, and `recover`.
- Consumes the types from Task 1 and `Context` database/model services.
- Provides the persisted state consumed by `ScheduleScheduler` in Task 3.

- [ ] **Step 1: Write failing Store tests for validation and channel isolation.**

  Cover a valid once schedule, `*/5 * * * *` rejection under the 15-minute limit, a valid `0 9 * * 1-5` cron, a past once instant, both-rule/no-rule inputs, the twenty-first enabled schedule in one scope, 120/2000 character limits, and an exact-scope list that cannot see another channel's row.

  ```ts
  await expect(store.create(sharedScope, {
    title: "standup",
    prompt: "Prepare the daily standup.",
    cron: "*/5 * * * *",
  })).rejects.toThrow("15 minutes");
  ```

- [ ] **Step 2: Run the Store test before implementation.**

  Run: `npx vitest run plugins/schedule/tests/store.test.ts`

  Expected: FAIL because `ScheduleStore` and canonical rule helpers do not exist.

- [ ] **Step 3: Implement direct time and cron helpers.**

  In `src/time.ts`, use `CronExpressionParser` directly with the fixed constant and an actual `Date` derived from persisted schedule data. Validate exactly five whitespace-separated cron fields before parsing. Never accept or persist a timezone value.

  ```ts
  export const SCHEDULE_TIME_ZONE = "Asia/Shanghai";

  export function nextCronRunAt(cron: string, after: Date): string {
    const interval = CronExpressionParser.parse(cron, {
      currentDate: after,
      tz: SCHEDULE_TIME_ZONE,
      strict: true,
    });
    return interval.next().toDate().toISOString();
  }
  ```

  `after` is the persisted occurrence boundary, not a test-injected clock; create/update paths obtain the current boundary with `new Date(Date.now())`.

- [ ] **Step 4: Implement the single-table Store and serialized mutations.**

  Register `yesimbot_schedule` through `ctx.model.extend()` in the plugin initialization path. Keep every schedule field and raw scope coordinate on one row. Serialize Store mutations with a private promise tail, as Agent storage does, so create/update/claim/cancel cannot interleave in one process.

  ```ts
  private mutationTail = Promise.resolve();

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationTail.then(operation, operation);
    this.mutationTail = next.then(() => undefined, () => undefined);
    return next;
  }
  ```

  Use exact raw scope criteria in all read/update operations. `pause` and `cancel` set `nextRunAt` to `null`; `resume` derives only a future occurrence; once schedules never resume after completion.

- [ ] **Step 5: Re-run Store tests and the package type check.**

  Run: `npx vitest run plugins/schedule/tests/store.test.ts && npx tsc --noEmit -p plugins/schedule/tsconfig.json`

  Expected: PASS.

### Task 3: Add durable occurrence claiming, recovery, and real timer scheduling

**Files:**
- Create: `plugins/schedule/src/scheduler.ts`
- Create: `plugins/schedule/tests/scheduler.test.ts`
- Modify: `plugins/schedule/src/store.ts`

**Interfaces:**
- Produces `ScheduleScheduler` with `start()` and `stop()` lifecycle methods.
- Consumes `ScheduleStore`, the real `Context.yesimbot.trigger()` facade, and standard global timers.
- Produces only complete `EventRecord<"schedule.due">` values; no runtime or Bot reference escapes the scheduler.

- [ ] **Step 1: Write failing fake-timer scheduler tests.**

  Use `vi.useFakeTimers()` and `vi.setSystemTime()` in `beforeEach`/`afterEach`. Cover one due once schedule, consecutive cron occurrences, one missed cron recovery without replay, recovery from `submitting`, two wake calls for one occurrence, five occupied trigger slots, and `stop()` clearing future work.

  ```ts
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
  await scheduler.start();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(ctx.yesimbot.trigger).toHaveBeenCalledTimes(1);
  ```

- [ ] **Step 2: Run the scheduler test before implementation.**

  Run: `npx vitest run plugins/schedule/tests/scheduler.test.ts`

  Expected: FAIL because `ScheduleScheduler` does not exist.

- [ ] **Step 3: Add Store claim/finalization/recovery transitions.**

  `claim(id, occurrenceAt)` MUST atomically verify `enabled` and matching `nextRunAt`, write:

  ```ts
  lastResult: { occurrenceAt, status: "submitting" }
  ```

  and advance the cron next occurrence or complete a once schedule before returning the claimed row. `finish()` changes that matching occurrence to `accepted` or `failed`. Startup converts a past `submitting` result to `interrupted`; it turns missed once rows into `completed/missed` and advances missed cron rows directly to the first future occurrence.

- [ ] **Step 4: Implement earliest-due scheduling with direct global timers.**

  `ScheduleScheduler` queries enabled rows, arms one timer for the earliest `nextRunAt`, and on wake processes all currently due rows. It calls `Date.now()`, `setTimeout()`, and `clearTimeout()` directly. It maintains a private count of active trigger promises; when the count is five, it records the occurrence missed rather than queueing it.

  Build each event from the stored raw fields:

  ```ts
  const event: EventRecord<"schedule.due"> = {
    eventType: "schedule.due",
    platform: schedule.platform,
    selfId: schedule.selfId,
    timestamp: Date.now(),
    channel: { id: schedule.channelId, type: toUniversalChannelType(schedule.type) },
    text: `Schedule "${schedule.title}" is due.\n${schedule.prompt}`,
    schedule: { id: schedule.id, title: schedule.title, kind: schedule.kind, scheduledFor: occurrenceAt },
  };
  ```

  Invoke only `await this.ctx.yesimbot.trigger(event)`. On rejection finalize `failed`; on resolution finalize `accepted`; do not interpret output or delivery details.

- [ ] **Step 5: Re-run scheduler tests and package type check.**

  Run: `npx vitest run plugins/schedule/tests/scheduler.test.ts && npx tsc --noEmit -p plugins/schedule/tsconfig.json`

  Expected: PASS.

### Task 4: Expose current-channel Agent management tools

**Files:**
- Create: `plugins/schedule/src/tools.ts`
- Create: `plugins/schedule/tests/tools.test.ts`
- Modify: `plugins/schedule/src/types.ts`

**Interfaces:**
- Produces `createScheduleTools(scope: ChannelScope, store: ScheduleStore): AgentTool[]`.
- Consumes only the factory's existing ChannelScope and Store; no tool schema includes platform, selfId, channelId, or Session.
- Is consumed by the plugin factory in Task 5.

- [ ] **Step 1: Write failing tool-schema and operation tests.**

  Assert the six tool names, assert all create/update schemas accept either canonical `at` or canonical `cron` but reject a channel target, and execute create/list/pause/resume/cancel against a Store test double for one scope.

  ```ts
  expect(tools.map((tool) => tool.name)).toEqual([
    "schedule_create",
    "schedule_list",
    "schedule_update",
    "schedule_pause",
    "schedule_resume",
    "schedule_cancel",
  ]);
  ```

- [ ] **Step 2: Run the tool tests before implementation.**

  Run: `npx vitest run plugins/schedule/tests/tools.test.ts`

  Expected: FAIL because `createScheduleTools` does not exist.

- [ ] **Step 3: Implement the six flat Agent tools.**

  Use `jsonSchema()` from `@yesimbot/agent-runtime`. Require title/prompt and exactly one canonical rule in create; permit title/prompt/rule replacement in update; return compact Schedule projections with id, title, kind, state, `nextRunAt`, and `lastResult`. Call Store methods using the captured `scope` only.

  ```ts
  export function createScheduleTools(scope: ChannelScope, store: ScheduleStore): AgentTool[] {
    return [createTool(scope, store), listTool(scope, store), updateTool(scope, store),
      pauseTool(scope, store), resumeTool(scope, store), cancelTool(scope, store)];
  }
  ```

- [ ] **Step 4: Re-run the tools test and package type check.**

  Run: `npx vitest run plugins/schedule/tests/tools.test.ts && npx tsc --noEmit -p plugins/schedule/tsconfig.json`

  Expected: PASS.

### Task 5: Wire Koishi commands, plugin lifecycle, and runtime snapshots

**Files:**
- Create: `plugins/schedule/src/index.ts`
- Create: `plugins/schedule/tests/plugin.test.ts`
- Modify: `plugins/schedule/package.json`
- Modify: `yarn.lock`

**Interfaces:**
- Produces the default Koishi plugin class `SchedulePlugin` with `static inject = ["yesimbot", "database"]`.
- Consumes `ScheduleStore`, `ScheduleScheduler`, and `createScheduleTools` from Tasks 2–4.
- Exposes no Schedule manager on `ctx.yesimbot` and no general plugin registry.

- [ ] **Step 1: Write failing plugin lifecycle and command tests.**

  Mock a Koishi Context as existing optional plugin tests do. Assert the plugin registers its AgentPlugin factory, starts recovery/scheduling when ready, registers `yesimbot.schedule` subcommands with `authority: 4`, derives the command scope from the current Session, clears timers on dispose, and does not retain the Session object.

  ```ts
  expect(ctx.yesimbot.registerAgentPlugin).toHaveBeenCalledOnce();
  expect(commands.find(({ name }) => name === "yesimbot.schedule.create")?.options)
    .toMatchObject({ authority: 4 });
  ```

- [ ] **Step 2: Run plugin wiring tests before implementation.**

  Run: `npx vitest run plugins/schedule/tests/plugin.test.ts`

  Expected: FAIL because `SchedulePlugin` does not exist.

- [ ] **Step 3: Implement the optional plugin class.**

  Follow the `WorkspacePlugin` lifecycle pattern: initialize Store/model once, construct Scheduler, register the AgentPlugin factory, and attach ready/dispose handlers. Commands must build a scope only from `session.platform`, `session.selfId`, `session.channelId`, and `session.isDirect`, immediately call the Store, and then release the Session reference. On disposal set scheduler admission closed and call `stop()`; do not clear database rows.

- [ ] **Step 4: Install and lock the cron dependency through Yarn.**

  Run: `rtk yarn install`

  Expected: `yarn.lock` records the package dependency and the workspace remains resolvable.

- [ ] **Step 5: Re-run plugin wiring tests and package type check.**

  Run: `npx vitest run plugins/schedule/tests/plugin.test.ts && npx tsc --noEmit -p plugins/schedule/tsconfig.json`

  Expected: PASS.

### Task 6: Prove the no-inbound-message trigger path and lifecycle boundaries

**Files:**
- Create: `plugins/schedule/tests/proactive.integration.test.ts`
- Modify: `plugins/schedule/tests/scheduler.test.ts`

**Interfaces:**
- Consumes the real Schedule plugin, a matching fake Bot, a controlled Core trigger fixture, and the standard fake-timer controls.
- Produces evidence that Schedule submits the existing typed trigger path without its own Session, output consumer, or delivery implementation.

- [ ] **Step 1: Write the failing no-inbound-message integration test.**

  Build a Context with a matching `test:bot-1` Bot and a Core trigger fixture modeled on `core/tests/service.test.ts` and `core/tests/channel-runtime.test.ts`. Create a once Schedule, do not route any user MessageRecord, advance the Vitest clock to its due instant, and assert one `schedule.due` record reaches the trigger facade with the stored scope and untrusted text. Then assert the controlled runtime fixture appends the event before its Agent turn and the matching Bot receives the only delivery.

  ```ts
  expect(trigger).toHaveBeenCalledWith(expect.objectContaining({
    eventType: "schedule.due",
    platform: "test",
    selfId: "bot-1",
    channel: { id: "room-1", type: 0 },
  }));
  expect(sendMessage).toHaveBeenCalledOnce();
  ```

- [ ] **Step 2: Run the integration test before final integration work.**

  Run: `npx vitest run plugins/schedule/tests/proactive.integration.test.ts`

  Expected: FAIL until the plugin lifecycle and scheduler submit the complete due event.

- [ ] **Step 3: Extend the integration fixture for busy, failure, reset, and stop cases.**

  Add independent tests that show a busy runtime receives one joined event without a second output owner; a missing Bot or rejected trigger produces `failed` without retry; a reset leaves future Schedule rows intact; a `submitting` record recovers as `interrupted`; plugin disposal produces no later trigger; and a delivery failure remains Core `delivery.failed` feedback rather than a Schedule retry or history row.

- [ ] **Step 4: Run the full Schedule suite, type check, and narrow reused Core suites.**

  Run:

  ```bash
  npx vitest run plugins/schedule
  npx tsc --noEmit -p plugins/schedule/tsconfig.json
  npx vitest run core/tests/channel-runtime.test.ts core/tests/runtime-manager.test.ts core/tests/service.test.ts
  ```

  Expected: all Schedule behavior passes and the existing proactive-trigger contracts remain green.

### Task 7: Final package build and scope review

**Files:**
- Modify only if required by prior tests: `plugins/schedule/src/**/*.ts`, `plugins/schedule/tests/**/*.test.ts`, `plugins/schedule/package.json`, `plugins/schedule/tsconfig.json`, `plugins/schedule/vitest.config.ts`, `yarn.lock`

**Interfaces:**
- Consumes the completed Schedule package.
- Produces a publishable optional plugin and verified adherence to the accepted non-goals.

- [ ] **Step 1: Build the new workspace package.**

  Run: `rtk yarn turbo run build --filter=koishi-plugin-yesimbot-schedule`

  Expected: pkgroll produces the package distribution with no missing workspace import.

- [ ] **Step 2: Review the implementation against the explicit exclusions.**

  Confirm the final change has no Core source modification, no `timeZone` persistence/configuration, no `claimedFor` field, no production Clock abstraction, no retained Session, no direct `Bot.sendMessage()` from Schedule, no retry/backlog, and no cross-channel tool/command input.

- [ ] **Step 3: Run the final narrow verification command set.**

  Run:

  ```bash
  npx vitest run plugins/schedule
  npx tsc --noEmit -p plugins/schedule/tsconfig.json
  rtk yarn turbo run build --filter=koishi-plugin-yesimbot-schedule
  ```

  Expected: all commands pass before requesting implementation review.
