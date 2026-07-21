# Core Message Runtime Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Platform.Message` the sole routing authority, move the complete channel Agent lifecycle behind `ChannelRuntime`, and route ordered output through a Koishi-first `DeliveryService`.

**Architecture:** Koishi/Satori remain responsible for transport, passive reply context, Bot resolution primitives, and MessageEncoder behavior. Core adds one canonical channel fact, a deterministic routing policy, an internal channel runtime, and an output delivery service. `YesImBotService` becomes the Koishi facade and composition root; `@yesimbot/agent-runtime` remains unchanged.

**Tech Stack:** TypeScript, Koishi 4, Satori 4.6, `@yesimbot/agent-runtime`, Vitest, Yarn 4, Turbo, OpenSpec.

## Global Constraints

- Use `yarn`, never npm or pnpm; prefix shell commands with `rtk` when available.
- Preserve the per-channel ordering: classify -> prepare -> resolve Agent -> final busy read -> append/join/run.
- Keep the final busy read and join/run submission in one no-await critical section.
- Consume Agent streams and perform delivery outside the channel FIFO.
- Keep `Platform.Message` pure data; never spread, serialize, persist, or pass the raw Session into `agent-runtime`.
- Use the raw Session only for adapter preparation and passive delivery during the active handle call.
- Do not add event consumers, world state, willingness, deferred scheduling, retries, outbox storage, or per-platform delivery adapters.
- Keep reset order `interrupt -> stop -> storage clear -> asset clear -> runtime cache delete`.
- Treat JSONL messages without `scope.channelType` as unsupported; do not add a permanent inference fallback.
- Do not commit unless the user explicitly requests a commit.
- Keep these artifacts authoritative during implementation: `design.md`, `specs/platform-message-ingestion/spec.md`, `specs/core-runtime-integration/spec.md`, and `specs/message-delivery/spec.md`.

## File Structure

- Modify `core/src/platform/types.ts`: add canonical channel type to message scope and persisted records.
- Modify `core/src/platform/message.ts`: capture the real Session accessor and reject legacy records.
- Modify `core/src/platform/service.ts`: preserve channel type through preparation copies.
- Modify `core/src/config.ts`: define routing configuration and defaults.
- Modify `core/src/runtime/message.ts`: classify canonical messages and derive channel scope from them.
- Create `core/src/delivery/types.ts`: delivery receipt, event, error, and listener contracts.
- Create `core/src/delivery/service.ts`: passive/target sending, ordering, receipts, and status publication.
- Create `core/src/delivery/index.ts`: stable delivery exports.
- Create `core/src/runtime/channel-runtime.ts`: FIFO, Agent cache, submission, stream, delivery, reset, and stop ownership.
- Modify `core/src/runtime/render.ts`: project assistant messages into ordered Koishi fragments.
- Modify `core/src/runtime/service.ts`: retain plugin registration and delegate channel lifecycle operations.
- Modify `core/src/index.ts`: register and export DeliveryService in dependency order.
- Create `core/tests/delivery.test.ts`: DeliveryService contract tests.
- Create `core/tests/channel-runtime.test.ts`: deep ChannelRuntime behavior tests.
- Modify existing platform, message-flow, lifecycle, reset, error, context, and apply tests where ownership changes.

---

## Task 1: Canonical Channel Type and Persistence

**Files:**
- Modify: `core/src/platform/types.ts:19-47`
- Modify: `core/src/platform/message.ts:17-64`
- Modify: `core/src/platform/service.ts:49-64`
- Test: `core/tests/platform-session.test.ts`
- Test: `core/tests/platform-projection.test.ts`
- Test: `core/tests/platform-types.test.ts`

**Interfaces:**
- Produces: required `Platform.Message.scope.channelType: "private" | "group"`.
- Produces: `draftMessageFromSession()` reads directness from the real Session exactly once.
- Produces: `messageFromRecord()` rejects records that omit or corrupt `channelType`.
- Consumed by: Tasks 2, 5, and 8.

- [ ] **Step 1: Add a failing real-accessor regression test**

Add a test that places `isDirect` on the Session prototype instead of an enumerable own property:

```ts
it("captures directness from the real Session accessor", () => {
  const input = Object.create({
    get isDirect() {
      return true;
    },
  }) as Session;
  Object.assign(input, {
    platform: "test",
    selfId: "bot",
    channelId: "dm-user",
    userId: "user",
    messageId: "m1",
    content: "hello",
  });

  const message = draftMessageFromSession(input, 10)!;

  expect(Object.hasOwn(input, "isDirect")).toBe(false);
  expect(message.scope.channelType).toBe("private");
});
```

