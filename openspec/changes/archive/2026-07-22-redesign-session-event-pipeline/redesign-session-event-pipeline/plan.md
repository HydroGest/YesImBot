# Session Event Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Replace the current platform-adapter, delivery-service, and cross-channel runtime pipeline with the approved `Gateway`, `Event`, `Will`, `RuntimeManager`, and one-channel `ChannelRuntime` architecture.

**Architecture:** `Gateway` is the only Session-aware boundary: it resolves Sessions into frozen, Session-free `EventRecord` values and sends passive outputs. `RuntimeManager` owns one `ChannelRuntime` per injective `[platform, selfId, channelId]` identity; each channel persists an `Event`, publishes observations, evaluates one replaceable `Will`, and returns complete assistant-message outputs. `AssetStore` and sealed Koishi elements are shared through composition, while public plugins see only resolver, Will, Agent-plugin, model, reset, and stop APIs.

**Tech Stack:** TypeScript, Koishi 4, Satori 4.6, `@yesimbot/agent-runtime`, AI SDK `ModelMessage`, Vitest, Yarn 4, Turbo, OpenSpec.

## Global Constraints

- Use Yarn 4 with `nodeLinker: node-modules`; run package checks through `yarn` and workspace names from the repository guide.
- Keep the change a clean break: do not add legacy adapters, `Platform.Message` readers, legacy JSONL migration, forwarding exports, or compatibility wrappers.
- `Session` may exist only in `Gateway` and resolver code; `RuntimeManager`, `ChannelRuntime`, `Event`, `Will`, storage, and persisted records are Session-free.
- A registered `SessionResolver` is unique by `platform`; duplicate registration throws, `resolve()` returning `null` skips admission, and a thrown resolver is authoritative and prevents fallback interpretation.
- Standard Satori message Sessions use the fallback message base when no platform resolver is registered; non-message Sessions without a resolver produce no record.
- Every admitted `EventRecord` with a concrete channel is wrapped as `CustomMessageBase<"yesimbot.event", EventRecord>` and persisted before `yesimbot/event`, `Will.decide()`, and `yesimbot/will`.
- `Will.Decision` is exactly `"wait" | "trigger"`; `Will` neither persists nor sends, and `Will.stop` failure is diagnostic-only.
- `ChannelRuntime.Output` contains `turnId`, `messageId`, and a Koishi `Fragment`; Gateway sends each complete output immediately and never exposes `AgentInternalEvent`.
- Passive sends use the originating `Session.send(fragment)` and preserve its returned `string[]`; active sends use the current `Bot.sendMessage(channelId, fragment)`.
- Passive send failures create one same-channel `delivery.failed` EventRecord per failed output, continue later outputs, and never recursively create another failure record.
- Image freezing is bounded at 4 images/message, 5 MiB/image, 10 MiB total, 10 seconds/image, 2 concurrent downloads, and MIME types `image/jpeg`, `image/png`, `image/webp`, and `image/gif`; SVG is unavailable.
- `channelKey(scope)` is the injective JSON tuple `[platform, selfId, channelId]`. JSONL and asset storage use one opaque `v2` channel path ID; workspace uses its own `v2` SHA-256/base64url digest. No raw identifier appears in a path and no legacy path is read.
- `freezeImage(element, load)` calls `load(signal, maxBytes)` with the remaining core-controlled byte budget. Loaders must honor the signal and byte cap; timeout returns unavailable near the deadline but a download slot is released only after its loader settles. AssetStore validates MIME from bytes, treating a loader MIME as a hint.
- Quote persists as `h("quote", { id })`; forward persists only its ID and fixed inline summary. Neither enters `AssetStore` or performs replay-time lookup.
- Event formatting is local-only. It uses stored timestamp and sender data, formats the fixed `[time="..." sender="..." id="..."]` header with conditional `id`, and never calls a platform API during replay.
- `requiresMessageId: true` is a static Agent-plugin capability used by the active channel to decide whether the fixed header includes the raw platform message ID.
- Reset interrupts/stops Agent and Will, waits channel work, independently attempts JSONL then scoped-asset cleanup, clears local state, and removes the runtime even when cleanup reports an error. Global stop closes admission, tears down runtimes, drains Gateway work, and preserves JSONL/assets.
- `Will.State.recent` is an ordered 32-event window; new entries evict only its oldest entry and do not change `pending` semantics.
- Package exports expose only `.`, `./model`, and `./package.json`; runtime and shared implementations remain internal.

## File Map

Create these new modules and focused tests:

- `core/src/channel/index.ts`
- `core/src/event/index.ts`
- `core/src/event/formatter.ts`
- `core/src/gateway/index.ts`
- `core/src/gateway/session.ts`
- `core/src/gateway/message.ts`
- `core/src/runtime/index.ts`
- `core/src/runtime/manager.ts`
- `core/src/runtime/channel.ts`
- `core/src/shared/index.ts`
- `core/src/shared/asset.ts`
- `core/src/shared/element.ts`
- `core/src/service.ts`
- `core/src/will/index.ts`
- `core/tests/channel.test.ts`
- `core/tests/asset.test.ts`
- `core/tests/element.test.ts`
- `core/tests/event.test.ts`
- `core/tests/formatter.test.ts`
- `core/tests/will.test.ts`
- `core/tests/channel-runtime.test.ts`
- `core/tests/runtime-manager.test.ts`
- `core/tests/gateway.test.ts`
- `core/tests/lifecycle.test.ts`
- `core/tests/service.test.ts`

Modify these integration files:

- `core/src/index.ts`
- `core/src/config.ts`
- `core/src/runtime/prompt.ts`
- `core/src/runtime/storage.ts`
- `core/package.json`
- `platforms/onebot/src/index.ts`
- `platforms/onebot/src/events.ts`
- `platforms/onebot/src/image.ts`
- OneBot and optional plugin tests/imports identified by `rg 'ChannelAgentContext|yesimbot\\.(platform|delivery)|/platform|/shared'`.

Delete these only after all replacement consumers pass:

- `core/src/platform/`
- `core/src/delivery/`
- `core/src/extension/`
- `core/src/shared/types.ts`
- `core/src/runtime/service.ts`
- `core/src/runtime/channel-runtime.ts`
- `core/src/runtime/key.ts`
- `core/src/runtime/message.ts`
- `core/src/runtime/render.ts`
- `platforms/onebot/src/prepare.ts`

---

## Task 1: Establish Channel And Shared Foundations

**Files:**
- Create: `core/src/channel/index.ts`, `core/src/shared/index.ts`, `core/src/shared/asset.ts`, `core/src/shared/element.ts`
- Modify: imports currently targeting `core/src/channel.ts`, `core/src/platform/assets.ts`, `core/src/platform/utils/elements.ts`, and `core/src/runtime/key.ts`
- Test: `core/tests/channel.test.ts`, `core/tests/asset.test.ts`, `core/tests/element.test.ts`

