# Proactive Agent Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` in the main session to implement this plan task-by-task. Do not dispatch child agents unless the user explicitly asks.

**Goal:** Let Core and trusted plugins force a typed EventRecord through a channel runtime and deliver its reply to the declared channel without a Session.

**Architecture:** `ChannelRuntime.trigger()` reuses the committed-input FIFO but bypasses Will and forces idle-run or busy-join behavior. RuntimeManager keeps runtime selection and returns the internal result; `YesImBotService.trigger()` resolves the matching Bot before admission and owns the Bot transport. A private top-level `core/src/delivery.ts` centralizes the existing output loop so Gateway retains the Session adapter and the service facade supplies the Bot adapter.

**Tech Stack:** TypeScript, Koishi, `@yesimbot/agent-runtime`, Vitest, Yarn 4 monorepo tooling.

## Global Constraints

- Keep `Session` confined to Gateway's inbound path. RuntimeManager and ChannelRuntime must neither receive nor retain Session or a Session-bound sender.
- Add only `ctx.yesimbot.trigger(event: EventRecord): Promise<void>` to the public facade. Do not export RuntimeManager, ChannelRuntime, the delivery helper, or an output stream.
- Accept `EventRecord` only. A trigger does not synthesize a MessageRecord, create a Session, call a Resolver, or reapply Gateway allowlist and assignee admission.
- Place common delivery behavior in private `core/src/delivery.ts`. Gateway owns the `Session.send()` adapter; YesImBotService owns the matching `Bot.sendMessage()` adapter; RuntimeManager sends no platform messages.
- Preserve JSONL format, EventMap extension shape, model event projection, active-turn ownership, reply pacing, first-success acknowledgement, cancellation, and `delivery.failed` semantics.
- Write implementation tests first. Run commands from the repository root with `npx`; do not commit unless the user explicitly requests a commit.

---

## Task 1: ChannelRuntime Forced Event Path

**Files:**
- Modify: `core/src/runtime/channel.ts:169-190`
- Modify: `core/tests/channel-runtime.test.ts:223-292`

**Interfaces:**
- Consumes: `EventRecord`, existing `ChannelRuntimeResult`, `Agent.append()`, `Agent.run()`, `Agent.send()`, and `WillEngine`.
- Produces: `ChannelRuntime.trigger(record: EventRecord): Promise<ChannelRuntimeResult>` for internal RuntimeManager use.

- [ ] **Step 1: Add failing forced-event tests beside the existing non-message and join tests.**

```ts
function forcedEvent(): EventRecord<"delivery.failed"> {
  return {
    eventType: "delivery.failed",
    platform: "test",
    selfId: "bot-1",
    timestamp: 2,
    channel: { id: "room-1", type: 0 },
    text: "Delivery failed",
    delivery: {
      turnId: "turn-1",
      messageId: "assistant-1",
      segmentIndex: 1,
      segmentTotal: 1,
      error: { name: "Error", message: "offline" },
    },
  }
}

it("forces a committed event without Will", async () => {
  const decide = vi.fn(async () => "wait" as const)
  const { ctx, runtime } = createRuntime({ decide })
  const observed: string[] = []
  ctx.on("yesimbot/event", () => observed.push("event"))
  ctx.on("yesimbot/will", () => observed.push("will"))

  await expect(runtime.trigger(forcedEvent())).resolves.toMatchObject({ kind: "run", turnId: "turn-1" })
  expect(decide).not.toHaveBeenCalled()
  expect(observed).toEqual(["event"])
  expect(state.agent?.append).toHaveBeenCalledOnce()
  expect(state.agent?.run).toHaveBeenCalledOnce()
})

it("joins a forced event to the active turn", async () => {
  state.activeTurnId = "turn-active"
  const { runtime } = createRuntime({ decide: vi.fn(async () => "wait" as const) })

  await expect(runtime.trigger(forcedEvent())).resolves.toMatchObject({ kind: "join", turnId: "turn-active" })
  expect(state.agent?.send).toHaveBeenCalledWith(expect.any(Object), { ifBusy: "join" })
  expect(state.agent?.run).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the focused test to establish the missing contract.**

Run:

```bash
npx vitest run core/tests/channel-runtime.test.ts
```

Expected: FAIL because `ChannelRuntime.trigger` does not exist.

- [ ] **Step 3: Factor committed-input work and add the forced method.**

Keep `handle(record)` as the ordinary routed path. Extract the shared append-and-observe sequence into one private method that creates the input, calls `agent.append(input)`, and emits `yesimbot/message` or `yesimbot/event`. Then implement the two paths with the following structure:

```ts
handle(record: MessageRecord | EventRecord): Promise<ChannelRuntimeResult> {
  return this.schedule(async () => {
    const input = await this.commit(record)
    const decision = await this.opts.will.decide(input, this.readState())
    this.ctx.emit("yesimbot/will", { event: input, decision })
    return this.applyDecision(input, decision)
  })
}