- [ ] **Step 2: Add failing record round-trip and legacy rejection tests**

Use a canonical record with `channelType: "group"`, then cast a missing-field record through `unknown` to verify runtime rejection:

```ts
expect(messageFromRecord(record).scope.channelType).toBe("group");

const legacy = {
  ...record,
  scope: { type: "channel", channelId: "room" },
} as unknown as Platform.MessageRecord;
expect(() => messageFromRecord(legacy)).toThrow("channelType");
```

- [ ] **Step 3: Run the focused tests and confirm the new assertions fail**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-session.test.ts tests/platform-projection.test.ts tests/platform-types.test.ts
```

Expected: FAIL because message scope lacks `channelType` and legacy records are accepted.

- [ ] **Step 4: Extend the canonical message scope**

Change only `Platform.Message.scope`; keep guild/account event scopes unchanged:

```ts
export interface Message {
  source: Source;
  scope: Extract<Scope, { type: "channel" }> & {
    channelType: "private" | "group";
  };
  sender: Sender;
  messageId: string;
  timestamp?: number;
  receivedAt: number;
  elements: Element[];
}
```

`MessageRecord.scope` already references `Message["scope"]`, so it inherits the required field without a duplicate type.

- [ ] **Step 5: Capture and validate channel type at the platform boundary**

Add the field in `draftMessageFromSession()` and a narrow legacy guard in `messageFromRecord()`:

```ts
scope: {
  type: "channel",
  channelId: session.channelId,
  channelType:
    session.isDirect === true || session.subtype === "private" ? "private" : "group",
  ...(session.guildId ? { guildId: session.guildId } : {}),
},
```

```ts
if (data.scope.channelType !== "private" && data.scope.channelType !== "group") {
  throw new Error("Platform message record channelType is required");
}
```

Keep `createPreparationView()` copying `scope` with `{ ...message.scope }`; add an assertion to `platform-prepare.test.ts` that replacement elements preserve `channelType`.

- [ ] **Step 6: Run focused tests and package type checking**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-session.test.ts tests/platform-prepare.test.ts tests/platform-projection.test.ts tests/platform-types.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

Expected: PASS.

## Task 2: Canonical Routing Policy and Configuration

**Files:**
- Modify: `core/src/config.ts:8-24`
- Modify: `core/src/runtime/message.ts:1-83`
- Test: `core/tests/message-flow.test.ts`
- Test: `core/tests/channel-message.test.ts`
- Test: `core/tests/apply.test.ts`

**Interfaces:**
- Produces: `MessageRoutingAction`, `MessageRoutingConfig`, and `DEFAULT_MESSAGE_ROUTING` from `core/src/config.ts`.
- Produces: `classifyMessage(message, routing)` and `getChannelScope(message)` with no Session dependency.
- Consumed by: ChannelRuntime in Task 5 and service wiring in Task 8.

- [ ] **Step 1: Replace Session-shaped classifier fixtures with canonical messages**

Use one message factory and test self, direct, mention, and ordinary group behavior:

```ts
function platformMessage(
  overrides: Partial<Platform.Message> = {},
): Platform.Message {
  return {
    source: { platform: "test", selfId: "bot" },
    scope: { type: "channel", channelId: "room", channelType: "group" },
    sender: { id: "user" },
    messageId: "m1",
    receivedAt: 1,
    elements: [h.text("hello")],
    ...overrides,
  };
}

expect(classifyMessage(platformMessage(), DEFAULT_MESSAGE_ROUTING)).toBe("append");
expect(
  classifyMessage(
    platformMessage({ elements: [h("at", { id: "bot" })] }),
    DEFAULT_MESSAGE_ROUTING,
  ),
).toBe("reply");
expect(
  classifyMessage(
    platformMessage({ scope: { type: "channel", channelId: "dm", channelType: "private" } }),
    DEFAULT_MESSAGE_ROUTING,
  ),
).toBe("reply");
expect(
  classifyMessage(platformMessage({ sender: { id: "bot" } }), DEFAULT_MESSAGE_ROUTING),
).toBe("ignore");
```

- [ ] **Step 2: Add a failing configuration matrix test**

Verify each non-self scenario can map independently to `append` or `reply` and self remains ignored:

```ts
const routing: MessageRoutingConfig = {
  direct: "append",
  mention: "append",
  group: "reply",
};