**Interfaces:**
- Consumes: current `ChannelScope` fields, `createChannelRuntimeKey()`, `createChannelSessionPath()`, `AssetStore`, `normalizeElements()`, and `sealElements()`.
- Produces: `ChannelScope`, `fromEvent(event)`, `channelKey(scope)`, `channelPath(basePath, scope)`, `sameChannel(left, right)`, `AssetStore`, `sealElement(s)`, and the shared image/unavailable element predicates used by Event and Gateway.

- [ ] **Step 1: Write failing channel tests.**

```ts
import { describe, expect, it } from "vitest";
import { channelFileName, channelKey, channelPath, sameChannel, type ChannelScope } from "../src/channel/index.js";

const scope: ChannelScope = { platform: "onebot", selfId: "bot-1", channelId: "room/42" };

describe("ChannelScope", () => {
  it("uses an injective canonical key and opaque v2 session path", () => {
    expect(channelKey(scope)).toBe(JSON.stringify(["onebot", "bot-1", "room/42"]));
    expect(channelFileName(scope)).toMatch(/^channel_v2_[A-Za-z0-9_-]{43}$/);
    expect(channelPath("/tmp/athena", scope)).toBe(
      `/tmp/athena/sessions/${channelFileName(scope)}.jsonl`,
    );
  });

  it("compares channel identity without comparing object identity", () => {
    expect(sameChannel(scope, { ...scope })).toBe(true);
    expect(sameChannel(scope, { ...scope, channelId: "other" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the channel test and verify the missing-module failure.**

Run: `yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel.test.ts`

Expected: FAIL because `core/src/channel/index.ts` is not present yet.

- [ ] **Step 3: Implement the channel module and migrate the key/path logic.**

```ts
export interface ChannelScope {
  readonly platform: string;
  readonly selfId: string;
  readonly channelId: string;
}

export function channelKey(scope: ChannelScope): string {
  return `${scope.platform}:${scope.selfId}:${scope.channelId}`;
}

export function sameChannel(left: ChannelScope, right: ChannelScope): boolean {
  return channelKey(left) === channelKey(right);
}

export function fromEvent(record: EventRecord): ChannelScope | null {
  if (!record.channel?.id) return null;
  return { platform: record.platform, selfId: record.selfId, channelId: record.channel.id };
}
```

Keep path sanitization deterministic and scoped to `<basePath>/sessions`; do not add a second channel-id type or a compatibility alias for removed platform types.

- [ ] **Step 4: Add asset and sealed-element tests before moving implementation.**

```ts
it("round-trips a private image and rejects an invalid asset id", async () => {
  const stored = await assets.put(scope, PNG_BYTES);
  await expect(assets.readByAssetId(scope, stored.assetId)).resolves.toEqual(PNG_BYTES);
  await expect(assets.readByAssetId(scope, "asset_invalid")).rejects.toThrow(
    "Invalid platform asset id",
  );
});

it("seals image, quote, and forward elements without changing literals", () => {
  const elements = sealElements([
    h("img", { src: "https://example.invalid/a.png" }),
    h("quote", { id: "q-1" }),
    h("forward", { id: "f-1" }),
  ]);
  expect(elements.map((element) => element.toString())).toEqual([
    '<img unavailable="true"/>',
    '<quote id="q-1"/>',
    '<forward id="f-1" summary="[合并转发] 使用 onebot_get_forward_message 查看详情"/>',
  ]);
});
```

Run: `yarn workspace koishi-plugin-yesimbot exec vitest run tests/asset.test.ts tests/element.test.ts`

Expected: FAIL because the new shared modules and sealed-element test helpers are not implemented.

- [ ] **Step 5: Move the existing persistence and sealing behavior with the new ownership.**

Keep `AssetStore.put()`, `readByAssetId()`, integrity validation, MIME detection, atomic writes, and scoped `clear()` unchanged in behavior. Keep network loading out of `shared/`; resource admission belongs to Gateway.

- [ ] **Step 6: Run the complete foundation slice and commit it.**

Run: `yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel.test.ts tests/asset.test.ts tests/element.test.ts`

Expected: PASS with no legacy `Platform.*` or `ChannelScopeId` model introduced.

Commit: `git add core/src/channel core/src/shared core/tests/channel.test.ts core/tests/asset.test.ts core/tests/element.test.ts && git commit -m "refactor(core): establish channel and shared foundations"`

## Task 2: Define The Event Contract

**Files:**
- Create: `core/src/event/index.ts`
- Modify: `core/src/index.ts` exports and OneBot declaration merging
- Test: `core/tests/event.test.ts`

**Interfaces:**
- Consumes: Koishi `Universal.Event`, `Universal.Channel`, `Universal.User`, `Universal.Message`, and `CustomMessageBase`.
- Produces: `EventMap`, mapped `EventRecord`, `Event`, `createEvent(record)`, `isEvent(message)`, Koishi `yesimbot/event`, and agent-runtime `yesimbot.event` augmentations.

- [ ] **Step 1: Write type and runtime tests for the discriminated contract.**

```ts
import { describe, expect, it, expectTypeOf } from "vitest";
import { createEvent, isEvent, type Event, type EventMap, type EventRecord } from "../src/event/index.js";

type MessageRecord = EventRecord<"message">;

it("narrows EventRecord by type and creates an Agent custom message", () => {
  const record = {} as MessageRecord;
  if (record.type === "message") expectTypeOf(record.message).toMatchTypeOf<EventMap["message"]["message"]>();
  const event = createEvent(record);
  expect(event.type).toBe("yesimbot.event");
  expect(isEvent(event)).toBe(true);
});

it("does not expose legacy platform message or parallel event aliases", () => {
  expectTypeOf<Event>().toMatchTypeOf<{ role: "custom"; type: "yesimbot.event" }>();
});
```

- [ ] **Step 2: Run the focused event tests and verify the missing-module failure.**

Run: `yarn workspace koishi-plugin-yesimbot exec vitest run tests/event.test.ts`

Expected: FAIL because `core/src/event/index.ts` is not present.

- [ ] **Step 3: Implement the mapped EventRecord without wrapper types.**

```ts
export interface EventMap {
  message: {
    channel: Universal.Channel;
    user: Universal.User;
    message: Universal.Message;
  };
  "delivery.failed": {
    channel: Universal.Channel;
    delivery: {
      turnId: string;
      messageId: string;
      error: { name: string; message: string; code?: string };
    };
  };
}

export type EventRecord<K extends keyof EventMap = keyof EventMap> = {
  [P in K]: Readonly<Omit<Universal.Event, "type"> & { type: P; content?: string } & EventMap[P]>;
}[K];

export type Event<K extends keyof EventMap = keyof EventMap> =
  CustomMessageBase<"yesimbot.event", EventRecord<K>>;

export function createEvent(record: EventRecord): Event {
  return createCustomMessage("yesimbot.event", record, {
    timestamp: record.timestamp ?? Date.now(),
  });
}

