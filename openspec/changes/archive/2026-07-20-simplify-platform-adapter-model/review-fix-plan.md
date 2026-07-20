# Platform Adapter Review Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the `simplify-platform-adapter-model` implementation into exact agreement with the approved review-fix design, removing the broken service, lifecycle, type, asset, and OneBot compatibility surfaces rather than preserving aliases.

**Architecture:** Keep `Platform.Message` as a pure Koishi `Element[]` domain object, centralize adapter selection and refinement in `PlatformService`, use the Agent runtime as the only busy-state source, and expose only `ctx.yesimbot.platform` to plugins. Image preparation becomes recursive, streamed, abortable, and deterministically budgeted; event publication and OneBot forward normalization remain narrow, typed boundaries.

**Tech Stack:** TypeScript 5.9, Koishi 4.18, `@satorijs/element` through Koishi `h`/`Element`, `@yesimbot/agent-runtime`, Cordis HTTP `ReadableStream`, Vitest 4, Yarn 4, Turbo.

## Global Constraints

- The approved source of truth is `openspec/changes/simplify-platform-adapter-model/review-fix-design.md`.
- Keep the original `plan.md`, `tasks.md`, and `verify.md` unchanged as historical records. The existing uncommitted `tasks.md` change is user-owned and must not be overwritten.
- Do not touch the untracked `.cortexkit/` directory.
- Do not add compatibility aliases for `MsgElement`, `PersistedPlatformMessage`, `adapt()`, `platformService`, `ctx["yesimbot.platform"]`, `AssetStore`, or `IMAGE_BUDGET` public imports.
- Delete superseded files and symbols when their replacement lands. Do not keep deprecated getters, duplicate exports, forwarding wrappers, or test-only constructor overloads.
- Use Koishi `Element` directly. Do not introduce another element interface, `any[]`, hand-written pseudo-elements, or string-returning adapter preparation.
- Keep advanced types proportional: use the `PlatformEventVariants` generic map, discriminated unions, indexed access types, and type guards; do not add recursive conditional or template-literal type machinery.
- Adapter errors never select a second adapter after a thrown `accepts()` or `refine()`.
- `prepare()` may return `Element[] | void`; core applies only returned elements and always seals afterward.
- Store sealed message content as literal `content: string`; the domain source of truth remains `Element[]`.
- Use `yarn`, not npm or pnpm. Prefix shell commands with `rtk` when available.
- Run the narrowest failing/passing test at each step, then package checks, then the full pipeline.
- Do not commit unless the user explicitly requests commits. Every task ends with a review checkpoint instead of an automatic commit.

## File Map

### OpenSpec artifacts

- Modify `openspec/changes/simplify-platform-adapter-model/specs/core-runtime-integration/spec.md`: two-stage routing, runtime busy truth, canonical service API, reset ordering.
- Modify `openspec/changes/simplify-platform-adapter-model/specs/platform-event-contract/spec.md`: Event has no `receivedAt`; event-only publication.
- Modify `openspec/changes/simplify-platform-adapter-model/specs/platform-message-ingestion/spec.md`: `refine()` union, Koishi Element contract, private asset boundary, streamed image limits.
- Modify `openspec/changes/simplify-platform-adapter-model/specs/onebot-utils/spec.md`: structured segment normalization.
- Create `openspec/changes/simplify-platform-adapter-model/review-fix-verify.md` only after all verification commands pass.

### Core platform module

- Modify `core/src/platform/types.ts`: final public contracts, `Platform.MessageRecord`, `Platform.RefineResult`.
- Modify `core/src/platform/index.ts`: narrow public exports.
- Modify `core/src/platform/service.ts`: one matcher, refine orchestration, weak Session state, event-only listeners, private assets.
- Modify `core/src/platform/message.ts`: typed Element companion functions and ordered model projection.
- Modify `core/src/platform/assets.ts`: magic-byte-only store API.
- Create `core/src/platform/utils/elements.ts`: shared recursive normalization and sealing.
- Delete `core/src/platform/normalize.ts`: its only responsibilities move to `PlatformService` and element utilities.

### Core runtime

- Modify `core/src/runtime/message.ts`: static `classifyMessage()` and `Platform.MessageRecord` construction.
- Modify `core/src/runtime/service.ts`: canonical `platform` property, runtime busy query, FIFO submission, reset ordering.
- Modify `core/src/index.ts`: preserve service construction order and production-path wiring.

### OneBot adapter and tools

- Modify `plugins/platform-onebot/src/index.ts`: `refine()`, canonical service entry, no assertions.
- Modify `plugins/platform-onebot/src/events.ts`: precise complete Event return.
- Modify `plugins/platform-onebot/src/prepare.ts`: recursive streamed image preparation.
- Modify `plugins/onebot-utils/src/index.ts`: guarded raw/segment forward normalization.
- Modify `plugins/onebot-utils/src/types.ts`: retain only the minimal unknown-facing OneBot capability contract.

### Tests and documentation

- Modify `core/tests/platform-types.test.ts`.
- Create `core/tests/platform-exports.test.ts`.
- Create `core/tests/platform-service.test.ts`.
- Delete `core/tests/platform-normalize.test.ts`.
- Modify `core/tests/platform-session.test.ts`.
- Create `core/tests/apply.test.ts`.
- Modify `core/tests/platform-service-helper.ts`.
- Modify `core/tests/message-flow.test.ts`.
- Create `core/tests/channel-lifecycle.test.ts`.
- Recreate `core/tests/reset.test.ts`.
- Modify `core/tests/channel-context.test.ts`.
- Modify `core/tests/error-handling.test.ts`.
- Modify `core/tests/platform-elements.test.ts`.
- Modify `core/tests/platform-prepare.test.ts`.
- Modify `core/tests/platform-projection.test.ts`.
- Create `core/tests/platform-assets.test.ts`.
- Modify `plugins/platform-onebot/tests/plugin.test.ts`.
- Modify `plugins/platform-onebot/tests/events.test.ts`.
- Modify `plugins/platform-onebot/tests/prepare.test.ts`.
- Modify `plugins/onebot-utils/tests/onebot-utils.test.ts`.
- Modify `core/README.md`.
- Modify `plugins/platform-onebot/README.md`.

---

### Task 1: Correct The Normative Specifications

**Files:**
- Modify: `openspec/changes/simplify-platform-adapter-model/specs/core-runtime-integration/spec.md`
- Modify: `openspec/changes/simplify-platform-adapter-model/specs/platform-event-contract/spec.md`
- Modify: `openspec/changes/simplify-platform-adapter-model/specs/platform-message-ingestion/spec.md`
- Modify: `openspec/changes/simplify-platform-adapter-model/specs/onebot-utils/spec.md`
- Reference: `openspec/changes/simplify-platform-adapter-model/review-fix-design.md`

**Interfaces:**
- Consumes: all approved decisions in `review-fix-design.md`.
- Produces: normative requirements that later code and tests can cite without conflict.

- [ ] **Step 1: Replace the old single-stage FIFO requirement**

In `specs/core-runtime-integration/spec.md`, state the exact sequence:

```text
For each admitted channel input, core MUST serialize static classification,
message preparation, channel Agent resolution, the final runtime busy read, and
the initial append/send/run submission in the per-channel FIFO. Static
classification MUST produce ignore, append, or reply without consulting busy
state. For reply inputs, core MUST read Agent.getActiveTurnId() after preparation
and immediately before submission, with no await between the read and
send(join) or run. Model stream consumption and outbound delivery MUST occur
outside the FIFO.
```

Also specify the reset sequence as strictly ordered:

```text
interrupt -> stop -> message storage clear -> channel asset clear -> runtime cache delete
```

Specify `ctx.yesimbot.platform` as the sole documented platform service entry. Do not mention `ctx["yesimbot.platform"]` as a plugin-facing API.

- [ ] **Step 2: Remove event receipt stamping from the event contract**

In `specs/platform-event-contract/spec.md`, define Event as semantic data only:

```text
Platform.Event MUST contain source, scope, type, optional platform timestamp,
typed data, and frozen textual content. It MUST NOT contain core receipt time.
platform.publish(event) MUST synchronously invoke event subscribers with the
same semantic event. Ordinary Platform.Message values MUST NOT be delivered to
event subscribers.
```

- [ ] **Step 3: Pin the final adapter and image contracts**

In `specs/platform-message-ingestion/spec.md`, add the exact discriminated result:

```ts
type RefineResult =
  | { kind: "keep" }
  | { kind: "ignore" }
  | { kind: "message"; message: Platform.Message }
  | { kind: "event"; event: Platform.Event }
```

State all of the following explicitly:

- Adapter identity is flat: `id`, optional `platform`, optional `adapter`, optional `profile`.
- `message` is invalid when no core base exists.
- `accepts() === false` may decline to another candidate; thrown `accepts()` or `refine()` records a diagnostic and never selects another adapter.
- A failed `accepts()` or `refine()` skips that adapter's `prepare()` for the Session.
- `prepare()` returns complete `Element[] | void`, never a string.
- `ImagePrepareSink` is `put(bytes)` only.
- MIME comes only from verified bytes.
- Actual HTTP stream bytes and decoded `data:` bytes are bounded and abortable.
- `AssetStore`, asset read/clear, storage layout, and budget constants are not adapter exports.

- [ ] **Step 4: Pin structured OneBot forward behavior**

In `specs/onebot-utils/spec.md`, add:

```text
Forward content normalization MUST accept both raw text/CQ strings and
structured OneBot segment arrays. Text segments contribute text; image, record,
video, and file segments become fixed text placeholders; unknown segments are
dropped. Implementations MUST NOT implicitly stringify objects.
```

- [ ] **Step 5: Verify the normative text contains the approved decisions**

Run:

```bash
rtk proxy rg -n "getActiveTurnId|ctx\.yesimbot\.platform|RefineResult|MUST NOT contain core receipt time|structured OneBot segment" openspec/changes/simplify-platform-adapter-model/specs
```

Expected: one or more matches for every approved phrase and no conflicting requirement that says Event is stamped with `receivedAt` or that full busy routing occurs before preparation.

- [ ] **Step 6: Review checkpoint**