expect(classifyMessage(directMessage, routing)).toBe("append");
expect(classifyMessage(mentionMessage, routing)).toBe("append");
expect(classifyMessage(groupMessage, routing)).toBe("reply");
expect(classifyMessage(selfMessage, routing)).toBe("ignore");
```

- [ ] **Step 3: Run message-flow tests and confirm the Session-based API no longer matches**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/message-flow.test.ts tests/channel-message.test.ts
```

Expected: FAIL until the classifier and config contracts are implemented.

- [ ] **Step 4: Add routing configuration with existing defaults**

Add these declarations to `core/src/config.ts` and add a third root schema section named `消息路由`:

```ts
export type MessageRoutingAction = "append" | "reply";

export interface MessageRoutingConfig {
  direct: MessageRoutingAction;
  mention: MessageRoutingAction;
  group: MessageRoutingAction;
}

export const DEFAULT_MESSAGE_ROUTING: MessageRoutingConfig = {
  direct: "reply",
  mention: "reply",
  group: "append",
};

export interface Config {
  basePath: string;
  chatModel: string;
  logLevel?: number;
  platform?: PlatformConfig;
  routing?: Partial<MessageRoutingConfig>;
}
```

Use `Schema.union(["append", "reply"])` for each field and apply the matching default value. Keep `routing` optional in the TypeScript config so existing programmatic test fixtures remain valid.

- [ ] **Step 5: Refactor routing helpers to use Platform.Message only**

Remove the Session import, fallback regex, and author fallback chain from `runtime/message.ts`:

```ts
export function getChannelScope(message: Platform.Message): ChannelScope {
  return {
    platform: message.source.platform,
    selfId: message.source.selfId,
    channelId: message.scope.channelId,
  };
}

export function isSelfMessage(message: Platform.Message): boolean {
  return message.sender.id === message.source.selfId;
}

export function mentionsSelf(message: Platform.Message): boolean {
  return message.elements.some(
    (element) =>
      element.type === "at" && String(element.attrs?.id) === message.source.selfId,
  );
}

export function classifyMessage(
  message: Platform.Message,
  routing: MessageRoutingConfig,
): MessageClassification {
  if (isSelfMessage(message)) return "ignore";
  if (message.scope.channelType === "private") return routing.direct;
  if (mentionsSelf(message)) return routing.mention;
  return routing.group;
}
```

- [ ] **Step 6: Verify routing and schema defaults**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/message-flow.test.ts tests/channel-message.test.ts tests/apply.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

Expected: PASS.

## Task 3: Passive and Target Delivery

**Files:**
- Create: `core/src/delivery/types.ts`
- Create: `core/src/delivery/service.ts`
- Create: `core/src/delivery/index.ts`
- Create: `core/tests/delivery.test.ts`

**Interfaces:**
- Produces: `DeliveryService.reply(session, outputs)`.
- Produces: `DeliveryService.send(source, scope, outputs)`.
- Produces: `Delivery.Receipt` with `messageIds: string[]` and `sentCount`.
- Consumed by: ChannelRuntime in Task 6 and public service wiring in Task 8.

- [ ] **Step 1: Write failing passive and target delivery tests**

Use direct service construction with a test Context and spies:

```ts
it("replies through the original Session and preserves returned ids", async () => {
  const session = {
    send: vi.fn(async () => ["m1"]),
  } as unknown as Session;
  const service = new DeliveryService(ctx, config);

  const receipt = await service.reply(session, ["first", "second"]);

  expect(session.send).toHaveBeenNthCalledWith(1, "first");
  expect(session.send).toHaveBeenNthCalledWith(2, "second");
  expect(receipt).toMatchObject({
    mode: "reply",
    status: "sent",
    sentCount: 2,
    messageIds: ["m1", "m1"],
  });
});

it("resolves a target bot by platform and self id", async () => {
  const sendMessage = vi.fn(async () => ["target-1"]);
  ctx.bots.push({ platform: "test", selfId: "bot", sendMessage } as never);

  const receipt = await service.send(
    { platform: "test", selfId: "bot" },
    { type: "channel", channelId: "room", channelType: "group" },
    ["hello"],
  );

  expect(sendMessage).toHaveBeenCalledWith("room", "hello");
  expect(receipt.messageIds).toEqual(["target-1"]);
});
```

- [ ] **Step 2: Add failing partial, first-failure, and unavailable-Bot tests**

Make the second fragment reject and assert no third call occurs:

```ts
const send = vi
  .fn()
  .mockResolvedValueOnce(["m1"])
  .mockRejectedValueOnce(new Error("offline"));

const receipt = await service.reply({ send } as never, ["one", "two", "three"]);

expect(receipt).toMatchObject({ status: "partial", sentCount: 1, messageIds: ["m1"] });
expect(send).toHaveBeenCalledTimes(2);
```