export function isEvent(message: AgentMessage): message is Event {
  return message.role === "custom" && message.type === "yesimbot.event";
}
```

Use declaration merging for plugins; do not add `RuntimeEvent`, `ResolvedEvent`, `EventBase`, or a second source/scope/sender algebra.

- [ ] **Step 4: Add Koishi and agent-runtime augmentations and plugin-variant coverage.**

```ts
declare module "@yesimbot/agent-runtime" {
  interface AgentCustomMessages {
    "yesimbot.event": Event;
  }
}

declare module "koishi" {
  interface Events {
    "yesimbot/event": (event: Event) => void;
  }
}
```

Add one test-only declaration merge for a custom event variant and assert that `EventRecord<"test.variant">` narrows to its fields.

- [ ] **Step 5: Verify and commit the event contract.**

Run: `yarn workspace koishi-plugin-yesimbot exec vitest run tests/event.test.ts`

Expected: PASS, with the generated JSONL entry containing one `yesimbot.event` custom message and no `athena.platform.message` type.

Commit: `git add core/src/event core/src/index.ts core/tests/event.test.ts && git commit -m "feat(core): add typed runtime events"`

## Task 3: Implement Deterministic Event Formatting

**Files:**
- Create: `core/src/event/formatter.ts`
- Modify: current `core/src/platform/message.ts` projection logic while consumers still exist
- Test: `core/tests/formatter.test.ts`

**Interfaces:**
- Consumes: `Event`, `ChannelScope`, `AssetStore.readByAssetId()`, and the `requiresMessageId` capability.
- Produces: `formatEvent(event, options): Promise<UserModelMessage | undefined>`; a local-only model projection used by ChannelRuntime.

- [ ] **Step 1: Write failing formatter tests for fixed headers and no-content behavior.**

```ts
it("formats stored time and sender data with an optional raw message id", async () => {
  const result = await formatEvent(messageEvent("hello"), {
    scope,
    assetStore,
    includeMessageId: true,
  });
  expect(result).toMatchObject({ role: "user" });
  expect(result?.content).toContain('[time="2026/7/18 20:34" sender="Alice (10001)" id="m-1"]');
  expect(result?.content).toContain("\nhello");
});