Read the four modified specs together with `review-fix-design.md`. Confirm that the old `plan.md`, `tasks.md`, and `verify.md` are untouched.

---

### Task 2: Replace The Public Contracts And Platform Service Atomically

**Files:**
- Modify: `core/src/platform/types.ts`
- Modify: `core/src/platform/index.ts`
- Modify: `core/src/platform/service.ts`
- Modify: `core/src/platform/message.ts`
- Delete: `core/src/platform/normalize.ts`
- Modify: `core/src/runtime/message.ts`
- Modify: `core/src/runtime/service.ts`
- Modify: `core/src/index.ts`
- Modify: `core/tests/platform-types.test.ts`
- Create: `core/tests/platform-exports.test.ts`
- Create: `core/tests/platform-service.test.ts`
- Delete: `core/tests/platform-normalize.test.ts`
- Modify: `core/tests/platform-session.test.ts`
- Create: `core/tests/apply.test.ts`
- Modify: `core/tests/platform-service-helper.ts`
- Modify: `core/tests/channel-context.test.ts`
- Modify: `core/tests/error-handling.test.ts`
- Modify: `core/tests/platform-prepare.test.ts`
- Modify: `plugins/platform-onebot/src/index.ts`
- Modify: `plugins/platform-onebot/src/events.ts`
- Modify: `plugins/platform-onebot/src/prepare.ts`
- Modify: `plugins/platform-onebot/tests/plugin.test.ts`
- Modify: `plugins/platform-onebot/tests/events.test.ts`
- Modify: `plugins/platform-onebot/tests/prepare.test.ts`

**Interfaces:**
- Consumes: Task 1 normative contracts.
- Produces:
  - `Platform.Message.elements: Element[]`
  - `Platform.MessageRecord`
  - `Platform.RefineResult`
  - `Platform.Adapter.refine(input): RefineResult`
  - `Platform.ImagePrepareSink.put(bytes)`
  - `YesImBotService.platform: PlatformService`
  - `ctx.yesimbot.platform`

- [ ] **Step 1: Write the failing public type tests**

Replace the old event and persisted-record cases in `core/tests/platform-types.test.ts` with precise type assertions:

```ts
import { h, type Element } from "koishi"
import { describe, expect, expectTypeOf, it, vi } from "vitest"
import type { Platform } from "../src/platform/index.js"

declare module "../src/platform/types.js" {
  interface PlatformEventVariants {
    "test.action": { value: number }
  }
}

it("uses Koishi Element and a channel-only MessageRecord", () => {
  expectTypeOf<Platform.Message["elements"]>().toEqualTypeOf<Element[]>()
  expectTypeOf<Platform.MessageRecord["scope"]>().toEqualTypeOf<
    Platform.Message["scope"]
  >()

  const record: Platform.MessageRecord = {
    source: { platform: "test", selfId: "bot" },
    scope: { type: "channel", channelId: "room" },
    sender: { id: "user" },
    messageId: "m1",
    receivedAt: 1,
    content: h.text("hello").toString(),
  }
  expect(record.content).toBe("hello")
})

it("does not expose receipt time on events", () => {
  const event: Platform.Event<"test.action"> = {
    source: { platform: "test", selfId: "bot" },
    scope: { type: "account" },
    type: "test.action",
    data: { value: 1 },
    content: "updated",
  }
  expect(event.type).toBe("test.action")

  const invalid: Platform.Event<"test.action"> = {
    ...event,
    // @ts-expect-error Event no longer contains core receipt time
    receivedAt: 1,
  }
  expect(invalid).toBeDefined()
})

it("removes the legacy type names", () => {
  // @ts-expect-error MsgElement was replaced by Koishi Element
  expectTypeOf<import("../src/platform/types.js").MsgElement>()
  // @ts-expect-error PersistedPlatformMessage was renamed without an alias
  expectTypeOf<import("../src/platform/types.js").PersistedPlatformMessage>()
})
```

Add `core/tests/platform-exports.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import * as platformApi from "../src/platform/index.js"

describe("platform public exports", () => {
  it("does not expose core asset capabilities", () => {
    expect(platformApi).not.toHaveProperty("AssetStore")
    expect(platformApi).not.toHaveProperty("IMAGE_BUDGET")
  })
})
```

- [ ] **Step 2: Run the contract tests and verify the expected failures**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-types.test.ts tests/platform-exports.test.ts
```

Expected: FAIL because `Element[]`, `Platform.MessageRecord`, the narrowed Event, and the export removals do not exist yet.

- [ ] **Step 3: Replace `types.ts` with the final contract names**

Implement the final shapes without aliases:

```ts
import type { Element, Session } from "koishi"

export namespace Platform {
  export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
  export type JsonObject = { [key: string]: Json }

  export interface Source {
    platform: string
    selfId: string
  }

  export type Scope =
    | { type: "channel"; channelId: string; guildId?: string; threadId?: string }
    | { type: "guild"; guildId: string }
    | { type: "account" }

  export interface Sender {
    id: string
    name?: string
  }

  export interface Message {
    source: Source
    scope: Extract<Scope, { type: "channel" }>
    sender: Sender
    messageId: string
    timestamp?: number
    receivedAt: number
    elements: Element[]
  }

  export interface MessageRecord {
    source: Source
    scope: Message["scope"]
    sender: Sender
    messageId: string
    timestamp?: number
    receivedAt: number
    content: string
  }

  export interface Event<K extends keyof PlatformEventVariants = keyof PlatformEventVariants> {
    source: Source
    scope: Scope
    type: K
    timestamp?: number
    data: PlatformEventVariants[K]
    content: string
  }

  export interface ImagePrepareSink {
    put(bytes: Uint8Array): Promise<{ assetId: string; mime: string }>
  }

  export interface ImageBudget {
    maxImages: number
    maxBytesPerImage: number
    maxTotalBytes: number
    timeoutMs: number
    concurrency: number
    allowedMime: readonly string[]
  }

  export interface PrepareContext {
    readonly session: Session
    readonly message: Readonly<Message>
    readonly images: ImagePrepareSink
    readonly budget: ImageBudget
  }

  export type RefineResult =
    | { kind: "keep" }
    | { kind: "ignore" }
    | { kind: "message"; message: Message }
    | { kind: "event"; event: Event }

  export interface Adapter {
    readonly id: string
    readonly platform?: string
    readonly adapter?: string
    readonly profile?: string
    accepts?(session: Session): boolean
    refine?(input: { readonly session: Session; readonly base?: Message }): RefineResult
    prepare?(ctx: PrepareContext): Promise<Element[] | void>
  }

  export interface Diagnostic {
    code: string
    message: string
    adapterId?: string
    eventType?: string
    nativeType?: string
    cause?: string
  }
}

export interface PlatformEventVariants {}

declare module "@yesimbot/agent-runtime" {
  interface AgentCustomMessages {
    "athena.platform.message": import("@yesimbot/agent-runtime").CustomMessageBase<
      "athena.platform.message",
      Platform.MessageRecord
    >
  }
}
```

- [ ] **Step 4: Migrate literal and model helpers to `Element` and `Platform.MessageRecord`**

In `core/src/platform/message.ts`:

- import `type Element` from Koishi;
- make `elementsToLiteral(elements: readonly Element[]): string`;
- make `literalToElements(content: string): Element[]` return `h.normalize(content)` directly;
- replace the pseudo `<br>` object with `h("br")`;
- rename `messageFromPersisted()` to `messageFromRecord()` with no alias;
- change `projectPlatformMessage()` to accept `Platform.MessageRecord`;
- replace all `any`, `any[]`, `MsgElement`, and `PersistedPlatformMessage` references.

In `core/src/runtime/message.ts`, construct a record directly:

```ts
export function createPlatformMessage(message: Platform.Message) {
  const data: Platform.MessageRecord = {
    source: message.source,
    scope: message.scope,
    sender: message.sender,
    messageId: message.messageId,
    receivedAt: message.receivedAt,
    content: elementsToLiteral(message.elements),
    ...(message.timestamp !== undefined ? { timestamp: message.timestamp } : {}),
  }

  return createCustomMessage("athena.platform.message", data, {
    id: message.messageId,
    timestamp: message.timestamp ?? message.receivedAt,
  })
}
```

Update all tests and imports to use `Platform.MessageRecord`. Do not export a top-level alias.

- [ ] **Step 5: Narrow the asset seam immediately**

Change `PlatformService`'s image sink to:

```ts
const images: Platform.ImagePrepareSink = {
  put: (bytes) => this.#assetStore.put(scope, bytes),
}
```

Change `AssetStore.put()` to accept `(scope, data: Uint8Array)` and delete `mimeHint` fallback. Remove the public `assetStore` getter. Keep `IMAGE_BUDGET` internal to `assets.ts` and `service.ts`.

Replace `core/src/platform/index.ts` with:

```ts
export { PlatformConfigSchema, DEFAULT_PLATFORM, type PlatformConfig } from "./config.js"
export { PlatformService } from "./service.js"
export type * from "./types.js"
```

In `plugins/platform-onebot/tests/prepare.test.ts`, define the test budget locally instead of importing `IMAGE_BUDGET`:

```ts
const budget = {
  maxImages: 4,
  maxBytesPerImage: 5 * 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
  timeoutMs: 10_000,
  concurrency: 2,
  allowedMime: ["image/jpeg", "image/png", "image/webp", "image/gif"],
} satisfies Platform.ImageBudget
```

- [ ] **Step 6: Write the failing refine, listener, weak-state, and production wiring tests**

Create `core/tests/platform-service.test.ts` with a local Session factory and these exact assertions:

```ts
declare module "../src/platform/types.js" {
  interface PlatformEventVariants {
    "test.action": { value: number }
  }
}

function session(overrides: Record<string, unknown> = {}): Session {
  return {
    platform: "test",
    selfId: "bot",
    channelId: "room",
    userId: "user",
    messageId: "m1",
    content: "hello",
    event: { type: "message" },
    bot: { adapterName: "test", sid: "test:bot" },
    ...overrides,
  } as unknown as Session
}