trigger(record: EventRecord): Promise<ChannelRuntimeResult> {
  return this.schedule(async () => {
    const input = await this.commit(record)
    const activeTurnId = this.agent.getActiveTurnId()
    if (activeTurnId !== null) {
      this.agent.send(input, { ifBusy: "join" })
      return { kind: "join", eventId: input.id, turnId: activeTurnId }
    }
    return this.startRun(input)
  })
}
```

Have `applyDecision()` retain the existing `wait`, idle-run, and busy-join behavior. Do not call `WillEngine.decide()` or emit `yesimbot/will` from `trigger()`.

- [ ] **Step 4: Re-run the ChannelRuntime suite.**

Run:

```bash
npx vitest run core/tests/channel-runtime.test.ts
```

Expected: PASS, including ordinary routing tests and the new forced-event tests.

## Task 2: Internal RuntimeManager Trigger Routing

**Files:**
- Modify: `core/src/runtime/manager.ts:40-54`
- Modify: `core/tests/runtime-manager.test.ts:48-125,127-220`

**Interfaces:**
- Consumes: `ChannelRuntime.trigger(record)` from Task 1 and the existing channel-scope derivation used by `route(record)`.
- Produces: internal `RuntimeManager.trigger(record: EventRecord): Promise<ChannelRuntimeResult>`; it never selects a transport or calls Bot send methods.

- [ ] **Step 1: Extend the RuntimeManager test double and add a failing trigger-routing test.**

Add `trigger` to the hoisted test state and spy on `ChannelRuntime.prototype.trigger`. Build a complete EventRecord inside the test, route it through `manager.trigger()`, and assert that exactly one runtime is created, `state.trigger` receives that record, and `state.handle` remains unused.

```ts
const event = {
  eventType: "delivery.failed",
  platform: "test",
  selfId: "bot-1",
  timestamp: 2,
  channel: { id: "room", type: 0 },
  text: "Delivery failed",
  delivery: {
    turnId: "turn-1",
    messageId: "assistant-1",
    segmentIndex: 1,
    segmentTotal: 1,
    error: { name: "Error", message: "offline" },
  },
} satisfies EventRecord<"delivery.failed">
state.trigger.mockResolvedValue({ kind: "join", eventId: "event-1", turnId: "turn-1" })