it("emits no model message when content is absent", async () => {
  await expect(formatEvent(messageEvent(undefined), { scope, assetStore, includeMessageId: false })).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run the formatter tests and verify the missing-function failure.**

Run: `yarn workspace koishi-plugin-yesimbot exec vitest run tests/formatter.test.ts`

Expected: FAIL because `formatEvent()` is not exported from the new formatter module.

- [ ] **Step 3: Implement the fixed envelope and local element projection.**

```ts
export interface FormatEventOptions {
  readonly scope: ChannelScope;
  readonly assetStore: Pick<AssetStore, "readByAssetId">;
  readonly includeMessageId: boolean;
  readonly onAssetMissing?: (assetId: string, cause: unknown) => void;
}

export async function formatEvent(
  event: Event,
  options: FormatEventOptions,
): Promise<UserModelMessage | undefined> {
  if (!event.data.content) return undefined;
  const content = await projectFrozenElements(event.data.content, options);
  if (event.data.type !== "message") return { role: "user", content };
  const header = formatHeader(event.data, options.includeMessageId);
  return { role: "user", content: `${header}\n${content}` };
}
```

Use `zh-CN`, `Asia/Shanghai`, minute precision, `displayName (userID)` sender formatting, and uniform JSON quoting. Preserve the complete valid ordinary text; do not introduce a new formatter length cap.
For a non-message Event with frozen content, return one user model message containing only that frozen body; do not invent a second event header. A non-message Event without content still returns `undefined`.

- [ ] **Step 4: Add image, missing-asset, non-message, and replay-isolation tests.**

```ts
it("reads a frozen image only from the scoped AssetStore", async () => {
  const read = vi.spyOn(assetStore, "readByAssetId").mockResolvedValue(PNG_BYTES);
  const result = await formatEvent(imageEvent("asset_hash", "image/png"), {
    scope,
    assetStore,
    includeMessageId: false,
  });
  expect(read).toHaveBeenCalledWith(scope, "asset_hash");
  expect(result?.content).toEqual([{ type: "text", text: expect.any(String) }, { type: "image", image: PNG_BYTES, mediaType: "image/png" }]);
});

it("does not access a resolver, Session, or network when an asset is missing", async () => {
  const diagnostic = vi.fn();
  const result = await formatEvent(imageEvent("asset_missing", "image/png"), {
    scope,
    assetStore: { readByAssetId: vi.fn().mockRejectedValue(new Error("missing")) },
    includeMessageId: false,
    onAssetMissing: diagnostic,
  });
  expect(diagnostic).toHaveBeenCalledOnce();
  expect(result).toBeDefined();
});
```

- [ ] **Step 5: Run the formatter slice and commit it.**

Run: `yarn workspace koishi-plugin-yesimbot exec vitest run tests/formatter.test.ts tests/asset.test.ts`

Expected: PASS with image projection using bytes already in `AssetStore` and no platform/network mock invocation.

Commit: `git add core/src/event/formatter.ts core/src/platform/message.ts core/tests/formatter.test.ts && git commit -m "feat(core): add deterministic event formatting"`

## Task 4: Implement Will Evaluation

**Files:**
- Create: `core/src/will/index.ts`
- Modify: `core/src/config.ts`
- Test: `core/tests/will.test.ts`

**Interfaces:**
- Consumes: `Event`, `ChannelScope`, and optional `DefaultWill` configuration.
- Produces: `Will`, `Will.Decision`, `Will.State`, `Will.Factory`, `WillObservation`, `DefaultWill`, and `DefaultWillConfig`.

- [ ] **Step 1: Write failing type and routing tests.**

```ts
it("triggers direct messages and mentions but waits on ordinary group facts", async () => {
  const will = new DefaultWill({ direct: "trigger", mention: "trigger", group: "wait" });
  await expect(will.decide(directMessageEvent(), EMPTY_STATE)).resolves.toBe("trigger");
  await expect(will.decide(mentionedGroupEvent(), EMPTY_STATE)).resolves.toBe("trigger");
  await expect(will.decide(ordinaryGroupMessageEvent(), EMPTY_STATE)).resolves.toBe("wait");
});

it("waits for non-message and delivery-failed events", async () => {
  const will = new DefaultWill({ direct: "trigger", mention: "trigger", group: "trigger" });
  await expect(will.decide(nonMessageEvent(), EMPTY_STATE)).resolves.toBe("wait");
  await expect(will.decide(deliveryFailedEvent(), EMPTY_STATE)).resolves.toBe("wait");
});
```

- [ ] **Step 2: Run the Will tests and verify the missing-module failure.**

Run: `yarn workspace koishi-plugin-yesimbot exec vitest run tests/will.test.ts`

Expected: FAIL because `core/src/will/index.ts` is not present.

- [ ] **Step 3: Implement the exact Will interfaces and state shape.**

```ts
export interface Will {
  decide(event: Event, state: Will.State): Awaitable<Will.Decision>;
  stop?(): Awaitable<void>;
}

export namespace Will {
  export type Decision = "wait" | "trigger";
  export interface State {
    readonly activeTurnId: string | null;
    readonly pending: readonly Event[];
    readonly recent: readonly Event[];
    readonly lastActivityAt: number | null;
  }
  export type Factory = (channel: ChannelScope) => Awaitable<Will>;
}

export interface WillObservation {
  readonly event: Event;
  readonly decision: Will.Decision;
}

declare module "koishi" {
  interface Events {
    "yesimbot/will": (observation: WillObservation) => void;
  }
}
```

Implement `DefaultWill` as a direct message/mention/group policy and keep persistence, Agent execution, and delivery out of the class.

- [ ] **Step 4: Test typed Will observations and shutdown isolation.**

```ts
it("represents the Event and completed decision in one typed observation", () => {
  const event = directMessageEvent();
  const observation = { event, decision: "trigger" } satisfies WillObservation;
  expect(observation).toEqual({ event, decision: "trigger" });
});

it("allows an optional stop method", async () => {
  const stop = vi.fn().mockResolvedValue(undefined);
  await ({ decide: async () => "wait" as const, stop } satisfies Will).stop?.();
  expect(stop).toHaveBeenCalledOnce();
});
```

- [ ] **Step 5: Verify configuration defaults and commit the Will slice.**

Run: `yarn workspace koishi-plugin-yesimbot exec vitest run tests/will.test.ts`

Expected: PASS; default direct and mention decisions are `trigger`, default ordinary group is `wait`, and config contains only optional direct/mention/group decision overrides.

Commit: `git add core/src/will core/src/config.ts core/tests/will.test.ts && git commit -m "feat(core): add channel Will evaluation"`

## Task 5: Build The One-Channel Runtime

**Files:**
- Create: `core/src/runtime/channel.ts`, `core/src/runtime/index.ts`
- Modify: `core/src/runtime/storage.ts`, `core/src/runtime/prompt.ts`
- Modify: `packages/agent-runtime/src/agent.ts`
- Test: `core/tests/channel-runtime.test.ts`, `packages/agent-runtime/tests/append.test.ts`

**Interfaces:**
- Consumes: `EventRecord`, `Event`, `Will`, `AssetStore`, `Agent`, `AgentStorage`, prompt plugins, and the current model resolver.
- Produces:

```ts
export class ChannelRuntime {
  handle(record: EventRecord): Promise<ChannelRuntime.Result>;
  reset(): Promise<void>;
  stop(): Promise<void>;
}

export namespace ChannelRuntime {
  export interface Output {
    readonly turnId: string;
    readonly messageId: string;
    readonly content: Fragment;
  }

  export type Result =
    | { readonly kind: "wait"; readonly eventId: string }
    | { readonly kind: "join"; readonly eventId: string; readonly turnId: string }
    | { readonly kind: "run"; readonly eventId: string; readonly turnId: string; readonly output: AsyncIterable<Output> };
}
```

- [ ] **Step 1: Write a failing agent-runtime test for append-then-run deduplication.**

```ts
it("does not persist the same message again when append is followed by run", async () => {
  const message = createCustomMessage("test.event", { value: "committed" });
  await agent.append(message);
  await Array.fromAsync(agent.run(message));
  const entries = await agent.storage.read();
  expect(entries.filter((entry) => entry.type === "message" && entry.data.id === message.id)).toHaveLength(1);
});
```

Run: `yarn workspace @yesimbot/agent-runtime exec vitest run tests/append.test.ts`

Expected: FAIL because current `append()` does not populate `submittedMessageEntries`, so `run()` persists the same object a second time.

- [ ] **Step 2: Extend the existing submitted-entry tracking in `Agent.append()`.**

```ts
async append(message) {
  await this.init();
  const entries = await appendEntries([createMessageEntry(message)]);
  const messageEntries = entries.filter(
    (entry): entry is Extract<AgentEntry, { type: "message" }> => entry.type === "message",
  );
  rememberSubmittedEntries([message], messageEntries);
},
```

Run: `yarn workspace @yesimbot/agent-runtime exec vitest run tests/append.test.ts`

Expected: PASS without adding a new Agent method or persistence option.

- [ ] **Step 3: Write the core persist/order and wait tests.**

```ts
it("persists before event observation and Will evaluation", async () => {
  const order: string[] = [];
  agent.append = vi.fn(async () => order.push("persist"));
  ctx.on("yesimbot/event", () => order.push("event"));
  will.decide = vi.fn(async () => {
    order.push("will");
    return "wait";
  });
  ctx.on("yesimbot/will", () => order.push("will-observation"));
  const result = await runtime.handle(messageRecord());
  expect(order).toEqual(["persist", "event", "will", "will-observation"]);
  expect(result.kind).toBe("wait");
});
```

- [ ] **Step 4: Run the runtime test and verify the missing-module failure.**

Run: `yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel-runtime.test.ts`

Expected: FAIL because the one-channel runtime module is not present.

- [ ] **Step 5: Implement committed Event handling and the FIFO gate.**

```ts
async handle(record: EventRecord): Promise<ChannelRuntime.Result> {
  return this.queue.enqueue(async () => {
    const event = createEvent(record);
    await this.agent.append(event);
    this.emitEvent(event);
    const decision = await this.will.decide(event, this.readState());
    this.emitWill({ event, decision });
    if (decision === "wait") return { kind: "wait", eventId: event.id };
    const activeTurnId = this.agent.getActiveTurnId();
    if (activeTurnId !== null) {
      this.agent.send(event, { ifBusy: "join" });
      return { kind: "join", eventId: event.id, turnId: activeTurnId };
    }
    return this.startRun(event);
  });
}
```

Keep storage, prompt-file loading, Agent construction, and state projection channel-local. Reuse the same Event object for `append()` and `run()`/`send()` so the updated agent-runtime submitted-entry tracking prevents duplicate persistence. Broadcast listener failures are diagnostics only.

- [ ] **Step 6: Add run/join/output and active-send tests, then implement output projection.**

```ts
it("yields complete assistant messages in order and filters internal events", async () => {
  agent.run = vi.fn(() => streamFrom([
    messageAppended("first"),
    { type: "turn.delta", turnId: "t-1", delta: "ignored" },
    messageAppended("second"),
  ]));
  const result = await runtime.handle(triggerRecord());
  expect(result.kind).toBe("run");
  await expect(Array.fromAsync(result.output)).resolves.toEqual([
    { turnId: "t-1", messageId: "a-1", content: "first" },
    { turnId: "t-1", messageId: "a-2", content: "second" },
  ]);
});

it("normalizes current-bot active sends", async () => {
  const result = await activeSend({ channelId: "room-2", content: "hello" });
  expect(result).toEqual({ ok: true, messageIds: ["sent-1"] });
});
```

Use one internal consumer of `AgentInternalEvent`; convert only complete assistant messages into `ChannelRuntime.Output`, and keep active `Bot.sendMessage()` targeting the explicit channel ID.

- [ ] **Step 7: Verify the runtime slice and commit it.**

Run: `yarn workspace @yesimbot/agent-runtime exec vitest run tests/append.test.ts`

Run: `yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel-runtime.test.ts`

Expected: PASS for wait, join, run, ordered outputs, stream failure termination, and active-send result/error shapes.

Commit: `git add packages/agent-runtime/src/agent.ts packages/agent-runtime/tests/append.test.ts core/src/runtime/channel.ts core/src/runtime/index.ts core/src/runtime/storage.ts core/src/runtime/prompt.ts core/tests/channel-runtime.test.ts && git commit -m "refactor(core): build one-channel runtime"`

## Task 6: Build RuntimeManager

**Files:**
- Create: `core/src/runtime/manager.ts`
- Modify: `core/src/runtime/index.ts`
- Test: `core/tests/runtime-manager.test.ts`

**Interfaces:**
- Consumes: `EventRecord`, `ChannelRuntime`, `ChannelScope`, `Will.Factory`, `AssetStore`, model resolver, and Agent-plugin factories.
- Produces:

```ts
export class RuntimeManager {
  route(record: EventRecord): Promise<ChannelRuntime.Result>;
  setWill(factory: Will.Factory): void;
  reset(scope: ChannelScope): Promise<void>;
  stop(): Promise<void>;
}
```

- [ ] **Step 1: Write failing manager tests for atomic creation and isolation.**

```ts
it("creates one runtime for concurrent first events", async () => {
  const [left, right] = await Promise.all([manager.route(record("a")), manager.route(record("b"))]);
  expect(factory).toHaveBeenCalledOnce();
  expect(left).toBeDefined();
  expect(right).toBeDefined();
});

it("keeps different channels isolated", async () => {
  await manager.route(record("room-a"));
  await manager.route(record("room-b"));
  expect(runtimeCount()).toBe(2);
});
```

- [ ] **Step 2: Run the manager tests and verify the missing-module failure.**

Run: `yarn workspace koishi-plugin-yesimbot exec vitest run tests/runtime-manager.test.ts`

Expected: FAIL because `core/src/runtime/manager.ts` is not present.

- [ ] **Step 3: Implement channel-keyed get-or-create and route delegation.**

```ts
private async getOrCreate(scope: ChannelScope): Promise<ChannelRuntime> {
  const key = channelKey(scope);
  const existing = this.runtimes.get(key);
  if (existing) return existing;
  const pending = this.creating.get(key);
  if (pending) return pending;
  const creation = this.createRuntime(scope).finally(() => this.creating.delete(key));
  this.creating.set(key, creation);
  return creation;
}

async route(record: EventRecord): Promise<ChannelRuntime.Result> {
  const scope = fromEvent(record);
  if (!scope) throw new Error("Accepted event requires a channel");
  return (await this.getOrCreate(scope)).handle(record);
}
```

Resolve the current bot once for the record's `platform`/`selfId`, inject the current Will factory, and keep Session out of the constructor and route method.

- [ ] **Step 4: Implement Will replacement, reset, and stop tests.**

```ts
it("evicts old runtimes when the Will factory changes without deleting data", async () => {
  const first = vi.fn(async () => defaultWill);
  const second = vi.fn(async () => replacementWill);
  manager.setWill(first);
  await manager.route(record("room"));
  manager.setWill(second);
  await manager.route(record("room"));
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
  expect(await storage.read()).not.toEqual([]);
});
```

Reset must interrupt/stop Agent and Will, await channel work, clear JSONL/assets, and remove the runtime. Stop must stop admission and preserve persisted data.

- [ ] **Step 5: Verify manager lifecycle behavior and commit it.**

Run: `yarn workspace koishi-plugin-yesimbot exec vitest run tests/runtime-manager.test.ts tests/channel-runtime.test.ts`

Expected: PASS for atomic creation, replacement, reset, stop, same-channel FIFO, cross-channel isolation, and failure isolation.

Commit: `git add core/src/runtime/manager.ts core/src/runtime/index.ts core/tests/runtime-manager.test.ts && git commit -m "refactor(core): add runtime manager"`

## Task 7: Build Gateway Ingress And Resource Freezing

**Files:**
- Create: `core/src/gateway/index.ts`, `core/src/gateway/session.ts`, `core/src/gateway/message.ts`
- Modify: Session middleware registration and current platform message normalization code
- Test: `core/tests/gateway.test.ts`

**Interfaces:**
- Consumes: Koishi `Session`, `Element`, `internal/session`, `RuntimeManager.route()`, `AssetStore`, and normalized event helpers.
- Produces:

```ts
export interface ResolveContext {
  readonly session: Session;
  readonly base?: Omit<EventRecord<"message">, "content">;
  readonly freezeImage: (
    element: Element,
    load: (signal: AbortSignal, maxBytes: number) => Promise<{ data: Uint8Array; mime?: string }>,
  ) => Promise<Element>;
}

export interface SessionResolver {
  readonly platform: string;
  resolve(context: ResolveContext): Awaitable<EventRecord | null>;
}

export class Gateway {
  register(resolver: SessionResolver): () => void;
  close(): void;
  drain(): Promise<void>;
}
```

- [ ] **Step 1: Write failing resolver-registration and entry-point tests.**

```ts
it("allows one resolver per platform and returns an exact disposer", () => {
  const resolver: SessionResolver = { platform: "onebot", resolve: vi.fn() };
  const dispose = gateway.register(resolver);
  expect(() => gateway.register(resolver)).toThrow('Resolver for platform "onebot" is already registered');
  dispose();
  expect(() => gateway.register(resolver)).not.toThrow();
});

it("handles both message middleware and non-message internal sessions exactly once", async () => {
  await gateway.handle(messageSession);
  await ctx.emit("internal/session", noticeSession);
  expect(runtime.route).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run Gateway tests and verify the missing-module failure.**

Run: `yarn workspace koishi-plugin-yesimbot exec vitest run tests/gateway.test.ts`

Expected: FAIL because the Gateway modules are not present.

- [ ] **Step 3: Implement resolver selection and atomic Session conversion.**

```ts
private async resolve(session: Session): Promise<EventRecord | null> {
  const resolver = this.resolvers.get(session.platform);
  const base = draftMessageEventBase(session);
  if (!resolver) return base ? resolveFallbackMessage(session, base) : null;
  return resolver.resolve({
    session,
    ...(base ? { base } : {}),
    freezeImage: (element, load) => this.freezeImage(session, element, load),
  });
}
```

If `resolve()` throws, record a diagnostic and stop processing that Session; do not invoke fallback. If it returns `null`, release the Session without routing. The resolved record passed to RuntimeManager must contain no Session reference.

- [ ] **Step 4: Add bounded image-freezing tests and implement the capability.**

```ts
it.each([
  ["too many images", 5, 0, "unavailable"],
  ["per-image bytes", 1, 5 * 1024 * 1024 + 1, "unavailable"],
  ["total bytes", 3, 4 * 1024 * 1024, "unavailable"],
])("seals an image as unavailable when the %s budget is exceeded", async (_name, count, bytes, expected) => {
  const result = await freezeMany(count, bytes);
  expect(result.at(-1)?.attrs?.unavailable).toBe("true");
});

it("preserves quote by ID and forward by ID plus fixed summary", async () => {
  await expect(freezeImage(h("quote", { id: "q-1" }), neverLoad)).resolves.toEqual(h("quote", { id: "q-1" }));
  await expect(freezeImage(h("forward", { id: "f-1" }), neverLoad)).resolves.toEqual(
    h("forward", { id: "f-1", summary: "[合并转发] 使用 onebot_get_forward_message 查看详情" }),
  );
});
```

Use an `AbortController` per image, a 10-second timeout, a two-worker limiter, total-byte accounting, MIME allowlisting, and `AssetStore.put()` only after a successful bounded load. A failure returns an inline unavailable element and does not reject the whole event.

- [ ] **Step 5: Verify Gateway ingress and commit it.**

Run: `yarn workspace koishi-plugin-yesimbot exec vitest run tests/gateway.test.ts tests/asset.test.ts tests/element.test.ts`

Expected: PASS for exactly-once resolution, fallback, authoritative resolver errors, image limits, quote/forward bypass, and no Session retention below Gateway.

Commit: `git add core/src/gateway core/tests/gateway.test.ts && git commit -m "feat(core): add Session gateway ingress"`

## Task 8: Build Gateway Delivery

**Files:**
- Modify: `core/src/gateway/session.ts`, `core/src/gateway/message.ts`, `core/src/event/index.ts`
- Delete later: `core/src/delivery/`
- Test: `core/tests/gateway.test.ts`, `core/tests/delivery.test.ts` migrated into Gateway cases

**Interfaces:**
- Consumes: `ChannelRuntime.Result`, `ChannelRuntime.Output`, originating Session, current Bot, `createEvent()`, and `RuntimeManager.route()`.
- Produces: immediate passive output sends, normalized `string[]` receipts, active current-bot send behavior, and durable failure reinjection.

- [ ] **Step 1: Write failing output-consumption tests.**

```ts
it("sends each output immediately and preserves every receipt", async () => {
  runtime.route.mockResolvedValue({
    kind: "run",
    eventId: "e-1",
    turnId: "t-1",
    output: (async function* () {
      yield { turnId: "t-1", messageId: "a-1", content: "first" };
      yield { turnId: "t-1", messageId: "a-2", content: "second" };
    })(),
  });
  session.send.mockResolvedValueOnce(["r-1"]).mockResolvedValueOnce([]);
  await gateway.handle(messageSession);
  expect(session.send.mock.calls).toHaveLength(2);
  expect(session.send.mock.results.map((result) => result.value)).toEqual([expect.any(Promise), expect.any(Promise)]);
});
```

- [ ] **Step 2: Implement the passive output loop with per-message isolation.**

```ts
for await (const output of result.output) {
  try {
    await session.send(output.content);
  } catch (cause) {
    await this.recordDeliveryFailure(record, output, cause);
  }
}
```

Do not let one rejected send stop iteration over later outputs. `wait` and `join` release the Session without creating a second output consumer.

- [ ] **Step 3: Add failure-reinjection tests and implement the guarded path.**

```ts
it("routes one delivery.failed event per rejected output and continues", async () => {
  session.send.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(["r-2"]);
  await gateway.handle(messageSession);
  expect(runtime.route).toHaveBeenCalledWith(expect.objectContaining({ type: "delivery.failed" }));
  expect(session.send).toHaveBeenCalledTimes(2);
});

it("records a diagnostic instead of recursively reinjecting a failure", async () => {
  runtime.route.mockRejectedValue(new Error("history unavailable"));
  session.send.mockRejectedValue(new Error("offline"));
  await gateway.handle(messageSession);
  expect(runtime.route).toHaveBeenCalledOnce();
  expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ code: "delivery.failed" }));
});
```

Normalize errors to `{ name, message, code? }`; include `turnId` and assistant `messageId`; use a reentrancy guard so a failed `delivery.failed` route cannot create another failure.

- [ ] **Step 4: Prove delivery remains inside Gateway and ChannelRuntime.**

```ts
it("constructs Gateway and ChannelRuntime without a DeliveryService dependency", () => {
  expect(gatewayDependencies).not.toHaveProperty("delivery");
  expect(channelRuntimeDependencies).not.toHaveProperty("delivery");
});
```

Keep passive `Session.send()` in Gateway and active `Bot.sendMessage()` in ChannelRuntime. Do not introduce a shared delivery abstraction or listener registry; Task 9 removes the public facade property.

- [ ] **Step 5: Verify delivery behavior and commit it.**

Run: `yarn workspace koishi-plugin-yesimbot exec vitest run tests/gateway.test.ts tests/delivery.test.ts`

Expected: PASS for ordered logical output, empty receipt arrays, later-output continuation, guarded failure reinjection, current-bot sends, and no public DeliveryService surface.

Commit: `git add core/src/gateway core/src/event/index.ts core/tests/gateway.test.ts core/tests/delivery.test.ts && git commit -m "refactor(core): move delivery into gateway"`

## Task 9: Switch Service Composition And Public API

**Files:**
- Create: `core/src/service.ts`
- Modify: `core/src/index.ts`, `core/src/config.ts`, `core/package.json`
- Delete later: `core/src/runtime/service.ts`
- Test: `core/tests/lifecycle.test.ts`, `core/tests/service.test.ts`

**Interfaces:**
- Consumes: `ModelService`, `Gateway`, `RuntimeManager`, `AssetStore`, `SessionResolver`, `Will.Factory`, and Agent plugin factories.
- Produces:

```ts
export interface AgentPluginFactory {
  (context: { readonly channel: ChannelScope; readonly bot: Bot }): Awaitable<AgentPlugin | null>;
  readonly requiresMessageId?: boolean;
}