function testEvent(): Platform.Event<"test.action"> {
  return {
    source: { platform: "test", selfId: "bot" },
    scope: { type: "account" },
    type: "test.action",
    data: { value: 1 },
    content: "updated",
  }
}

function replacementMessage(receivedAt = 0): Platform.Message {
  return {
    source: { platform: "test", selfId: "bot" },
    scope: { type: "channel", channelId: "room" },
    sender: { id: "user" },
    messageId: "replacement",
    receivedAt,
    elements: [h.text("replacement")],
  }
}

it.each([
  ["keep", { kind: "keep" }],
  ["ignore", { kind: "ignore" }],
] as const)("handles the %s refine result", (_label, result) => {
  const service = createTestPlatformService({ now: () => 10 })
  service.register({ id: "test", platform: "test", refine: () => result })
  const input = session()

  const message = service.collectIfNeeded(input)

  expect(message === undefined).toBe(result.kind === "ignore")
})

it("preserves core receivedAt when refine replaces a base message", () => {
  const service = createTestPlatformService({ now: () => 10 })
  service.register({
    id: "test",
    platform: "test",
    refine: ({ base }) => ({
      kind: "message",
      message: { ...base!, receivedAt: 999, elements: [h.text("refined")] },
    }),
  })

  expect(service.collectIfNeeded(session())?.receivedAt).toBe(10)
})

it("never sends ordinary messages to event subscribers", () => {
  const service = createTestPlatformService({ now: () => 10 })
  const listener = vi.fn()
  service.subscribe(listener)

  expect(service.collectIfNeeded(session())).toBeDefined()
  expect(listener).not.toHaveBeenCalled()
})

it("publishes complete semantic events without receipt time", () => {
  const service = createTestPlatformService({ now: () => 10 })
  const listener = vi.fn()
  service.subscribe(listener)
  const event = testEvent()

  expect(service.publish(event)).toBe(event)
  expect(listener).toHaveBeenCalledWith(event)
  expect(listener.mock.calls[0]?.[0]).not.toHaveProperty("receivedAt")
})

it("does not try another adapter after accepts throws", () => {
  const diagnostics: Platform.Diagnostic[] = []
  const second = vi.fn(() => true)
  const service = createTestPlatformService({
    platform: { profiles: { "test:bot": "primary" } },
    diagnostic: (d) => diagnostics.push(d as Platform.Diagnostic),
  })
  service.register({ id: "first", profile: "primary", accepts: () => { throw new Error("boom") } })
  service.register({ id: "second", platform: "test", accepts: second })

  expect(service.collectIfNeeded(session())).toBeDefined()
  expect(second).not.toHaveBeenCalled()
  expect(diagnostics).toContainEqual(expect.objectContaining({ code: "platform.adapter_accept_failed" }))
})
```

Add these concrete cases:

```ts
it("prefers profile, then adapter, then platform", () => {
  const calls: string[] = []
  const service = createTestPlatformService({
    platform: { profiles: { "test:bot": "primary" } },
  })
  service.register({ id: "platform", platform: "test", refine: () => { calls.push("platform"); return { kind: "keep" } } })
  service.register({ id: "adapter", adapter: "test", refine: () => { calls.push("adapter"); return { kind: "keep" } } })
  service.register({ id: "profile", profile: "primary", refine: () => { calls.push("profile"); return { kind: "keep" } } })

  service.collectIfNeeded(session())
  expect(calls).toEqual(["profile"])
})

it("falls to the next rank after an explicit decline", () => {
  const refine = vi.fn(() => ({ kind: "keep" } as const))
  const service = createTestPlatformService({
    platform: { profiles: { "test:bot": "primary" } },
  })
  service.register({ id: "profile", profile: "primary", accepts: () => false })
  service.register({ id: "platform", platform: "test", refine })
  service.collectIfNeeded(session())
  expect(refine).toHaveBeenCalledOnce()
})

it("throws a stable same-rank conflict", () => {
  const service = createTestPlatformService()
  service.register({ id: "b", platform: "test" })
  service.register({ id: "a", platform: "test" })
  expect(() => service.collectIfNeeded(session())).toThrow(
    "Platform adapter conflict at rank 1: a, b",
  )
})

it("delivers an Event result when no base exists", () => {
  const service = createTestPlatformService()
  const listener = vi.fn()
  service.subscribe(listener)
  service.register({ id: "event", platform: "test", refine: () => ({ kind: "event", event: testEvent() }) })
  const input = session({ channelId: undefined, content: undefined })
  expect(service.collectIfNeeded(input)).toBeUndefined()
  expect(listener).toHaveBeenCalledWith(testEvent())
})

it("rejects a Message result when no base exists", () => {
  const diagnostics: Platform.Diagnostic[] = []
  const service = createTestPlatformService({ diagnostic: (d) => diagnostics.push(d as Platform.Diagnostic) })
  service.register({ id: "bad", platform: "test", refine: () => ({ kind: "message", message: replacementMessage() }) })
  expect(service.collectIfNeeded(session({ channelId: undefined, content: undefined }))).toBeUndefined()
  expect(diagnostics).toContainEqual(expect.objectContaining({ code: "platform.invalid_refine_result" }))
})

it("keeps the base and skips prepare after refine throws", async () => {
  const prepare = vi.fn()
  const service = createTestPlatformService()
  service.register({ id: "broken", platform: "test", refine: () => { throw new Error("boom") }, prepare })
  const input = session()
  const base = service.collectIfNeeded(input)!
  await service.prepareMessage(input, base)
  expect(base.elements[0].toString()).toContain("hello")
  expect(prepare).not.toHaveBeenCalled()
})

it("reuses the adapter selected during collection", async () => {
  const prepareA = vi.fn(async ({ message }: Platform.PrepareContext) => message.elements)
  const prepareB = vi.fn(async ({ message }: Platform.PrepareContext) => message.elements)
  const service = createTestPlatformService()
  const disposeA = service.register({ id: "a", platform: "test", prepare: prepareA })
  const input = session()
  const base = service.collectIfNeeded(input)!
  disposeA()
  service.register({ id: "b", platform: "test", prepare: prepareB })
  await service.prepareMessage(input, base)
  expect(prepareA).toHaveBeenCalledOnce()
  expect(prepareB).not.toHaveBeenCalled()
})

it("collects one Session object only once", () => {
  const refine = vi.fn(() => ({ kind: "keep" } as const))
  const service = createTestPlatformService()
  service.register({ id: "test", platform: "test", refine })
  const input = session()
  service.collectIfNeeded(input)
  service.collectIfNeeded(input)
  expect(refine).toHaveBeenCalledOnce()
})
```

Create `core/tests/apply.test.ts` using a real `Context`, the real `apply()`, mocked storage/model resolution, and no constructor dependency argument:

```ts
function groupSession(): Session {
  return {
    platform: "test",
    selfId: "bot",
    channelId: "room",
    userId: "user",
    messageId: "m1",
    content: "observation",
    send: vi.fn(async () => undefined),
  } as unknown as Session
}

it("wires the first production message through ctx.yesimbot.platform", async () => {
  const temporaryBasePath = await mkdtemp(join(tmpdir(), "yesimbot-apply-"))
  const ctx = new Context()
  ctx.baseDir = temporaryBasePath
  apply(ctx as never, config)
  vi.spyOn(ctx["yesimbot.model"], "resolveChatModel").mockReturnValue({
    model: { modelId: "mock:model" },
  } as never)

  expect(ctx.yesimbot.platform).toBe(ctx["yesimbot.platform"])
  await ctx.yesimbot.handleSession(groupSession() as never)
  expect(runtimeMocks.append).toHaveBeenCalledOnce()
})
```

Use these hoisted mocks so the test exercises service construction and routing without writing repository files:

```ts
const runtimeMocks = vi.hoisted(() => ({
  append: vi.fn(async () => undefined),
}))

vi.mock("@yesimbot/agent-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@yesimbot/agent-runtime")>()
  return {
    ...actual,
    createAgent: vi.fn(() => ({
      id: "runtime",
      channel: { emit: vi.fn(), subscribe: vi.fn(() => () => undefined) },
      storage: {} as never,
      state: {} as never,
      init: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      append: runtimeMocks.append,
      send: vi.fn(() => "turn"),
      run: vi.fn(() => ({ async *[Symbol.asyncIterator]() {} })),
      wait: vi.fn(async () => undefined),
      interrupt: vi.fn(async () => undefined),
      setTools: vi.fn(),
      getModel: vi.fn(),
      setModel: vi.fn(),
      clear: vi.fn(async () => undefined),
      getActiveTurnId: vi.fn(() => undefined),
      isIdle: vi.fn(() => true),
    })),
  }
})

vi.mock("../src/runtime/storage.js", () => ({
  createJsonlStorage: vi.fn(() => ({
    append: vi.fn(async () => undefined),
    read: vi.fn(async () => []),
    clear: vi.fn(async () => undefined),
  })),
}))

vi.mock("../src/channel.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/channel.js")>()
  return { ...actual, ensureChannelScopeRecord: vi.fn(async () => undefined) }
})
```

- [ ] **Step 7: Run the new service tests and verify they fail against the legacy service**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-service.test.ts tests/platform-session.test.ts tests/apply.test.ts
```

Expected: FAIL on missing `refine()`, Message-as-Event delivery, constructor wiring, and adapter reuse.

- [ ] **Step 8: Centralize matching and refinement in `PlatformService`**

Use weak Session state:

```ts
interface SessionAdapterState {
  adapter?: Platform.Adapter
  failed: boolean
}

#sessionMessages = new WeakMap<Session, Platform.Message>()
#sessionAdapters = new WeakMap<Session, SessionAdapterState>()
#collectedSessions = new WeakSet<Session>()
```

Implement one private selector in `service.ts`:

1. Build descriptor candidates and ranks.
2. Evaluate rank groups from highest to lowest.
3. Within a rank, call `accepts()` only for candidates at that rank.
4. Continue to the next rank only when every candidate explicitly declines.
5. Return one accepted adapter.
6. Throw a configuration conflict when multiple adapters at the winning rank accept.
7. On thrown `accepts()`, report `platform.adapter_accept_failed`, return `{ failed: true }`, and stop selection.