For an unmatched target, assert `status: "failed"`, `sentCount: 0`, `messageIds: []`, and error code `delivery.target_unavailable`.

- [ ] **Step 3: Run the new test and confirm missing-module failure**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/delivery.test.ts
```

Expected: FAIL because the delivery module does not exist.

- [ ] **Step 4: Define the delivery contract**

Create `delivery/types.ts` with the final first-version shape:

```ts
import type { Awaitable } from "koishi";

export namespace Delivery {
  export type Mode = "reply" | "send";
  export type Status = "sent" | "partial" | "failed";

  export interface ErrorInfo {
    code: "delivery.target_unavailable" | "delivery.send_failed";
    message: string;
    retryable: false;
  }

  export interface Receipt {
    deliveryId: string;
    mode: Mode;
    status: Status;
    sentCount: number;
    messageIds: string[];
    startedAt: number;
    finishedAt: number;
    error?: ErrorInfo;
  }

  export type Event =
    | { type: "delivery.started"; deliveryId: string; mode: Mode; startedAt: number }
    | { type: `delivery.${Status}`; receipt: Receipt };

  export type Listener = (event: Event) => Awaitable<void>;
}
```

- [ ] **Step 5: Implement ordered sending over Session and Bot**

Create `DeliveryService extends Service<Config>`, declare `Context["yesimbot.delivery"]`, and centralize both paths in one private sequence:

```ts
async reply(session: Session, outputs: readonly Fragment[]): Promise<Delivery.Receipt> {
  return this.deliver("reply", outputs, (output) => session.send(output));
}

async send(
  source: Platform.Source,
  scope: Platform.Message["scope"],
  outputs: readonly Fragment[],
): Promise<Delivery.Receipt> {
  const bot = this.ctx.bots.find(
    (candidate) =>
      candidate.platform === source.platform && candidate.selfId === source.selfId,
  );
  return this.deliver("send", outputs, (output) => {
    if (!bot) throw new DeliveryTargetUnavailable(source);
    return bot.sendMessage(scope.channelId, output);
  });
}
```

The private `deliver()` MUST generate one UUID, append returned IDs, increment `sentCount` only after each resolved call, stop at the first rejection, and return `partial` only when `sentCount > 0`.

- [ ] **Step 6: Export the delivery module and verify focused behavior**

Export `Delivery` and `DeliveryService` from `delivery/index.ts`, then run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/delivery.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

Expected: PASS.

## Task 4: Delivery Status Observation and Diagnostics

**Files:**
- Modify: `core/src/delivery/service.ts`
- Modify: `core/src/delivery/types.ts`
- Modify: `core/tests/delivery.test.ts`

**Interfaces:**
- Produces: `DeliveryService.subscribe(listener): () => void`.
- Preserves: exactly one started event and one terminal event per operation.
- Preserves: listener completion does not delay or change the receipt.

- [ ] **Step 1: Add failing event-order and listener-isolation tests**

```ts
const events: Delivery.Event[] = [];
service.subscribe((event) => events.push(event));

const receipt = await service.reply(session, ["hello"]);

expect(events.map((event) => event.type)).toEqual([
  "delivery.started",
  "delivery.sent",
]);
expect(events[0]).toMatchObject({ deliveryId: receipt.deliveryId });
expect(events[1]).toMatchObject({ receipt: { deliveryId: receipt.deliveryId } });
```

Add a listener returning `Promise.reject(new Error("observer failed"))`; assert the send still resolves as `sent` and the injected logger receives `event: "delivery.listener_failed"`.

- [ ] **Step 2: Add a failing non-recursive failure test**

Make the Session sender reject once and assert DeliveryService performs one call, emits `started` then `failed`, and does not attempt to send its own error text.

- [ ] **Step 3: Run the delivery tests and confirm subscription failures**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/delivery.test.ts
```

Expected: FAIL because `subscribe()` and status publication are absent.

- [ ] **Step 4: Implement observational status publication**

```ts
private readonly listeners = new Set<Delivery.Listener>();

subscribe(listener: Delivery.Listener): () => void {
  this.listeners.add(listener);
  return () => this.listeners.delete(listener);
}

private notify(event: Delivery.Event): void {
  for (const listener of [...this.listeners]) {
    try {
      const result = listener(event);
      if (result && typeof (result as PromiseLike<void>).then === "function") {
        void Promise.resolve(result).catch((cause) =>
          this.reportListenerFailure(cause),
        );
      }
    } catch (cause) {
      this.reportListenerFailure(cause);
    }
  }
}
```