export class YesImBotService extends Service<Config> {
  readonly model: ModelService;
  registerResolver(resolver: SessionResolver): () => void;
  registerWill(factory: Will.Factory): () => void;
  registerAgentPlugin(factory: AgentPluginFactory): () => void;
  reset(scope: ChannelScope): Promise<void>;
  stop(): Promise<void>;
}
```

- [ ] **Step 1: Write failing public-surface tests.**

```ts
it("exposes only the confirmed facade", () => {
  expect(ctx.yesimbot.model).toBeDefined();
  expect(ctx.yesimbot.registerResolver).toEqual(expect.any(Function));
  expect(ctx.yesimbot.registerWill).toEqual(expect.any(Function));
  expect(ctx.yesimbot.registerAgentPlugin).toEqual(expect.any(Function));
  expect(ctx.yesimbot.reset).toEqual(expect.any(Function));
  expect("platform" in ctx.yesimbot).toBe(false);
  expect("delivery" in ctx.yesimbot).toBe(false);
});
```

- [ ] **Step 2: Implement composition and registration disposers.**

```ts
this.assets = new AssetStore({ basePath: resolveBasePath(config.basePath, ctx.baseDir), maxFileBytes: IMAGE_BUDGET.maxBytesPerImage });
this.runtime = new RuntimeManager({ ctx, config, assets: this.assets, getAgentPlugins: this.createAgentPlugins.bind(this) });
this.gateway = new Gateway({ ctx, assets: this.assets, runtime: this.runtime, logger: this.logger });
```

Register Koishi command and middleware through Gateway. Registering a new Will factory evicts existing runtimes through RuntimeManager without clearing history/assets. Each registration returns a live identity-checked disposer.

- [ ] **Step 3: Add lifecycle ordering tests and update config.**

```ts
it("closes Gateway before stopping runtimes and preserves data on stop", async () => {
  await service.stop();
  expect(order).toEqual(["gateway.close", "runtime.stop", "gateway.drain"]);
  await expect(storage.read()).resolves.not.toEqual([]);
});
```

Replace platform profiles and append/reply routing with optional `will: { direct?, mention?, group? }`; retain `basePath`, `chatModel`, and `logLevel`.

- [ ] **Step 4: Update package exports and root declarations.**

```json
{
  "exports": {
    ".": "./lib/index.js",
    "./model": "./lib/model/index.js",
    "./package.json": "./package.json"
  }
}
```

Root-export config, service, channel, event, Gateway contracts, and Will. Do not export RuntimeManager, ChannelRuntime, AssetStore, or shared implementation modules.

- [ ] **Step 5: Verify the public surface and commit it.**

Run: `yarn workspace koishi-plugin-yesimbot exec vitest run tests/service.test.ts tests/lifecycle.test.ts`

Expected: PASS for one shared AssetStore, service registration order, reset delegation, stop preservation, public API absence, and live disposers.

Commit: `git add core/src/service.ts core/src/index.ts core/src/config.ts core/package.json core/tests/service.test.ts core/tests/lifecycle.test.ts && git commit -m "refactor(core): switch service composition"`

## Task 10: Migrate OneBot To SessionResolver

**Files:**
- Modify: `platforms/onebot/src/index.ts`, `platforms/onebot/src/events.ts`, OneBot tests
- Create: `platforms/onebot/src/image.ts`
- Delete: `platforms/onebot/src/prepare.ts`

**Interfaces:**
- Consumes: OneBot `Session`, OneBot internal payloads, generic Satori message base, and `ResolveContext.freezeImage()`.
- Produces: `createResolver(ctx): SessionResolver`, typed non-message `EventRecord` values, frozen message elements, and `null` for unsupported input.

- [ ] **Step 1: Write failing resolver tests against the new facade.**

```ts
it("registers one OneBot resolver and preserves the message base", async () => {
  const plugin = new OneBotPlugin(ctx, config);
  await plugin.start();
  const resolver = registeredResolver("onebot");
  const result = await resolver.resolve({ session: messageSession, base, freezeImage });
  expect(result?.type).toBe("message");
  expect(result?.message).toEqual(expect.objectContaining({ id: base.message.id }));
});
```

- [ ] **Step 2: Run the focused OneBot tests and verify old-API failures.**

Run: `yarn workspace koishi-plugin-yesimbot-platform-onebot exec vitest run tests/index.test.ts tests/events.test.ts tests/image.test.ts`

Expected: FAIL at old `ctx.yesimbot.platform.register()` or adapter/refiner expectations until the resolver migration is applied.

- [ ] **Step 3: Implement `createResolver(ctx)` with message and event branches.**

```ts
export function createResolver(ctx: Context): SessionResolver {
  return {
    platform: "onebot",
    async resolve({ session, base, freezeImage }) {
      const event = resolveOneBotEvent(session);
      if (event) return event;
      if (!base) return null;
      return resolveOneBotMessage({ session, base, freezeImage });
    },
  };
}
```

Check supported reactions/notices before the optional message base. Return `null` for unsupported non-message events; do not add resolver/type pass-through modules.

- [ ] **Step 4: Move image acquisition and event declaration merging.**

```ts
declare module "koishi-plugin-yesimbot" {
  interface EventMap {
    "onebot.message-reactions-updated": {
      channel: Universal.Channel;
      reaction: MessageReactionsUpdated;
    };
  }
}
```

Move OneBot-specific URL/file extraction to `image.ts`, pass every eligible image through `freezeImage()`, and preserve NapCat/Lagrange field handling without reimplementing core limits.

- [ ] **Step 5: Verify OneBot migration and commit it.**

Run: `yarn workspace koishi-plugin-yesimbot-platform-onebot exec vitest run tests/index.test.ts tests/events.test.ts tests/image.test.ts`

Run: `yarn turbo run check-types --filter=koishi-plugin-yesimbot-platform-onebot`

Expected: PASS with no `Platform.Adapter`, `prepare.ts`, or `ctx.yesimbot.platform` reference.

Commit: `git add platforms/onebot/src platforms/onebot/tests && git commit -m "refactor(onebot): migrate to SessionResolver"`

## Task 11: Migrate Plugins And Core Imports

**Files:**
- Modify: `plugins/*/src/index.ts`, provider imports, core imports, and their focused tests
- Delete references to: `ChannelAgentContext`, `platform.scope`, `platform.unsafeBot`, `yesimbot/platform`, and `yesimbot/delivery`

**Interfaces:**
- Consumes: the new `AgentPluginFactory` context `{ channel: ChannelScope; bot: Bot }` and root public exports.
- Produces: plugin factories that remain live, preserve tool behavior, and set static message-id capability where needed.

- [ ] **Step 1: Find and write compile-time migration coverage.**

Run: `rg -n 'ChannelAgentContext|platform\\.(scope|unsafeBot)|yesimbot\\.(platform|delivery)|koishi-plugin-yesimbot/(platform|shared)' core plugins providers platforms`

Add a focused type test:

```ts
const factory: AgentPluginFactory = async ({ channel, bot }) => ({
  name: `plugin-${channel.platform}`,
  tools: bot ? [] : [],
});
```

- [ ] **Step 2: Migrate optional plugin factories and preserve capability behavior.**

```ts
const factory = Object.assign(
  async ({ channel, bot }: { channel: ChannelScope; bot: Bot }) =>
    channel.platform === "onebot" ? { name: "onebot-utils", tools: createOneBotTools(bot) } : null,
  { requiresMessageId: true },
);

disposeAgentPlugin = ctx.yesimbot.registerAgentPlugin(factory);
```

Keep forward sanitization, reaction, and essence tools unchanged apart from receiving the current `Bot`; retain the existing 1000-character/6000-character/1-20 record bounds.

- [ ] **Step 3: Switch all core/provider imports and remove compatibility subpaths.**

Use root imports for `ChannelScope`, `Event`, `Will`, and public registration contracts. Use relative imports for `runtime/*` and `shared/*` internals. Do not add forwarding files.

- [ ] **Step 4: Verify plugin and provider consumers and commit it.**

Run: `yarn check-types`

Expected: PASS with zero matches for the old symbols from Step 1 and unchanged optional-plugin tool tests.

Commit: `git add core plugins providers platforms/onebot && git commit -m "refactor(plugins): migrate Agent plugin context"`

## Task 12: Remove Legacy Runtime Boundaries

**Files:**
- Delete: `core/src/platform/`, `core/src/delivery/`, `core/src/extension/`, `core/src/shared/types.ts`, `core/src/runtime/service.ts`, `core/src/runtime/channel-runtime.ts`, `core/src/runtime/key.ts`, `core/src/runtime/message.ts`, `core/src/runtime/render.ts`, and `platforms/onebot/src/prepare.ts`
- Modify: `core/src/index.ts`, `core/package.json`, tests that name removed boundaries

**Interfaces:**
- Consumes: all replacement modules and passing integration tests from Tasks 1-11.
- Produces: a clean source tree with no legacy type readers, services, adapters, or compatibility exports.

- [ ] **Step 1: Prove no live consumer remains before deletion.**

Run: `rg -n 'PlatformService|DeliveryService|ChannelAgentContext|athena\\.platform\\.message|yesimbot\\.(platform|delivery)|from ["'"'].*(platform|delivery|shared/types)' core platforms plugins providers`

Expected: only intentional migration-test assertions and OpenSpec documentation remain; all implementation imports have already moved.

- [ ] **Step 2: Delete obsolete modules and tests.**

Remove tests that verify deleted boundaries, while retaining behavior tests mapped to Channel, Event, formatter, Will, RuntimeManager, Gateway, and lifecycle contracts. Do not add a legacy JSONL reader or a migration fallback.

- [ ] **Step 3: Verify package exports and clean-break persistence behavior.**

```ts
it("does not load a legacy platform message entry", async () => {
  await writeFile(legacyPath, `${JSON.stringify(legacyPlatformEntry)}\n`, "utf8");
  const storage = createJsonlStorage<EventEntry>(newEventPath);
  await expect(storage.read()).resolves.toEqual([]);
});
```

Run: `yarn check-types`

Expected: PASS and no removed public subpath is present in `core/package.json`.

- [ ] **Step 4: Commit the deletion after the clean compile.**

Commit: `git add -A core platforms/onebot && git commit -m "refactor(core): remove legacy runtime boundaries"`

## Task 13: Complete Cross-Module Behavioral Coverage

**Files:**
- Modify: `core/tests/channel-runtime.test.ts`, `core/tests/runtime-manager.test.ts`, `core/tests/gateway.test.ts`, `core/tests/lifecycle.test.ts`, OneBot focused tests

**Interfaces:**
- Consumes: all public behavior from Tasks 1-12.
- Produces: regression coverage for ordering, races, failure isolation, replay, and the clean break.

- [ ] **Step 1: Add lifecycle-race tests.**

```ts
it("does not admit a new Session after Gateway close", async () => {
  gateway.close();
  await expect(gateway.handle(messageSession)).resolves.toBeUndefined();
  expect(runtime.route).not.toHaveBeenCalled();
});

it("isolates Will and Agent stop failures", async () => {
  will.stop = vi.fn().mockRejectedValue(new Error("will stop failed"));
  agent.stop = vi.fn().mockRejectedValue(new Error("agent stop failed"));
  await expect(manager.stop()).resolves.toBeUndefined();
  expect(logger.warn).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Add delivery ordering and replay tests.**

```ts
it("continues a later output after an earlier passive send fails", async () => {
  session.send.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(["ok"]);
  await gateway.handle(messageSession);
  expect(session.send).toHaveBeenCalledTimes(2);
  expect(deliveryFailureRecords()).toHaveLength(1);
});

it("projects reloaded Event content without remote access", async () => {
  const result = await reloadAndProject(eventJsonl);
  expect(platformApi).not.toHaveBeenCalled();
  expect(result).toContain("stored content");
});
```

- [ ] **Step 3: Run all focused core and OneBot tests.**

Run:

```bash
yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel.test.ts tests/event.test.ts tests/formatter.test.ts tests/will.test.ts tests/channel-runtime.test.ts tests/runtime-manager.test.ts tests/gateway.test.ts tests/lifecycle.test.ts tests/asset.test.ts tests/element.test.ts
yarn workspace koishi-plugin-yesimbot-platform-onebot exec vitest run tests/index.test.ts tests/events.test.ts tests/image.test.ts
```

Expected: PASS, including exactly one failure record per passive rejected output, no recursive reinjection, preserved output order, clean shutdown, local-only replay, and rejection of legacy records.

- [ ] **Step 4: Commit the complete regression coverage.**

Commit: `git add core/tests platforms/onebot/tests && git commit -m "test(core): cover session event lifecycle"`

## Task 14: Run Final Verification

**Files:**
- Verify: all files in this change; update only task checkboxes after evidence is recorded

**Interfaces:**
- Consumes: the completed implementation and all focused tests.
- Produces: a strictly valid OpenSpec change ready for `verify.md` and later archive.

- [ ] **Step 1: Validate OpenSpec and formatting.**

Run: `openspec validate redesign-session-event-pipeline --strict`

Run: `yarn fmt:check`

Expected: both commands exit 0; no artifact has placeholder text, contradictory interfaces, or unchecked required structure.

- [ ] **Step 2: Run the repository checks in CI order.**

Run:

```bash
yarn lint
```

Expected: all commands pass. If a test resolution failure occurs because a workspace reference is stale, build the affected workspace first and rerun the narrow command before rerunning the full sequence.

- [ ] **Step 3: Inspect exports, source boundaries, and diff hygiene.**

Run:

```bash
rtk git diff --check
rtk git status --short
rg -n 'PlatformService|DeliveryService|ChannelAgentContext|athena\\.platform\\.message|yesimbot\\.(platform|delivery)|from ["'"'].*(platform|delivery|shared/types)' core platforms plugins providers
```

Expected: `git diff --check` passes, only intended source/test/artifact files are modified, and the search returns no implementation reference to removed symbols.

- [ ] **Step 4: Mark OpenSpec tasks only after verification evidence.**

Update each checkbox in `openspec/changes/redesign-session-event-pipeline/tasks.md` only after its focused command has passed. Do not mark the change complete before `openspec validate --strict`, package checks, build, and tests all pass. Leave `verify.md` for the OpenSpec verification step and use `/opsx:continue` when that artifact is ready to be created.