Implement `#collectSession()` as one switch over `RefineResult`. Preserve `base.receivedAt` on Message replacement. Set `failed = true` for thrown refinement or invalid Message-without-base results. Store ordinary messages only in `#sessionMessages`; notify subscribers only for Event results.

Delete `normalize.ts` and `platform-normalize.test.ts`. Do not re-export any replacement normalizer.

Require collection before preparation:

```ts
if (!this.#collectedSessions.has(session)) {
  throw new Error("Platform message must be collected before preparation")
}

const state = this.#sessionAdapters.get(session)
if (!state?.failed && state?.adapter?.prepare) {
  // invoke the already-selected adapter
}
```

Update `platform-prepare.test.ts` so every case prepares the exact message collected from its Session instead of passing a handcrafted uncollected draft:

```ts
const input = session({ elements: [h.text("hello")] }) as never
const draft = registry.collectIfNeeded(input)!
const prepared = await registry.prepareMessage(input, draft)
```

For remote-image cases, put the remote image in `session.elements`. Register the adapter before `collectIfNeeded()` so the cached selection is the one exercised by preparation. Do not add a prepare-time rematch fallback for old tests.

- [ ] **Step 9: Make `ctx.yesimbot.platform` the only plugin-facing service path**

In `core/src/runtime/service.ts`:

```ts
public readonly model: ModelService
public readonly platform: PlatformService

constructor(ctx: Context, config: Config) {
  super(ctx, "yesimbot", true)
  this.config = config
  this.model = ctx["yesimbot.model"]
  this.platform = ctx["yesimbot.platform"]
  // existing command and middleware setup
}
```

Delete the optional `deps` argument, `platformService` property, and deprecated getter. Replace internal references with `this.platform`.

Keep the real `apply()` order as Platform, Model, Runtime. Add a precise Koishi Context augmentation for the internal service key in core, while documentation and plugins expose only `ctx.yesimbot.platform`.

Update all core tests to create `PlatformService` on the same Context before constructing `YesImBotService`. Do not retain the dependency-injection overload for tests.

- [ ] **Step 10: Replace OneBot `adapt()` with typed `refine()`**

Rename `adaptMessageReactionsUpdated()` to `refineMessageReactionsUpdated()` with this return type:

```ts
export function refineMessageReactionsUpdated(
  session: Session,
): Platform.Event<"onebot.message-reactions-updated"> | undefined
```

Build the adapter without assertions:

```ts
export function createOneBotAdapter(ctx: Context): Platform.Adapter {
  return {
    id: "yesimbot.onebot",
    adapter: "onebot",
    refine: ({ session }) => {
      const event = refineMessageReactionsUpdated(session)
      return event ? { kind: "event", event } : { kind: "keep" }
    },
    prepare: (prepareCtx) => prepareOneBotMessage(ctx, prepareCtx),
  }
}

export const inject = ["yesimbot"]

export function apply(ctx: Context): void {
  const dispose = ctx.yesimbot.platform.register(createOneBotAdapter(ctx))
  ctx.on("dispose", dispose)
}
```

Delete old function exports and test expectations for `adapt`. Do not provide an alias.

- [ ] **Step 11: Run focused tests and package type checks**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-types.test.ts tests/platform-exports.test.ts tests/platform-service.test.ts tests/platform-session.test.ts tests/apply.test.ts tests/platform-prepare.test.ts tests/channel-context.test.ts tests/error-handling.test.ts
rtk yarn workspace koishi-plugin-yesimbot-platform-onebot exec vitest run tests/plugin.test.ts tests/events.test.ts tests/prepare.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-platform-onebot
```

Expected: all listed suites and both type checks PASS.

- [ ] **Step 12: Prove no compatibility surface remains**

Run:

```bash
rtk proxy rg -n "MsgElement|PersistedPlatformMessage|\badapt\b|platformService|ctx as any|as any|IMAGE_BUDGET.*koishi-plugin-yesimbot/platform" core/src core/tests plugins/platform-onebot/src plugins/platform-onebot/tests
```

Expected: no matches. Fix real remaining uses; do not add allowlists or aliases.

- [ ] **Step 13: Review checkpoint**

Compare the final exported declarations and service flow against design sections 1-5. Confirm `normalize.ts` and its test are deleted, and that no test constructs `YesImBotService` through a hidden dependency overload.

---

### Task 3: Rebuild FIFO Submission And Reset Around Agent Runtime State

**Files:**
- Modify: `core/src/runtime/message.ts`
- Modify: `core/src/runtime/service.ts`
- Modify: `core/tests/message-flow.test.ts`
- Create: `core/tests/channel-lifecycle.test.ts`
- Create: `core/tests/reset.test.ts`
- Modify: `core/tests/platform-session.test.ts`
- Modify: `core/tests/channel-context.test.ts`
- Modify: `core/tests/error-handling.test.ts`

**Interfaces:**
- Consumes: `YesImBotService.platform`, collected `Platform.Message`, Agent `getActiveTurnId()`.
- Produces:
  - `classifyMessage(session): "ignore" | "append" | "reply"`
  - FIFO-contained prepare/runtime resolution/final busy read/submission
  - ordered reset lifecycle

- [ ] **Step 1: Replace route helper tests with static classification tests**

In `core/tests/message-flow.test.ts`, replace `createMessageRoute()` expectations:

```ts
expect(classifyMessage(group)).toBe("append")
expect(classifyMessage({ ...group, content: '<at id="bot"/> hello' })).toBe("reply")
expect(classifyMessage({ ...group, subtype: "private" })).toBe("reply")
expect(classifyMessage({ ...group, userId: "bot" })).toBe("ignore")
```

Delete every `isBusy` fixture from helper tests.

- [ ] **Step 2: Write failing channel lifecycle tests**

Create `core/tests/channel-lifecycle.test.ts` with a hoisted runtime state:

```ts
interface Deferred<T> {
  promise: Promise<T>
  resolve(value?: T): void
  reject(error: unknown): void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return {
    promise,
    resolve: (value) => resolve(value as T),
    reject,
  }
}

const runtimeState = vi.hoisted(() => ({
  activeTurnId: undefined as string | undefined,
  runGate: undefined as Deferred<void> | undefined,
  run: vi.fn(),
  send: vi.fn(),
  append: vi.fn(async () => undefined),
}))
```

Use one test harness throughout the file:

```ts
function createSession(
  kind: "private" | "group",
  overrides: Record<string, unknown> = {},
): Session {
  return {
    platform: "test",
    selfId: "bot",
    channelId: "room",
    userId: "user",
    messageId: "m1",
    content: kind === "private" ? "hello" : "observation",
    subtype: kind === "private" ? "private" : undefined,
    isDirect: kind === "private",
    send: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as Session
}

function createPrepareGate() {
  const entered = createDeferred<void>()
  const release = createDeferred<void>()
  return {
    entered: entered.promise,
    release: () => release.resolve(),
    async wait() {
      entered.resolve()
      await release.promise
    },
  }
}

function createHarness() {
  runtimeState.activeTurnId = undefined
  runtimeState.runGate = createDeferred<void>()
  const ctx = createContext()
  const platform = createTestPlatformService({ ctx: ctx as never })
  const prepareGates: Array<ReturnType<typeof createPrepareGate>> = []
  platform.register({
    id: "test",
    platform: "test",
    async prepare({ message }) {
      const gate = prepareGates.shift()
      if (gate) await gate.wait()
      return message.elements
    },
  })
  const service = new YesImBotService(ctx, config)
  return {
    service,
    runtime: runtimeMocks.runtime,
    gateNextPrepare() {
      const gate = createPrepareGate()
      prepareGates.push(gate)
      return gate
    },
    privateSession: (overrides?: Record<string, unknown>) => createSession("private", overrides),
    groupSession: (overrides?: Record<string, unknown>) => createSession("group", overrides),
  }
}
```

`createContext()`, `config`, and the `createAgent` mock follow the existing core test pattern. The mock runtime's `interrupt()` must clear `activeTurnId` and resolve the current stream gate so reset cannot leave a consumer hanging.

The runtime mock must implement:

```ts
getActiveTurnId: vi.fn(() => runtimeState.activeTurnId),
run: vi.fn(() => {
  runtimeState.activeTurnId = "turn-1"
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "turn.start", turnId: "turn-1" }
      await runtimeState.runGate!.promise
      runtimeState.activeTurnId = undefined
      yield { type: "turn.done", turnId: "turn-1" }
    },
  }
}),
send: vi.fn(() => "turn-1"),
```

Add exact behavioral cases:

```ts
it("joins a second reply into the active runtime turn", async () => {
  const { service, runtime, privateSession } = createHarness()
  const first = service.handleSession(privateSession({ messageId: "a" }))
  await vi.waitFor(() => expect(runtime.run).toHaveBeenCalledOnce())

  await service.handleSession(privateSession({ messageId: "b" }))

  expect(runtime.run).toHaveBeenCalledOnce()
  expect(runtime.send).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ messageId: "b" }) }),
    { ifBusy: "join" },
  )
  runtimeState.runGate!.resolve()
  await first
})

it("starts a new run when the prior turn ends during preparation", async () => {
  const { service, runtime, privateSession, gateNextPrepare } = createHarness()
  const first = service.handleSession(privateSession({ messageId: "a" }))
  await vi.waitFor(() => expect(runtime.run).toHaveBeenCalledOnce())

  const prepareGate = gateNextPrepare()
  const second = service.handleSession(privateSession({ messageId: "b" }))
  await prepareGate.entered
  runtimeState.runGate!.resolve()
  await first
  prepareGate.release()
  await second

  expect(runtime.run).toHaveBeenCalledTimes(2)
  expect(runtime.send).not.toHaveBeenCalled()
})