Call `notify(started)` before target resolution or the first send. Construct the receipt once, call `notify(terminal)`, then return the same receipt object.

- [ ] **Step 5: Verify delivery status and failure isolation**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/delivery.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

Expected: PASS with no unhandled rejection warning.

## Task 5: ChannelRuntime Submission Ownership

**Files:**
- Create: `core/src/runtime/channel-runtime.ts`
- Modify: `core/src/runtime/message.ts`
- Create: `core/tests/channel-runtime.test.ts`
- Modify: `core/tests/channel-context.test.ts`
- Modify: `core/tests/channel-lifecycle.test.ts`

**Interfaces:**
- Produces: `ChannelRuntime.handle(message, session): Promise<void>`.
- Produces: private per-channel FIFO and cache keyed from canonical message source/scope.
- Consumes: PlatformService, DeliveryService, Config, model service, JSONL storage, and Agent plugin factories.
- Preserves: final busy read immediately followed by join/run without await.

- [ ] **Step 1: Add failing canonical-context and submission tests**

Construct messages whose Session fields conflict with canonical source/scope/channel type, then assert Agent ID and context use the message:

```ts
await runtime.handle(
  platformMessage({
    source: { platform: "canonical", selfId: "bot-2" },
    scope: { type: "channel", channelId: "room-2", channelType: "private" },
  }),
  session({ platform: "raw", selfId: "raw-bot", channelId: "raw-room" }),
);

expect(state.createdContext.channel).toEqual({
  platform: "canonical",
  selfId: "bot-2",
  channelId: "room-2",
  type: "private",
});
```

Add separate assertions for configured append, idle reply/run, and busy reply/join.

- [ ] **Step 2: Add failing FIFO and post-prepare busy tests**

Use deferred preparation promises for two messages in one channel and one message in another channel. Assert same-channel preparation is ordered, cross-channel preparation enters concurrently, and `getActiveTurnId()` runs after preparation resolves.

- [ ] **Step 3: Run the new runtime tests and confirm missing-module failure**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel-runtime.test.ts tests/channel-context.test.ts tests/channel-lifecycle.test.ts
```

Expected: FAIL because ChannelRuntime does not exist.

- [ ] **Step 4: Create the narrow runtime and dependency contract**

Keep the class internal to the core package and do not expose Agent handles:

```ts
export interface ChannelRuntimeOptions {
  ctx: Context;
  config: Config;
  logger: Logger;
  platform: PlatformService;
  delivery: DeliveryService;
  getAgentPlugins(context: ChannelAgentContext): readonly AgentPlugin[];
}

export class ChannelRuntime {
  async handle(message: Platform.Message, session: Session): Promise<void>;
  async reset(scope: ChannelScope): Promise<void>;
  async stop(): Promise<void>;
}
```

Move `CachedRuntime`, core prompt construction, storage creation, runtime plugin assembly, Agent construction, cache ownership, and `enqueueChannel()` from `YesImBotService` into this file.

- [ ] **Step 5: Build Agent context from the canonical message**

```ts
private createChannelContext(
  message: Platform.Message,
  session: Session,
): ChannelAgentContext {
  return {
    channel: {
      ...getChannelScope(message),
      type: message.scope.channelType,
    },
    platform: {
      name: message.source.platform,
      unsafeBot: session.bot,
    },
  };
}
```

Use Session only for `unsafeBot` and later preparation/delivery. Use the message-derived scope for storage, cache, and platform message projection.

- [ ] **Step 6: Implement classification, preparation, and atomic submission**

Normalize routing once in the constructor:

```ts
this.routing = { ...DEFAULT_MESSAGE_ROUTING, ...options.config.routing };
```

Inside the channel FIFO:

```ts
classification = classifyMessage(message, this.routing);
if (classification === "ignore") return;

const prepared = await this.platform.prepareMessage(session, message);
const { runtime } = await this.getChannelAgent(prepared, session);
const runtimeMessage = createPlatformMessage(prepared);

if (classification === "append") {
  await runtime.append(runtimeMessage);
  return;
}

if (runtime.getActiveTurnId() != null) {
  runtime.send(runtimeMessage, { ifBusy: "join" });
  return;
}