await expect(manager.trigger(event)).resolves.toMatchObject({ kind: "join", turnId: "turn-1" })
expect(state.trigger).toHaveBeenCalledWith(event)
expect(state.handle).not.toHaveBeenCalled()
```

- [ ] **Step 2: Run the RuntimeManager test file.**

Run:

```bash
npx vitest run core/tests/runtime-manager.test.ts
```

Expected: FAIL because `RuntimeManager.trigger` and the ChannelRuntime trigger spy do not exist.

- [ ] **Step 3: Share record-to-runtime resolution and implement RuntimeManager.trigger.**

Extract the existing scope derivation and `getOrCreate(scope)` call so ordinary and forced routes share it. Keep ordinary `route()` unchanged after it obtains the runtime. Add the Event-only path:

```ts
async trigger(record: EventRecord): Promise<ChannelRuntimeResult> {
  this.assertOpen()
  const runtime = await this.runtimeFor(record)
  this.assertOpen()
  return runtime.trigger(record)
}
```

`runtimeFor()` must derive the scope from the EventRecord channel exactly as `route()` does and preserve existing stopped-manager errors. It must not look up a Bot for delivery or call `sendMessage`.

- [ ] **Step 4: Re-run RuntimeManager coverage.**

Run:

```bash
npx vitest run core/tests/runtime-manager.test.ts
```

Expected: PASS, including existing creation, reset, replacement, and stop cases.

## Task 3: Shared Core Delivery Helper

**Files:**
- Create: `core/src/delivery.ts`
- Create: `core/tests/delivery.test.ts`
- Modify: `core/src/gateway.ts:139-203,301-335`
- Modify: `core/tests/gateway-delivery.test.ts:218-459`

**Interfaces:**
- Consumes: a running `ChannelRuntimeResult`, the source `MessageRecord | EventRecord`, `PacingConfig`, and a callback that sends one `Element[]` segment.
- Produces: private `deliverOutput(options): Promise<void>` with no package-root export.

- [ ] **Step 1: Create direct failing tests for the delivery helper.**

Import `deliverOutput` from `../src/delivery.js`. Define local fixtures rather than importing test helpers from Gateway tests:

```ts
function runResult(...content: string[]) {
  const delivery = {
    signal: new AbortController().signal,
    onDelivered: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
  }
  return {
    result: {
      kind: "run" as const,
      eventId: "event-1",
      turnId: "turn-1",
      output: (async function* () {
        yield {
          turnId: "turn-1",
          messageId: "assistant-1",
          segments: content.map((text) => [h.text(text)]),
        }
      })(),
      delivery,
    },
    delivery,
  }
}

const record: MessageRecord = {
  platform: "test", selfId: "bot-1", timestamp: 1, channel: { id: "room-1", type: 0 },
  user: { id: "user-1" }, messageId: "message-1", elements: [h.text("hello")],
}
const { result, delivery } = runResult("first", "second")
const send = vi.fn(async () => [])
await deliverOutput({ record, result, pacing: { charactersPerSecond: 8, maxTotalDelayMs: 60_000 }, send, warn: vi.fn() })
expect(send).toHaveBeenNthCalledWith(1, [h.text("first")])
expect(send).toHaveBeenNthCalledWith(2, [h.text("second")])
expect(delivery.onDelivered).toHaveBeenCalledOnce()
```

Add separate tests with these fixed fixtures: a rejected first `send` and a two-segment run must call `delivery.fail` once with `segmentIndex: 1` and send only the first segment; an already-aborted signal must call neither `send` nor `delivery.fail`; fake timers with `{ maxTotalDelayMs: 150, charactersPerSecond: 10 }` must schedule the first and second one-character segments at the 250 ms minimum interval after the total budget is exhausted.

- [ ] **Step 2: Run the new test file.**

Run:

```bash
npx vitest run core/tests/delivery.test.ts
```

Expected: FAIL because `core/src/delivery.ts` is absent.

- [ ] **Step 3: Implement the private shared helper.**

Move the current paced loop, `nextSegmentDelayMs`, `waitForDelay`, and delivery-error normalization from Gateway into `core/src/delivery.ts`. Define an internal options shape and preserve the current behavior:

```ts
interface DeliveryOptions {
  readonly record: MessageRecord | EventRecord
  readonly result: Extract<ChannelRuntimeResult, { readonly kind: "run" }>
  readonly pacing: PacingConfig
  readonly send: (segment: Element[]) => Promise<unknown>
  readonly warn: (cause: unknown) => void
}