it("does not hold the FIFO while consuming a model stream", async () => {
  const { service, runtime, privateSession, groupSession } = createHarness()
  const first = service.handleSession(privateSession({ messageId: "a" }))
  await vi.waitFor(() => expect(runtime.run).toHaveBeenCalledOnce())

  await service.handleSession(groupSession({ messageId: "observation" }))
  expect(runtime.append).toHaveBeenCalledOnce()

  runtimeState.runGate!.resolve()
  await first
})
```

Add a fourth case proving different channel FIFOs remain concurrent:

```ts
it("prepares different channels concurrently", async () => {
  const { service, privateSession, gateNextPrepare } = createHarness()
  const gateA = gateNextPrepare()
  const gateB = gateNextPrepare()

  const first = service.handleSession(privateSession({ channelId: "a", messageId: "a" }))
  const second = service.handleSession(privateSession({ channelId: "b", messageId: "b" }))

  await Promise.all([gateA.entered, gateB.entered])
  gateA.release()
  gateB.release()
  runtimeState.runGate!.resolve()
  await Promise.all([first, second])
})
```

- [ ] **Step 3: Write failing reset ordering tests**

Recreate `core/tests/reset.test.ts`. Use one operation log shared by runtime, storage, and platform clear mocks:

```ts
interface Deferred<T> {
  promise: Promise<T>
  resolve(value?: T): void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve: (value) => resolve(value as T) }
}

function createSession(
  kind: "private" | "group",
  overrides: Record<string, unknown> = {},
): Session {
  return {
    platform: "test",
    selfId: "bot",
    channelId: "room",
    userId: "user",
    messageId: "m1",
    content: kind === "private" ? "hello" : "observation",
    subtype: kind === "private" ? "private" : undefined,
    isDirect: kind === "private",
    send: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as Session
}

function createOperationGate(label: string, operations: string[]) {
  const entered = createDeferred<void>()
  const release = createDeferred<void>()
  return {
    entered: entered.promise,
    release: () => release.resolve(),
    async run() {
      operations.push(`${label}:start`)
      entered.resolve()
      await release.promise
      operations.push(`${label}:end`)
    },
  }
}
```

The reset harness uses the same hoisted `createAgent()` and storage mocks as the existing reset tests, and returns concrete gates:

```ts
function createResetHarness() {
  const operations: string[] = []
  const prepareGates = new Map<string, ReturnType<typeof createOperationGate>>()
  runtimeMocks.operations = operations
  storageMocks.operations = operations

  const ctx = createContext()
  const platform = createTestPlatformService({ ctx: ctx as never })
  vi.spyOn(platform, "clearChannel").mockImplementation(async () => {
    operations.push("assets.clear")
  })
  platform.register({
    id: "test",
    platform: "test",
    async prepare({ message }) {
      const gate = prepareGates.get(message.messageId)
      if (gate) await gate.run()
      return message.elements
    },
  })

  const service = new YesImBotService(ctx, config)
  const scope = { platform: "test", selfId: "bot", channelId: "room" }
  return {
    service,
    scope,
    operations,
    privateSession: (overrides?: Record<string, unknown>) =>
      createSession("private", overrides),
    gatePrepare(messageId: string) {
      const gate = createOperationGate(`prepare:${messageId}`, operations)
      prepareGates.set(messageId, gate)
      return gate
    },
  }
}
```

The hoisted runtime mock appends `run:<messageId>`, `interrupt`, and `stop`; the storage mock appends `storage.clear`. Runtime `interrupt()` must end the active stream.

```ts
it("serializes reset after prepare and before a later message", async () => {
  const { service, scope, operations, privateSession, gatePrepare } = createResetHarness()
  const prepareA = gatePrepare("a")
  const messageA = service.handleSession(privateSession({ messageId: "a" }))
  await prepareA.entered

  const reset = service.resetChannel(scope)
  const messageB = service.handleSession(privateSession({ messageId: "b" }))
  expect(operations).toEqual(["prepare:a:start"])

  prepareA.release()
  await reset
  await messageB

  expect(operations).toEqual([
    "prepare:a:start",
    "prepare:a:end",
    "run:a",
    "interrupt",
    "stop",
    "storage.clear",
    "assets.clear",
    "prepare:b:start",
    "prepare:b:end",
    "run:b",
  ])
  await messageA
})
```

Add the no-runtime reset case:

```ts
it("clears storage and assets without constructing a runtime", async () => {
  const { service, scope, operations } = createResetHarness()
  await service.resetChannel(scope)
  expect(runtimeMocks.createAgent).not.toHaveBeenCalled()
  expect(operations).toEqual(["storage.clear", "assets.clear"])
})
```

- [ ] **Step 4: Run the lifecycle tests and verify they fail**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/message-flow.test.ts tests/channel-lifecycle.test.ts tests/reset.test.ts
```

Expected: FAIL because routing still reads `activeTurns` outside the queue, the old helper accepts `isBusy`, and reset clears in parallel.

- [ ] **Step 5: Implement static classification**

Replace `MessageRoute` and `createMessageRoute()` with:

```ts
export type MessageClassification = "ignore" | "append" | "reply"

export function classifyMessage(
  session: Pick<Session, "userId" | "selfId" | "author" | "event" | "subtype" | "isDirect" | "content" | "elements">,
): MessageClassification {
  if (isSelfMessage(session)) return "ignore"
  return getChannelType(session) === "private" || mentionsSelf(session)
    ? "reply"
    : "append"
}
```

Delete `createMessageRoute()` without an alias.

- [ ] **Step 6: Move final busy routing next to Agent submission**

In `YesImBotService.handleSession()`:

1. Build `routeSession` as today.
2. Enter `enqueueChannel(key, ...)` before classification.
3. Classify inside the FIFO.
4. Return for ignore without preparation.
5. Prepare, resolve the Agent, and build the runtime message.
6. Append observations.
7. For replies, read `runtime.getActiveTurnId()` immediately before submission.
8. Call `send(join)` when active; otherwise assign `stream = runtime.run()`.
9. Consume `stream` outside `enqueueChannel()`.

The critical block must have no `await` between busy read and submission:

```ts
if (classification === "append") {
  submittedAction = "append"
  await runtime.append(runtimeMessage)
  return
}

if (runtime.getActiveTurnId() !== undefined) {
  submittedAction = "send"
  runtime.send(runtimeMessage, { ifBusy: "join" })
  return
}

submittedAction = "run"
stream = runtime.run(runtimeMessage)
```

Delete the `activeTurns` field and every set/delete/clear operation. Error logging should use `submittedAction ?? classification`; proactive generic replies apply only to reply classification.

- [ ] **Step 7: Make reset clearing strictly ordered**

Implement:

```ts
if (cached) {
  await cached.runtime.interrupt("reset")
  await cached.runtime.stop()
}

await storage.clear()
await this.platform.clearChannel(scope)
this.runtimes.delete(key)
```

Do not use `Promise.all()` for the two clear operations. Delete all reset interaction with `activeTurns`.

- [ ] **Step 8: Update every touched Agent mock to the real interface**

Every runtime mock in the listed core tests must contain:

```ts
getActiveTurnId: vi.fn(() => undefined),
isIdle: vi.fn(() => true),
clear: vi.fn(async () => undefined),
setModel: vi.fn(),
```

Do not silence missing methods with `as any`.

- [ ] **Step 9: Run focused lifecycle and error suites**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/message-flow.test.ts tests/channel-lifecycle.test.ts tests/reset.test.ts tests/platform-session.test.ts tests/channel-context.test.ts tests/error-handling.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

Expected: all tests and the core type check PASS.

- [ ] **Step 10: Review checkpoint**

Trace two simultaneous reply Sessions and one reset by hand through `handleSession()`. Confirm there is one channel FIFO, no core busy mirror, no stream consumption in the FIFO, and no path that submits `send(join)` after reading stale pre-prepare state.

---

### Task 4: Enforce Recursive Streamed Image And Asset Boundaries

**Files:**
- Create: `core/src/platform/utils/elements.ts`
- Modify: `core/src/platform/message.ts`
- Modify: `core/src/platform/assets.ts`
- Modify: `core/src/platform/service.ts`
- Modify: `core/tests/platform-elements.test.ts`
- Modify: `core/tests/platform-prepare.test.ts`
- Modify: `core/tests/platform-projection.test.ts`
- Create: `core/tests/platform-assets.test.ts`
- Modify: `plugins/platform-onebot/src/prepare.ts`
- Modify: `plugins/platform-onebot/tests/prepare.test.ts`

**Interfaces:**
- Consumes: `Platform.Message`, `Platform.ImagePrepareSink.put(bytes)`, fixed `ImageBudget`.
- Produces:
  - recursive allowlist normalization and sealing
  - ordered recursive model parts
  - magic-byte-only `AssetStore.put(scope, bytes)`
  - abortable streamed OneBot image preparation

- [ ] **Step 1: Write failing recursive core tests**

Extend `platform-elements.test.ts`:

```ts
function platformMessage(elements: Element[]): Platform.Message {
  return {
    source: { platform: "test", selfId: "bot" },
    scope: { type: "channel", channelId: "room" },
    sender: { id: "user" },
    messageId: "m1",
    receivedAt: 1,
    elements,
  }
}

it("seals nested remote images without dropping surrounding text", () => {
  const message = platformMessage([
    h("p", {}, [h.text("before"), h("img", { src: "https://example/a.png" }), h.text("after")]),
  ])

  const sealed = sealMessage(message)
  const literal = elementsToLiteral(sealed.elements)

  expect(literal).toContain("before")
  expect(literal).toContain("after")
  expect(literal).toContain('unavailable="true"')
  expect(literal).not.toContain("https://")
})
```

Extend `platform-projection.test.ts` with an asset-backed image nested between text nodes. Assert model content part order is text, image, text and `readByAssetId()` is called with the nested asset ID.

Create `platform-assets.test.ts`:

```ts
const scope = { platform: "test", selfId: "bot", channelId: "room" }
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0x00])
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const GIF_BYTES = new TextEncoder().encode("GIF89a")
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
])

let store: AssetStore

beforeEach(async () => {
  const basePath = await mkdtemp(join(tmpdir(), "yesimbot-assets-"))
  store = new AssetStore({ basePath, maxFileBytes: 5 * 1024 * 1024 })
})

it("rejects unknown bytes even when callers would claim an image MIME", async () => {
  await expect(store.put(scope, new TextEncoder().encode("<svg/>"))).rejects.toThrow(
    "Unsupported image MIME type",
  )
})

it.each([
  new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  new TextEncoder().encode("GIFxxx"),
])("rejects incomplete or invalid image signatures", async (bytes) => {
  await expect(store.put(scope, bytes)).rejects.toThrow("Unsupported image MIME type")
})

it.each([
  ["jpeg", JPEG_BYTES, "image/jpeg"],
  ["png", PNG_BYTES, "image/png"],
  ["gif", GIF_BYTES, "image/gif"],
  ["webp", WEBP_BYTES, "image/webp"],
] as const)("stores verified %s bytes", async (_name, bytes, mime) => {
  await expect(store.put(scope, bytes)).resolves.toEqual(
    expect.objectContaining({ assetId: expect.stringMatching(/^asset_[a-f0-9]{64}$/), mime }),
  )
})
```

- [ ] **Step 2: Run the recursive core tests and verify they fail**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-elements.test.ts tests/platform-projection.test.ts tests/platform-assets.test.ts
```

Expected: FAIL on nested sealing/projection and magic-byte-only store behavior.

- [ ] **Step 3: Extract typed recursive element utilities**

Create `core/src/platform/utils/elements.ts` with these public-to-core-only functions:

```ts
import { h, type Element } from "koishi"

export function normalizeElements(elements: readonly Element[]): Element[] {
  const output: Element[] = []
  for (const element of elements) {
    const normalized = normalizeElement(element)
    if (normalized === undefined) continue
    output.push(...(Array.isArray(normalized) ? normalized : [normalized]))
  }
  return output
}

export function sealElements(elements: readonly Element[]): Element[] {
  return normalizeElements(elements).map((element) => {
    if (element.type === "img" && element.attrs.src) {
      return h("img", { unavailable: "true" })
    }
    if (!element.children.length) return element
    return h(element.type, element.attrs, sealElements(element.children))
  })
}

```

Implement the private allowlist without `any`:

```ts
function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

function isTrue(value: unknown): boolean {
  return value === true || value === "true" || value === ""
}

function normalizeElement(element: Element): Element | Element[] | undefined {
  const { type, attrs, children } = element
  if (type === "text") return h.text(stringValue(attrs.content) ?? "")
  if (type === "br") return h("br")
  if (type === "p") return h("p", {}, normalizeElements(children))

  if (type === "at") {
    const id = stringValue(attrs.id) ?? ""
    const name = stringValue(attrs.name)
    return h("at", { id, ...(name ? { name } : {}) })
  }

  if (type === "face" || type === "emoji") {
    const id = stringValue(attrs.id)
    const name = stringValue(attrs.name)
    return h(type, { ...(id ? { id } : {}), ...(name ? { name } : {}) })
  }

  if (type === "img" || type === "image") {
    const id = stringValue(attrs.id)
    const mime = stringValue(attrs.mime)
    if (id?.startsWith("asset_") && mime) return h("img", { id, mime })
    if (isTrue(attrs.unavailable)) return h("img", { unavailable: "true" })
    const src = stringValue(attrs.src)
    return src ? h("img", { src }) : h("img", { unavailable: "true" })
  }

  if (type === "audio" || type === "video" || type === "file") {
    const title = stringValue(attrs.title) ?? stringValue(attrs.name)
    return h(type, { omitted: "true", ...(title ? { title } : {}) })
  }

  if (type === "quote") return h("quote", { id: stringValue(attrs.id) ?? "" })
  if (type === "forward") {
    return h("forward", {
      id: stringValue(attrs.id) ?? "",
      summary: stringValue(attrs.summary) ?? FORWARD_SUMMARY,
    })
  }
  if (type === "message" && isTrue(attrs.forward)) {
    return h("forward", {
      id: stringValue(attrs.id) ?? "",
      summary: FORWARD_SUMMARY,
    })
  }

  return children.length ? normalizeElements(children) : undefined
}
```

Keep `FORWARD_SUMMARY` in `message.ts` only if the utility receives it as an argument. If normalization owns the constant, move it to `utils/elements.ts` and import it from `message.ts`; do not duplicate it.

Import these helpers only from core platform modules. Do not export `utils/elements.ts` from `platform/index.ts`.

- [ ] **Step 4: Make sealing and projection recursive and ordered**

Use `sealElements()` in `sealMessage()`.

In `projectPlatformMessage()`, build model parts recursively. Merge adjacent text parts and flush before each verified image:

```ts
type ModelPart =
  | { type: "text"; text: string }
  | { type: "image"; image: Uint8Array; mediaType: string }

function pushText(parts: ModelPart[], text: string): void {
  if (!text) return
  const last = parts.at(-1)
  if (last?.type === "text") last.text += text
  else parts.push({ type: "text", text })
}
```

Implement recursive projection with the image read exactly at its document position:

```ts
async function appendProjectedElements(
  elements: readonly Element[],
  parts: ModelPart[],
  options: {
    scope: ChannelScope
    assetStore: { readByAssetId(scope: ChannelScope, assetId: string): Promise<Uint8Array> }
    onAssetMissing?: (assetId: string, cause: unknown) => void
  },
): Promise<void> {
  for (const element of elements) {
    if (element.type === "p") {
      pushText(parts, "<p>")
      await appendProjectedElements(element.children, parts, options)
      pushText(parts, "</p>")
      continue
    }

    if (element.type === "img") {
      const assetId = typeof element.attrs.id === "string" ? element.attrs.id : undefined
      const mime = typeof element.attrs.mime === "string" ? element.attrs.mime : undefined
      if (assetId?.startsWith("asset_") && mime) {
        try {
          const bytes = await options.assetStore.readByAssetId(options.scope, assetId)
          parts.push({ type: "image", image: bytes, mediaType: mime })
        } catch (cause) {
          options.onAssetMissing?.(assetId, cause)
          pushText(parts, '<img unavailable="true"/>')
        }
        continue
      }
    }

    pushText(parts, element.toString())
  }
}
```

Start parts with `${header}\n`, call this function on sealed elements, return a plain string when every part is text, and otherwise return the ordered part array. Do not include a private asset ID in a text part.

- [ ] **Step 5: Simplify and harden `AssetStore`**

Remove the configurable MIME set and `mimeHint`. Keep only fixed signature detection and max bytes:

```ts
export interface AssetStoreOptions {
  basePath: string
  maxFileBytes: number
}

async put(
  scope: ChannelScope,
  data: Uint8Array,
): Promise<{ assetId: string; mime: string }> {
  if (!(data instanceof Uint8Array)) throw new Error("Asset data must be bytes")
  const mime = detectImageMime(data)
  if (!mime) throw new Error("Unsupported image MIME type")
  if (data.byteLength > this.#maxFileBytes) {
    throw new Error(`Image exceeds ${this.#maxFileBytes} bytes`)
  }
  // copy, hash, atomically link, return verified mime
}
```

`detectImageMime()` must compare all eight PNG signature bytes, distinguish the complete six-byte `GIF87a`/`GIF89a` signatures, retain JPEG `ff d8 ff`, and require both RIFF and WEBP markers for WebP. Prefix-only matches are invalid.

Update `PlatformService` construction accordingly. Retain integrity validation on reads and channel-local clear.

- [ ] **Step 6: Write failing OneBot stream and budget tests**

Replace array-buffer mocks in `plugins/platform-onebot/tests/prepare.test.ts` with Web `ReadableStream<Uint8Array>` helpers:

```ts
function byteStream(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve: (value?: T) => resolve(value as T) }
}