stream = runtime.run(runtimeMessage);
```

Do not insert an await between `getActiveTurnId()` and `send()`/`run()`.

- [ ] **Step 7: Drain the new turn stream outside the FIFO**

For this task, add a private stream loop that observes `turn.failed` and drains all events. Task 6 will add output collection and delivery. The loop MUST run after `enqueueChannel()` resolves so joined inputs can enter.

- [ ] **Step 8: Verify canonical identity and concurrency**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel-runtime.test.ts tests/channel-context.test.ts tests/channel-lifecycle.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

Expected: PASS.

## Task 6: Stream Ownership, Output Projection, and Delivery

**Files:**
- Modify: `core/src/runtime/channel-runtime.ts`
- Modify: `core/src/runtime/render.ts`
- Modify: `core/tests/channel-runtime.test.ts`
- Modify: `core/tests/error-handling.test.ts`

**Interfaces:**
- Produces: one stream consumer and one DeliveryService reply operation per run.
- Produces: ordered non-empty assistant Koishi fragments.
- Preserves: joined messages do not create independent stream consumers.

- [ ] **Step 1: Add failing output-order and single-owner tests**

Provide a run stream with assistant, tool, empty assistant, and second assistant events:

```ts
const stream = events([
  appended(assistant("first")),
  appended(toolMessage()),
  appended(assistant("   ")),
  appended(assistant("second")),
  done(),
]);

await runtime.handle(replyMessage, session);

expect(delivery.reply).toHaveBeenCalledTimes(1);
expect(delivery.reply).toHaveBeenCalledWith(session, ["first", "second"]);
```

Start one pending stream, join a second message, then finish the stream. Assert `Agent.run()` and delivery each run once while `Agent.send(..., { ifBusy: "join" })` runs for the joined input.

- [ ] **Step 2: Add failing turn-error and delivery-error tests**

Assert `turn.failed` causes one generic DeliveryService reply for a `reply` classification, append failure sends nothing, and a failed generic delivery does not trigger another delivery call.

- [ ] **Step 3: Run focused tests and confirm delivery assertions fail**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel-runtime.test.ts tests/error-handling.test.ts
```

Expected: FAIL because ChannelRuntime only drains streams.

- [ ] **Step 4: Project assistant output into Koishi fragments**

Replace `extractAssistantTexts()` with an output-oriented name while preserving its filtering behavior:

```ts
export function extractAssistantOutputs(
  messages: readonly AgentMessage[],
): Fragment[] {
  const outputs: Fragment[] = [];
  // Preserve current string and TextPart extraction in generation order.
  // Push only values whose trimmed text is non-empty.
  return outputs;
}
```

Keep non-text assistant content out of first-version delivery, as required by the current core spec.

- [ ] **Step 5: Track and consume one stream task per run**

```ts
private readonly streamTasks = new Set<Promise<void>>();

private trackStream(task: Promise<void>): Promise<void> {
  this.streamTasks.add(task);
  void task.finally(() => this.streamTasks.delete(task));
  return task;
}
```

The stream consumer MUST collect assistant messages, throw on `turn.failed`, call `delivery.reply(session, outputs)` once when outputs are non-empty, and log a failed/partial delivery receipt without rolling back Agent history.

- [ ] **Step 6: Route processing failures through delivery once**

Centralize failure handling:

```ts
private async reportProcessingFailure(
  session: Session,
  key: string,
  action: string,
  cause: unknown,
  shouldReply: boolean,
): Promise<void> {
  this.logger.error({ event: "session.processing_failed", key, action, cause: errorMessage(cause) });
  if (!shouldReply) return;
  const receipt = await this.delivery.reply(session, [GENERIC_ERROR_REPLY]);
  if (receipt.status !== "sent") {
    this.logger.warn({ event: "delivery.error_reply_failed", key, receipt });
  }
}
```

Never call the failure helper recursively for a failed error receipt.

- [ ] **Step 7: Verify stream, join, rendering, and error behavior**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel-runtime.test.ts tests/error-handling.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

Expected: PASS.

## Task 7: Reset and Stop Lifecycle

**Files:**
- Modify: `core/src/runtime/channel-runtime.ts`
- Modify: `core/tests/reset.test.ts`
- Modify: `core/tests/channel-runtime.test.ts`

**Interfaces:**
- Produces: `ChannelRuntime.reset(scope)` with the accepted destructive order.
- Produces: `ChannelRuntime.stop()` that rejects new work, stops Agents, waits streams, and preserves persisted data.

- [ ] **Step 1: Move reset assertions to ChannelRuntime**

Instantiate ChannelRuntime directly and preserve the existing operation assertion:

```ts
await runtime.handle(message("a"), session("a"));
await runtime.reset(scope);
await runtime.handle(message("b"), session("b"));

expect(operations).toEqual([
  "interrupt",
  "stop",
  "storage.clear",
  "assets.clear",
]);
expect(secondAgent).not.toBe(firstAgent);
```

Keep the existing reset-without-runtime case and the preparation/reset/later-message FIFO case.

- [ ] **Step 2: Add failing stop tests**

Start a pending stream, invoke `stop()`, and assert it interrupts/stops the Agent and does not resolve until the stream task terminates. After stop, assert `handle()` and `reset()` reject with `Channel runtime is stopped`. Assert storage and asset clear spies were not called.

- [ ] **Step 3: Run lifecycle tests and confirm ownership failures**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/reset.test.ts tests/channel-runtime.test.ts
```

Expected: FAIL until reset/stop move into ChannelRuntime.

- [ ] **Step 4: Implement reset through the existing channel FIFO**

Move the current reset body without reordering it:

```ts
async reset(scope: ChannelScope): Promise<void> {
  this.assertOpen();
  const key = createChannelRuntimeKey(scope);
  await this.enqueueChannel(key, async () => {
    const cached = this.runtimes.get(key);
    const storage = cached?.storage ?? (await this.createStorage(scope));
    if (cached) {
      await cached.runtime.interrupt("reset");
      await cached.runtime.stop();
    }
    await storage.clear();
    await this.platform.clearChannel(scope);
    this.runtimes.delete(key);
  });
}
```

- [ ] **Step 5: Implement stop without clearing persisted data**

```ts
async stop(): Promise<void> {
  if (this.stopped) return;
  this.stopped = true;
  await Promise.allSettled([...this.lifecycleTails.values()]);
  const cached = [...this.runtimes.values()];
  for (const entry of cached) {
    await entry.runtime.interrupt("dispose");
    await entry.runtime.stop();
  }
  await Promise.allSettled([...this.streamTasks]);
  this.runtimes.clear();
}
```

Do not call storage or asset clear from `stop()`.

- [ ] **Step 6: Verify reset order and disposal preservation**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/reset.test.ts tests/channel-runtime.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

Expected: PASS.

## Task 8: Slim YesImBotService and Core Composition

**Files:**
- Modify: `core/src/index.ts:1-22`
- Modify: `core/src/runtime/service.ts:101-361`
- Modify: `core/src/runtime/index.ts`
- Modify: `core/tests/apply.test.ts`
- Modify: `core/tests/platform-session.test.ts`
- Modify: `core/tests/channel-lifecycle.test.ts`
- Modify: `core/tests/error-handling.test.ts`
- Modify: `core/tests/reset.test.ts`

**Interfaces:**
- Consumes: DeliveryService and ChannelRuntime final interfaces.
- Preserves: `ctx.yesimbot.registerAgentPlugin()` and `ctx.yesimbot.platform`.
- Produces: `ctx.yesimbot.delivery` for status subscribers.

- [ ] **Step 1: Add failing service-registration and delegation tests**

Update `apply.test.ts` to assert plugin order:

```ts
expect(plugins).toEqual([
  PlatformService,
  ModelService,
  DeliveryService,
  YesImBotService,
]);
```

Spy on `ChannelRuntime.handle/reset/stop` in service tests and assert `YesImBotService` delegates rather than calling Agent or Session send methods itself.

- [ ] **Step 2: Run service integration tests and confirm missing registration**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/apply.test.ts tests/platform-session.test.ts tests/channel-lifecycle.test.ts tests/error-handling.test.ts tests/reset.test.ts
```

Expected: FAIL because DeliveryService is not registered and service still owns orchestration.

- [ ] **Step 3: Register and export DeliveryService**

Update core application order:

```ts
export { DeliveryService } from "./delivery/service.js";

export function apply(ctx: Context, config: Config) {
  ctx.plugin(PlatformService, config);
  ctx.plugin(ModelService, config);
  ctx.plugin(DeliveryService, config);
  ctx.plugin(YesImBotService, config);
}
```

Export public delivery types through `delivery/index.ts`. Add `readonly delivery` on YesImBotService so plugins use `ctx.yesimbot.delivery.subscribe()` without resolving an internal service name.

- [ ] **Step 4: Construct ChannelRuntime once and retain live plugin factories**

In the service constructor:

```ts
this.delivery = ctx["yesimbot.delivery"];
this.channelRuntime = new ChannelRuntime({
  ctx,
  config,
  logger: this.logger,
  platform: this.platform,
  delivery: this.delivery,
  getAgentPlugins: (context) => this.createExternalAgentPlugins(context),
});
```