export async function deliverOutput({
  record,
  result,
  pacing,
  send,
  warn,
}: DeliveryOptions): Promise<void> {
  let acknowledged = false
  let consumedDeliveryMs = 0
  for await (const output of result.output) {
    for (const [index, segment] of output.segments.entries()) {
      if (result.delivery.signal.aborted) return
      const delayMs = nextSegmentDelayMs({ text: segment.join(""), consumedDeliveryMs, config: pacing })
      await waitForDelay(delayMs, result.delivery.signal)
      if (result.delivery.signal.aborted) return
      try {
        await send(segment)
        if (!acknowledged) {
          acknowledged = true
          await result.delivery.onDelivered()
        }
      } catch (cause) {
        await reportDeliveryFailure({ record, output, index, cause, delivery: result.delivery, warn })
        return
      }
    }
  }
}
```

Define `reportDeliveryFailure()` in the same file with the existing Gateway payload: normalize `name`, `message`, and string `code`; call `delivery.fail()` with `eventType: "delivery.failed"`, the source platform, self ID, channel, output turn and message IDs, the one-based segment index, total segments, and frozen text; catch a feedback rejection and pass it to `warn`.

Keep the helper private to Core by omitting it from `core/src/index.ts`. `reportDeliveryFailure()` must retain the current normalized error payload, frozen text, same-runtime feedback call, and logger-isolation behavior.

- [ ] **Step 4: Adapt Gateway to the helper without changing its transport ownership.**

Replace Gateway's delivery-loop body with a call that passes the original active Session sender:

```ts
await deliverOutput({
  record,
  result,
  pacing: this.config.pacing,
  send: (segment) => session.send(segment),
  warn: (cause) => this.warn("delivery.failed", cause, record.platform),
})
```

Remove only helpers moved to `core/src/delivery.ts`; retain Gateway Session admission, resolver, and task-drain logic.

- [ ] **Step 5: Run direct and passive-adapter delivery coverage.**

Run:

```bash
npx vitest run core/tests/delivery.test.ts core/tests/gateway-delivery.test.ts
```

Expected: PASS. Existing Gateway cases must still prove ordered Session sends, no recursive feedback, abort behavior, and session lifetime until output consumption finishes.

## Task 4: YesImBotService Bot Adapter And Public Facade

**Files:**
- Modify: `core/src/service.ts:1-116`
- Modify: `core/tests/service.test.ts:6-92,110-203`

**Interfaces:**
- Consumes: `RuntimeManager.trigger(event)` from Task 2 and `deliverOutput()` from Task 3.
- Produces: `YesImBotService.trigger<K extends keyof EventMap>(event: EventRecord<K>): Promise<void>` on `ctx.yesimbot`.

- [ ] **Step 1: Expand the service RuntimeManager mock and write failing facade tests.**

Add a `trigger` mock to the mocked RuntimeManager class. Import `h`, add a local complete `delivery.failed` EventRecord fixture, and push a matching Bot into `ctx.bots`. Return one complete run result from the mock and assert the service forwards the same event and sends the produced segment to `event.channel.id`.

```ts
const event: EventRecord<"delivery.failed"> = {
  eventType: "delivery.failed", platform: "test", selfId: "bot-1", timestamp: 2,
  channel: { id: "room-1", type: 0 }, text: "Delivery failed",
  delivery: {
    turnId: "turn-1", messageId: "assistant-1", segmentIndex: 1, segmentTotal: 1,
    error: { name: "Error", message: "offline" },
  },
}
const sendMessage = vi.fn(async () => [])
ctx.bots.push({ platform: "test", selfId: "bot-1", sendMessage } as never)
state.runtime?.trigger.mockResolvedValue({
  kind: "run", eventId: "event-1", turnId: "turn-1",
  output: (async function* () {
    yield { turnId: "turn-1", messageId: "assistant-1", segments: [[h.text("reply")]] }
  })(),
  delivery: { signal: new AbortController().signal, onDelivered: vi.fn(), fail: vi.fn() },
})