function pngBytes(size: number, marker: number): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set(PNG_1X1.subarray(0, 8))
  if (size > 8) bytes[8] = marker
  return bytes
}

function remoteImage(id: string): Element {
  return h("img", { src: `https://example.com/${id}.png` })
}

function message(elements: Element[]): Platform.Message {
  return {
    source: { platform: "onebot", selfId: "bot" },
    scope: { type: "channel", channelId: "room" },
    sender: { id: "user" },
    messageId: "m1",
    receivedAt: 1,
    elements,
  }
}

function oversizedStream(cancel: ReturnType<typeof vi.fn>): ReadableStream<Uint8Array> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(budget.maxBytesPerImage + 1))
    },
    cancel,
  })
  return stream
}
```

The test harness must create `httpGet`, `images.put`, and this exact wrapper:

```ts
async function prepare(input: Platform.Message): Promise<Element[]> {
  return prepareOneBotMessage(ctx as never, {
    session: {} as never,
    message: input,
    images,
    budget,
  })
}
```

Add cases for:

```ts
it("prepares an image nested in a paragraph", async () => {
  httpGet.mockResolvedValue(byteStream(PNG_1X1))
  const result = await prepare(message([h("p", {}, [h.text("a"), remoteImage("a"), h.text("b")])]))
  expect(result[0].children[1].attrs.id).toBe("asset_abc")
})

it("never requests a fifth image", async () => {
  httpGet.mockResolvedValue(byteStream(PNG_1X1))
  const result = await prepare(message(Array.from({ length: 5 }, (_, index) => remoteImage(String(index)))))
  expect(httpGet).toHaveBeenCalledTimes(4)
  expect(result[4].attrs.unavailable).toBe("true")
})

it("never exceeds two concurrent downloads", async () => {
  const releases = Array.from({ length: 4 }, () => deferred<void>())
  let active = 0
  let maxActive = 0
  let index = 0
  httpGet.mockImplementation(async () => {
    const current = index++
    active += 1
    maxActive = Math.max(maxActive, active)
    await releases[current].promise
    active -= 1
    return byteStream(PNG_1X1)
  })

  const pending = prepare(message(Array.from({ length: 4 }, (_, value) => remoteImage(String(value)))))
  await vi.waitFor(() => expect(httpGet).toHaveBeenCalledTimes(2))
  releases[0].resolve()
  releases[1].resolve()
  await vi.waitFor(() => expect(httpGet).toHaveBeenCalledTimes(4))
  releases[2].resolve()
  releases[3].resolve()
  await pending

  expect(maxActive).toBe(2)
})