The callback MUST read the current factory array when a channel Agent is created; do not snapshot factories in the ChannelRuntime constructor.

- [ ] **Step 5: Replace handleSession orchestration with delegation**

```ts
async handleSession(session: Session, next?: () => Promise<unknown>): Promise<void> {
  const message = this.platform.getMessage(session) ?? this.platform.collectIfNeeded(session);
  try {
    if (message) await this.channelRuntime.handle(message, session);
  } finally {
    await next?.();
  }
}

async resetChannel(scope: ChannelScope): Promise<void> {
  await this.channelRuntime.reset(scope);
}
```

`stop()` MUST remove Koishi middleware/command disposers and then call `channelRuntime.stop()` once.

- [ ] **Step 6: Delete superseded service orchestration**

Remove from `YesImBotService`:

- `runtimes` and `lifecycleTails` maps;
- Agent creation/storage/prompt/plugin assembly methods now owned by ChannelRuntime;
- reconstructed `routeSession`;
- direct calls to `classifyMessage`, `prepareMessage`, `append`, `send`, `run`, `extractAssistantTexts`, and `session.send`;
- reset and stop loops now owned by ChannelRuntime.

Keep plugin factory registration, middleware/command registration, the public platform property, and cleanup disposers.

- [ ] **Step 7: Verify service composition and default behavior**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/apply.test.ts tests/platform-session.test.ts tests/channel-lifecycle.test.ts tests/error-handling.test.ts tests/reset.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

Expected: PASS.

## Task 9: Test Consolidation and Full Verification

**Files:**
- Modify: `core/tests/message-flow.test.ts`
- Modify: `core/tests/channel-message.test.ts`
- Modify: `core/tests/channel-lifecycle.test.ts`
- Modify: `core/tests/channel-context.test.ts`
- Modify: `core/tests/error-handling.test.ts`
- Modify: `core/tests/reset.test.ts`
- Modify: `core/tests/platform-session.test.ts`
- Modify: `openspec/changes/redesign-core-message-runtime/tasks.md`

**Interfaces:**
- Verifies every requirement in the three delta specs.
- Produces no new runtime interface.

- [ ] **Step 1: Remove tests coupled to deleted Session routing helpers**

Delete imports and direct assertions for `getAuthorId(session)`, `getChannelType(session)`, `mentionsSelf(session)`, and Session-shaped `classifyMessage(session)`. Keep pure canonical-message classification tests in `message-flow.test.ts`; keep lifecycle behavior in `channel-runtime.test.ts` and service delegation in integration tests.

- [ ] **Step 2: Add a spec-to-test coverage table to the plan execution notes**

Before running the full suite, verify these mappings:

```text
platform-message-ingestion / accessor + canonical record
  -> platform-session, platform-projection, platform-types
core-runtime-integration / routing + FIFO + stream + reset
  -> message-flow, channel-runtime, channel-lifecycle, reset, error-handling
message-delivery / reply + send + receipt + events
  -> delivery
```

Do not create a new documentation artifact for this table; record any gap by adding the missing test to the mapped test file.

- [ ] **Step 3: Run strict OpenSpec and formatting validation**

Run:

```bash
rtk openspec validate redesign-core-message-runtime --strict
rtk yarn fmt:check
```

Expected: the change is valid and all matched files use the correct format.

- [ ] **Step 4: Run lint and core type checking**

Run:

```bash
rtk yarn lint
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

Expected: PASS with no new lint or TypeScript diagnostics.

- [ ] **Step 5: Build core before the complete core test suite**

Run:

```bash
rtk yarn turbo run build --filter=koishi-plugin-yesimbot
rtk yarn workspace koishi-plugin-yesimbot exec vitest run
```

Expected: core build succeeds and every core test passes.

- [ ] **Step 6: Scan for forbidden legacy paths**

Run:

```bash
rtk rg -n "routeSession|MessageRouteFacts|IncomingMessage|ReplyOrigin" core/src
rtk rg -n "session\.send" core/src/runtime
rtk rg -n "getChannelType|Pick<Session" core/src/runtime/message.ts
```

Expected: every command exits with no matches. `session.send` is allowed only inside `core/src/delivery/service.ts`, which is intentionally outside the searched runtime directory.

- [ ] **Step 7: Check the worktree and update task tracking**

Run:

```bash
rtk git status --short
rtk git diff --check
```

Expected: only intended source, test, and `redesign-core-message-runtime` artifact files are changed; `git diff --check` prints no errors. Mark a task in `tasks.md` complete only after its focused verification has passed.