await service.trigger(event)
expect(state.runtime?.trigger).toHaveBeenCalledWith(event)
expect(sendMessage).toHaveBeenCalledWith("room-1", [h.text("reply")])
```

Add a no-Bot case that expects `service.trigger(event)` to reject and verifies `state.runtime.trigger` was not called. Keep the successful trigger case on the default configuration, whose empty `allowedChannels` proves the facade does not apply Gateway external admission. Update the confirmed-facade test to require `ctx.yesimbot.trigger` and continue rejecting `runtime`, `gateway`, and `delivery` properties.
- [ ] **Step 2: Run the service test file.**

Run:

```bash
npx vitest run core/tests/service.test.ts
```

Expected: FAIL because the facade and mocked manager trigger operation do not exist.

- [ ] **Step 3: Implement the facade-owned Bot adapter.**

Import `EventRecord` and `deliverOutput`. Resolve the exact Bot before routing:

```ts
async trigger<K extends keyof EventMap>(event: EventRecord<K>): Promise<void> {
  const bot = this.ctx.bots.find(
    (candidate) => candidate.platform === event.platform && candidate.selfId === event.selfId,
  )
  if (!bot) throw new Error(`No Bot is available for ${event.platform}:${event.selfId}`)

  const result = await this.rt.trigger(event)
  if (result.kind !== "run") return
  await deliverOutput({
    record: event,
    result,
    pacing: this.config.reply.pacing,
    send: (segment) => bot.sendMessage(event.channel.id, segment),
    warn: (cause) => this.logError("warn", "delivery.failed", cause),
  })
}
```

Use the existing service error-logging isolation. Do not expose a direct Bot, delivery helper, RuntimeManager, or output iterable from the service.

- [ ] **Step 4: Re-run service and adapter coverage.**

Run:

```bash
npx vitest run core/tests/service.test.ts core/tests/delivery.test.ts core/tests/gateway-delivery.test.ts
```

Expected: PASS, including unavailable-Bot rejection before runtime admission and unchanged Gateway Session delivery.

## Task 5: Cross-Path Contract Verification

**Files:**
- Modify: `core/tests/channel-runtime.test.ts`
- Modify: `core/tests/runtime-manager.test.ts`
- Modify: `core/tests/service.test.ts`
- Create: `core/tests/delivery.test.ts`
- Modify: `core/tests/gateway-delivery.test.ts`

**Interfaces:**
- Consumes: the completed forced channel path, internal manager trigger, shared delivery helper, and service facade.
- Produces: focused regression coverage for every new observable contract.

- [ ] **Step 1: Run the complete focused test set.**

Run:

```bash
npx vitest run core/tests/channel-runtime.test.ts core/tests/runtime-manager.test.ts core/tests/service.test.ts core/tests/delivery.test.ts core/tests/gateway-delivery.test.ts core/tests/model-input.test.ts
```

Expected: PASS. The run must cover forced idle and busy events, no Will decision for forced events, exact Bot matching, direct structured delivery, empty-ID acknowledgement, first-failure feedback, cancellation, passive Session regression behavior, and the unchanged event model projection.

- [ ] **Step 2: Run the Core type check.**

Run:

```bash
npx tsc --noEmit -p core/tsconfig.json
```

Expected: PASS with the public generic `EventRecord` signature, internal run-result flow, and `Bot.sendMessage()` segment callback all type-safe.

- [ ] **Step 3: Review the public and persistence boundaries before handoff.**

Inspect the completed diff and confirm these exact conditions: `core/src/index.ts` exports no delivery helper; `ctx.yesimbot` exposes `trigger` but not runtime or Gateway; no new Session reference appears outside `gateway.ts`; no JSONL schema, manifest, allowlist, assignee, model-projection, scheduling, retry, or idempotency behavior changed.