it("aborts a response that exceeds the per-image byte limit", async () => {
  const cancel = vi.fn()
  httpGet.mockResolvedValue(oversizedStream(cancel))
  const result = await prepare(message([remoteImage("large")]))
  expect(cancel).toHaveBeenCalled()
  expect(result[0].attrs.unavailable).toBe("true")
})

it("aborts the HTTP request on timeout", async () => {
  vi.useFakeTimers()
  let signal: AbortSignal | undefined
  httpGet.mockImplementation((_url, config) => {
    signal = config.signal
    return new Promise((_resolve, reject) => {
      config.signal.addEventListener("abort", () => reject(config.signal.reason))
    })
  })
  const pending = prepare(message([remoteImage("slow")]))
  await vi.advanceTimersByTimeAsync(budget.timeoutMs)
  await pending
  expect(signal?.aborted).toBe(true)
  vi.useRealTimers()
})
```

Add deterministic total-budget coverage:

```ts
it("admits concurrent downloads to the total budget in source order", async () => {
  const first = pngBytes(5 * 1024 * 1024, 1)
  const second = pngBytes(5 * 1024 * 1024, 2)
  const third = pngBytes(5 * 1024 * 1024, 3)
  const responses = Array.from({ length: 3 }, () => deferred<ReadableStream<Uint8Array>>())
  let request = 0
  httpGet.mockImplementation(() => responses[request++].promise)

  const pending = prepare(message([remoteImage("1"), remoteImage("2"), remoteImage("3")]))
  await vi.waitFor(() => expect(httpGet).toHaveBeenCalledTimes(2))
  responses[1].resolve(byteStream(second))
  responses[0].resolve(byteStream(first))
  await vi.waitFor(() => expect(httpGet).toHaveBeenCalledTimes(3))
  responses[2].resolve(byteStream(third))

  const result = await pending
  expect(vi.mocked(images.put).mock.calls.map(([bytes]) => bytes[8])).toEqual([1, 2])
  expect(result[2].attrs.unavailable).toBe("true")
})
```

- [ ] **Step 7: Run the OneBot image tests and verify they fail**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot-platform-onebot exec vitest run tests/prepare.test.ts
```

Expected: FAIL because the implementation still reads array buffers, only scans top-level nodes, and does not abort.

- [ ] **Step 8: Implement bounded download helpers in `prepare.ts`**

Keep helpers private to the file:

```ts
async function readLimitedStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel("image exceeds byte limit")
        throw new Error("image exceeds byte limit")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}
```

For HTTP input, create an `AbortController`, clear its timer in `finally`, and call:

```ts
ctx.http.get(src, {
  responseType: "stream",
  timeout: budget.timeoutMs,
  signal: controller.signal,
})
```

Define the source reader rather than using `Promise.race()` around an array-buffer request:

```ts
async function downloadImageBytes(
  ctx: Context,
  src: string,
  budget: Platform.ImageBudget,
): Promise<Uint8Array> {
  if (src.startsWith("data:")) {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(src)
    if (!match) throw new Error("invalid data URL")
    const payload = match[3]
    if (payload.length > budget.maxBytesPerImage * 4) {
      throw new Error("encoded image exceeds byte limit")
    }
    const bytes = match[2]
      ? new Uint8Array(Buffer.from(payload, "base64"))
      : new TextEncoder().encode(decodeURIComponent(payload))
    if (bytes.byteLength > budget.maxBytesPerImage) {
      throw new Error("decoded image exceeds byte limit")
    }
    return bytes
  }

  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new DOMException("Image download timed out", "TimeoutError")),
    budget.timeoutMs,
  )
  try {
    const stream = await ctx.http.get(src, {
      responseType: "stream",
      timeout: budget.timeoutMs,
      signal: controller.signal,
    })
    return await readLimitedStream(stream, budget.maxBytesPerImage)
  } finally {
    clearTimeout(timer)
  }
}
```

Use these local tree and worker helpers:

```ts
function collectRemoteImages(elements: readonly Element[], output: Element[] = []): Element[] {
  for (const element of elements) {
    if ((element.type === "img" || element.type === "image") && typeof element.attrs.src === "string") {
      output.push(element)
    }
    collectRemoteImages(element.children, output)
  }
  return output
}

function rebuildElements(
  elements: readonly Element[],
  replacements: ReadonlyMap<Element, Element>,
): Element[] {
  return elements.map((element) => {
    const replacement = replacements.get(element)
    if (replacement) return replacement
    if (!element.children.length) return element
    return h(element.type, element.attrs, rebuildElements(element.children, replacements))
  })
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= values.length) return
      results[index] = await worker(values[index], index)
    }
  }))
  return results
}
```

For `data:` input, parse only `data:<mime>[;base64],<payload>`. Reject encoded payload text above `maxBytesPerImage * 4` before decoding, decode base64 or percent-encoded text, then enforce `maxBytesPerImage` on bytes. Do not send `data:` through HTTP.

Implement the main preparation sequence:

```ts
const remoteImages = collectRemoteImages(message.elements)
const eligible = remoteImages.slice(0, budget.maxImages)
const replacements = new Map<Element, Element>()

for (const element of remoteImages.slice(budget.maxImages)) {
  replacements.set(element, h("img", { unavailable: "true" }))
}

const candidates = await mapConcurrent(
  eligible,
  budget.concurrency,
  async (element) => {
    try {
      return await downloadImageBytes(ctx, String(element.attrs.src), budget)
    } catch {
      return undefined
    }
  },
)

let totalBytes = 0
for (let index = 0; index < eligible.length; index += 1) {
  const element = eligible[index]
  const bytes = candidates[index]
  if (!bytes || totalBytes + bytes.byteLength > budget.maxTotalBytes) {
    replacements.set(element, h("img", { unavailable: "true" }))
    continue
  }
  try {
    const { assetId, mime } = await images.put(bytes)
    totalBytes += bytes.byteLength
    replacements.set(element, h("img", { id: assetId, mime }))
  } catch {
    replacements.set(element, h("img", { unavailable: "true" }))
  }
}

return rebuildElements(message.elements, replacements)
```

- [ ] **Step 9: Run all focused image, element, projection, and asset checks**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-elements.test.ts tests/platform-prepare.test.ts tests/platform-projection.test.ts tests/platform-assets.test.ts
rtk yarn workspace koishi-plugin-yesimbot-platform-onebot exec vitest run tests/prepare.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-platform-onebot
```

Expected: all tests and type checks PASS.

- [ ] **Step 10: Review checkpoint**

Verify that every byte-producing path has a bound before unbounded retention, every timeout aborts the request, only four requests can start, accepted bytes cannot exceed ten MiB, and neither adapter source nor public declarations can import or access `AssetStore`.

---

### Task 5: Normalize Structured OneBot Forwards And Correct Public Documentation

**Files:**
- Modify: `plugins/onebot-utils/src/index.ts`
- Modify: `plugins/onebot-utils/src/types.ts`
- Modify: `plugins/onebot-utils/tests/onebot-utils.test.ts`
- Modify: `core/README.md`
- Modify: `plugins/platform-onebot/README.md`

**Interfaces:**
- Consumes: current `onebot_get_forward_message` tool and canonical `ctx.yesimbot.platform` service path.
- Produces: guarded text-only forward records and accurate public package documentation.

- [ ] **Step 1: Write failing structured forward tests**

Extend `onebot-utils.test.ts` with one helper that executes the forward tool, then add:

```ts
async function executeForward(raw: unknown, input: { offset?: number; limit?: number } = {}) {
  const getForwardMsg = vi.fn(async () => raw)
  const { ctx, factories } = createContext()
  const plugin = new OnebotUtilsPlugin(ctx as never, {})
  await plugin.start()
  const runtimePlugin = factories[0]!({
    ...createChannelContext(),
    platform: {
      name: "onebot",
      unsafeBot: { internal: { getForwardMsg } },
    },
  } as never)
  const tools = await getTools(runtimePlugin)
  const tool = tools.find((item) => item.name === "onebot_get_forward_message")!
  return tool.execute!(
    { messageId: "forward-id", ...input },
    {} as never,
  ) as Promise<{
    forwardId: string
    offset: number
    messages: Array<{ sender: string; time?: string; content: string }>
    hasMore: boolean
  }>
}

it("normalizes structured OneBot segments without stringifying objects", async () => {
  const result = await executeForward([
    {
      sender: { user_id: 1, card: "Alice" },
      raw_message: "",
      message: [
        { type: "text", data: { text: "hello " } },
        { type: "image", data: { url: "https://example/image.png" } },
        { type: "text", data: { text: " world" } },
        { type: "file", data: { name: "secret.txt" } },
      ],
    },
  ])

  expect(result.messages[0].content).toBe("hello [图片] world[文件]")
  expect(result.messages[0].content).not.toContain("[object Object]")
  expect(JSON.stringify(result)).not.toContain("https://")
})

it("uses raw text when it is non-empty and sanitizes CQ media and URLs", async () => {
  const result = await executeForward([
    {
      sender: { user_id: 1, nickname: "Alice" },
      raw_message: "look [CQ:image,url=https://example/a] https://example/b",
      message: [{ type: "text", data: { text: "ignored" } }],
    },
  ])
  expect(result.messages[0].content).toBe("look [图片] [链接]")
})

it("enforces record and page content budgets", async () => {
  const result = await executeForward(
    Array.from({ length: 10 }, (_, index) => ({
      sender: { user_id: index },
      raw_message: "x".repeat(1_200),
    })),
  )
  expect(result.messages.every((item) => item.content.length <= 1_000)).toBe(true)
  expect(result.messages.reduce((sum, item) => sum + item.content.length, 0)).toBeLessThanOrEqual(6_000)
  expect(result.hasMore).toBe(true)
})

it("normalizes remaining media and drops unknown segments", async () => {
  const result = await executeForward({
    messages: [{
      sender: { user_id: 1, nickname: "Alice" },
      message: [
        { type: "record", data: {} },
        { type: "video", data: {} },
        { type: "unknown", data: { text: "secret" } },
      ],
    }],
  })
  expect(result.messages[0].content).toBe("[语音][视频]")
})

it("clamps pagination and never returns raw record fields", async () => {
  const assetId = `asset_${"a".repeat(64)}`
  const raw = Array.from({ length: 25 }, (_, index) => ({
    message_id: `child-${index}`,
    sender: { user_id: index },
    raw_message: `item-${index} ${assetId} https://example/${index}`,
  }))
  const result = await executeForward(raw, { offset: -3, limit: 99 })
  expect(result.offset).toBe(0)
  expect(result.messages).toHaveLength(20)
  expect(result.hasMore).toBe(true)
  expect(JSON.stringify(result)).not.toContain(assetId)
  expect(JSON.stringify(result)).not.toMatch(/message_id|child-|https:\/\//)
})
```

- [ ] **Step 2: Run the forward suite and verify the structured case fails**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot-onebot-utils exec vitest run tests/onebot-utils.test.ts
```

Expected: FAIL with structured content becoming `[object Object]` or empty text.

- [ ] **Step 3: Replace broad protocol interfaces with unknown-facing guards**

In `plugins/onebot-utils/src/types.ts`, keep only:

```ts
export interface OneBotInternal {
  getForwardMsg(messageId: string): Promise<unknown>
  setEssenceMsg(messageId: string): Promise<unknown>
  _request?(action: string, params: Record<string, unknown>): Promise<unknown>
}

export interface OneBotCapableBot {
  internal?: OneBotInternal
}
```

Delete the exported full `ForwardMessage`, `Message`, `Data`, and `Sender` pseudo-schema. Runtime input is adapter-owned `unknown`.

- [ ] **Step 4: Implement local runtime guards and segment normalization**

Keep these helpers private to `index.ts`:

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function scalarString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

function firstNonEmpty(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = scalarString(value)
    if (text !== undefined) return text
  }
  return undefined
}

function sanitizeForwardSegments(value: unknown): string {
  if (!Array.isArray(value)) return ""
  return value.map((segment) => {
    if (!isRecord(segment) || !isRecord(segment.data)) return ""
    switch (segment.type) {
      case "text":
        return typeof segment.data.text === "string" ? segment.data.text : ""
      case "image":
        return "[图片]"
      case "record":
        return "[语音]"
      case "video":
        return "[视频]"
      case "file":
        return "[文件]"
      default:
        return ""
    }
  }).join("")
}
```

Choose content with:

```ts
const rawText = typeof record.raw_message === "string" && record.raw_message.length > 0
  ? record.raw_message
  : sanitizeForwardSegments(record.message)
const content = sanitizeForwardContent(rawText)
```

`sanitizeForwardContent()` must keep the existing CQ media placeholders, replace external URLs with `[链接]`, remove internal asset IDs matching `\basset_[a-f0-9]{64}\b`, strip remaining CQ syntax, collapse whitespace, and trim. Do not call `String()` on `record.message`, sender objects, or arbitrary values. Use guards and `firstNonEmpty()` for card/nickname/user ID.

- [ ] **Step 5: Run the OneBot utility tests and type check**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot-onebot-utils exec vitest run tests/onebot-utils.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-onebot-utils
```

Expected: PASS.

- [ ] **Step 6: Replace stale public README claims**

Update `core/README.md` to document only:

- `Platform.Message`, `Platform.MessageRecord`, `Platform.Event`, `Platform.Scope`, `Platform.Adapter`, `Platform.RefineResult`, `Platform.ImagePrepareSink`;
- adapter registration through `ctx.yesimbot.platform.register()`;
- event publication through `ctx.yesimbot.platform.publish()`;
- core-owned fixed formatting, literal history, private image assets, and Agent lifecycle routing.

Remove every mention of `MessageView`, `EventView`, `Reader`, facts, templates, or public resource stores.

Update `plugins/platform-onebot/README.md` to state:

- the plugin registers a flat OneBot adapter through `ctx.yesimbot.platform`;
- `refine()` recognizes reaction events;
- `prepare()` recursively freezes bounded images through `ImagePrepareSink`;
- forward details are provided by the separate `onebot-utils` tool;
- the adapter does not expose readers or access core asset storage.

- [ ] **Step 7: Verify docs and source contain no removed public concepts**

Run:

```bash
rtk proxy rg -n "MessageView|EventView|Platform\.Reader|ctx\[.?yesimbot\.platform|AssetStore|\breaders\b|\badapt\b" core/README.md plugins/platform-onebot/README.md core/src/platform/index.ts plugins/platform-onebot/src
```

Expected: no matches.

- [ ] **Step 8: Review checkpoint**

Inspect a representative raw CQ record and structured segment record. Confirm both produce the same text-only policy and that the README descriptions match actual exports and plugin behavior exactly.

---

### Task 6: Run The Complete Regression Matrix And Record New Evidence

**Files:**
- Create: `openspec/changes/simplify-platform-adapter-model/review-fix-verify.md`
- Do not modify: `openspec/changes/simplify-platform-adapter-model/verify.md`

**Interfaces:**
- Consumes: completed Tasks 1-5.
- Produces: exact, current verification evidence and a final design-consistency gate.

- [x] **Step 1: Inspect the final worktree before verification**

Run:

```bash
rtk git status --short
rtk git diff -- openspec/changes/simplify-platform-adapter-model core/src core/tests plugins/platform-onebot plugins/onebot-utils
rtk git diff --check
```

Expected: only intended files plus the pre-existing user-owned `tasks.md` and `.cortexkit/` state; `git diff --check` exits successfully.

- [x] **Step 2: Run the complete focused core regression matrix**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run \
  tests/platform-types.test.ts \
  tests/platform-exports.test.ts \
  tests/platform-service.test.ts \
  tests/platform-session.test.ts \
  tests/apply.test.ts \
  tests/message-flow.test.ts \
  tests/channel-lifecycle.test.ts \
  tests/reset.test.ts \
  tests/error-handling.test.ts \
  tests/platform-elements.test.ts \
  tests/platform-prepare.test.ts \
  tests/platform-projection.test.ts \
  tests/platform-assets.test.ts
```

Expected: PASS with zero failed tests.

- [x] **Step 3: Run the complete focused OneBot suites**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot-platform-onebot exec vitest run tests/plugin.test.ts tests/events.test.ts tests/prepare.test.ts
rtk yarn workspace koishi-plugin-yesimbot-onebot-utils exec vitest run tests/onebot-utils.test.ts
```

Expected: PASS with zero failed tests.

- [x] **Step 4: Run package-scoped type checks and builds**

Run:

```bash
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-platform-onebot
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-onebot-utils
rtk yarn turbo run build --filter=koishi-plugin-yesimbot
rtk yarn turbo run build --filter=koishi-plugin-yesimbot-platform-onebot
rtk yarn turbo run build --filter=koishi-plugin-yesimbot-onebot-utils
```

Expected: every command exits successfully.

- [x] **Step 5: Prove the legacy compatibility names are absent**

Run:

```bash
rtk proxy rg -n "MsgElement|PersistedPlatformMessage|\badapt\b|platformService|ctx as any|as any|MessageView|EventView|Platform\.Reader" core/src core/tests plugins/platform-onebot/src plugins/platform-onebot/tests
```

Expected: no matches.

Run:

```bash
rtk proxy rg -n "AssetStore|IMAGE_BUDGET" core/src/platform/index.ts plugins/platform-onebot/src plugins/platform-onebot/tests
```

Expected: no matches.

- [x] **Step 6: Run the full repository pipeline in CI order**

Run:

```bash
rtk yarn lint
rtk yarn fmt:check
rtk yarn check-types
rtk yarn build
rtk yarn test
```

Expected: all five commands exit successfully. If any unrelated failure occurs, record the exact command, failing workspace, and evidence; do not weaken the new tests or add compatibility code to make the pipeline green.

- [x] **Step 7: Perform a design-to-code consistency review**

Read `review-fix-design.md` section by section and map each requirement to code and a test. Confirm specifically:

- one public service entry;
- no event receipt time;
- no Message-as-Event notification;
- one matcher and cached selected adapter;
- weak Session state;
- no busy mirror;
- busy read after preparation;
- ordered reset;
- recursive Element handling;
- streamed abortable image reads;
- fixed asset MIME truth;
- structured forward normalization;
- narrow exports and accurate docs.

Any mismatch is a failed verification step even if tests pass. Fix the implementation or tests to match the approved design; do not edit the design to excuse an implementation shortcut.

- [x] **Step 8: Write `review-fix-verify.md` from actual results**

Create the file only after Steps 1-7 complete. Record:

- date and reviewed commit/worktree state;
- every exact command from Steps 2-6;
- actual pass counts and workspace summaries copied from command output;
- the zero-match legacy scans;
- the design-to-code checklist result;
- any unrelated failure with exact evidence and whether it blocks merge.

Do not copy claims from the historical `verify.md`. Do not write placeholders or expected results as if they were executed evidence.

- [x] **Step 9: Final review checkpoint**

Run:

```bash
rtk git status --short
rtk git diff --stat
rtk git diff --check
```

Expected: a clean diff check, no generated `dist/` or cache files staged as source, no changes to user-owned files outside this plan, and a complete `review-fix-verify.md` backed by the commands actually run.

---

### Post-Review Remediation Verification

- [x] **Memos current `MessageRecord` consumer verified** — current producer-to-consumer fixture passes (4 tests).
- [x] **Prepare mutation isolation verified** — void-return element and nested metadata mutations cannot alter the sealed result.
- [x] **First-four image-node cutoff verified** — local, unavailable, and source-less image nodes count before remote download admission.
- [x] **PNG signature and temporary cleanup verified** — wrong-tail PNG bytes reject and failed writes remove owned temporary files.
- [x] **Forward string and structured normalization verified** — string `message` fallback and segment arrays preserve the text-only policy.
- [x] **Checked public type tests verified** — dedicated no-emit contract compilation runs through core `check-types`.
- [x] **FIFO concurrency regressions verified** — same-channel join and cross-channel preparation tests pass.
- [x] **PlatformService constructor boundary verified** — no exported test-only constructor dependencies remain.
- [x] **Projection SDK typing verified** — no broad assertion crosses the model-plugin boundary.
- [x] **Final strict/OpenSpec, boundary, and root verification recorded** — all checks pass except the two documented range-external formatter baseline files.
