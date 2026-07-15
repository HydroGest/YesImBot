# Platform Adapter Slice 01 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` to implement this plan task-by-task.
> Each task uses TDD and ends with a reviewable patch checkpoint.

**Goal:** Deliver the first complete platform adapter implementation: core
Session collection and schemas, stable message/event views, pre-persistence
resource snapshots, channel-local assets, and OneBot reaction/forward/image
validation.

**Architecture:** Core synchronously converts each Satori-dispatched Session into
validated `Platform.*` facts and preserves existing middleware routing. Optional
resource I/O happens after conversion and before first agent persistence; frozen
snapshots make the core `toModelMessages` path deterministic. A separate OneBot
plugin registers the real native-event and resource-reading proof cases.

**Tech Stack:** TypeScript 5.9, Koishi 4.18, Satori, Zod 3.25, AI SDK 6,
Vitest 4, Yarn 4, Turbo, Node.js filesystem and crypto APIs.

## Global Constraints

- Use Yarn 4 commands prefixed with `rtk`; do not use npm or pnpm.
- Keep all platform adaptation in core and `plugins/platform-onebot`; do not
  modify agent-runtime unless a test proves its existing hooks cannot satisfy a
  documented requirement.
- Public names use `Platform.*` and `ctx.yesimbot.platform.register()/publish()`.
- Do not introduce Capability, Ingress, Projector, Envelope, Activity,
  ProcessingScope, or Presentation as public concepts.
- Synchronous Session conversion performs no I/O and retains no raw Session,
  Bot, token, stream, or native payload in persisted facts.
- `toModelMessages` performs deterministic rendering only and performs no
  platform reads, downloads, or historical mutation.
- Existing self-ignore, ordinary observation, private/mention turn, and busy
  join behavior must remain unchanged.
- Do not create a global event archive, replay dedupe cache, global asset index,
  output adapter, world-state implementation, or willingness implementation.
- Follow the requirements in `../../specs/platform-input-adaptation/spec.md`,
  `../../specs/platform-llm-presentation/spec.md`, and
  `../../specs/core-runtime-integration/spec.md`.
- Work with existing uncommitted changes; never revert unrelated user work.
- Do not create commits or branches unless the user explicitly requests them.

## Planned File Responsibilities

- `core/src/platform/types.ts`: public `Platform` namespace and declaration maps.
- `core/src/platform/schema.ts`: built-in Zod schemas and dynamic extension
  validation.
- `core/src/platform/registry.ts`: live registrations, matching, disposal, and
  synchronous consumer notification.
- `core/src/platform/normalize.ts`: pure Session-to-message/event conversion.
- `core/src/platform/view.ts`: Satori parsing plus message/event view creation.
- `core/src/platform/render.ts`: deterministic body templates and AI SDK model
  content conversion.
- `core/src/platform/resources.ts`: reference discovery, policy enforcement, and
  pre-persistence snapshot orchestration.
- `core/src/platform/assets.ts`: channel-local content-addressed binary storage.
- `core/src/platform/index.ts`: public platform exports.
- `core/src/config.ts`: global resource policy configuration.
- `core/src/service.ts`: `internal/session`, middleware correlation, platform
  service surface, routing, and disposal.
- `core/src/runtime/message.ts`: core runtime custom-message constructors and
  deterministic platform model plugin.
- `core/src/channel.ts`: channel asset path and cleanup helpers.
- `plugins/platform-onebot/`: independent inbound OneBot adapter and readers.

---

## Task 1: Public Platform Contracts and Configuration

**Files:**
- Modify: `core/src/platform/types.ts`
- Create: `core/src/platform/schema.ts`
- Modify: `core/src/platform/index.ts`
- Modify: `core/src/config.ts`
- Modify: `core/src/shared/types.ts`
- Modify: `core/src/service.ts`
- Test: `core/tests/platform-types.test.ts`
- Test: `core/tests/service.test.ts`

**Interfaces:**
- Produces: `Platform.Message`, `Platform.Event`, `Platform.Scope`,
  `Platform.Adapter`, `Platform.MessageView`, `Platform.EventView`,
  `Platform.Reader`, built-in schemas, and resource-policy config.
- Consumed by: every later Slice 01 task.

- [ ] **Step 1: Add failing public-type and schema tests**

Create `core/tests/platform-types.test.ts` with runtime assertions for the
built-in schemas and compile-time uses of the namespace:

```ts
import { describe, expect, it } from "vitest";

import { Platform, platformMessageSchema, platformScopeSchema } from "../src/platform/index.js";

describe("Platform contracts", () => {
  it("validates a channel-scoped Satori message", () => {
    const message = platformMessageSchema.parse({
      version: 1,
      source: { platform: "onebot", selfId: "10000" },
      scope: { type: "channel", channelId: "20000" },
      author: { type: "user", id: "30000", name: "Alice" },
      messageId: "40000",
      timestamp: 1,
      receivedAt: 2,
      content: "hello <at id=\"10000\"/>",
      resources: [],
      extensions: {},
    });

    expect(message.scope).toEqual({ type: "channel", channelId: "20000" });
  });

  it("rejects a guild scope without a guild id", () => {
    expect(() => platformScopeSchema.parse({ type: "guild" })).toThrow();
  });

  it("exposes short namespace types", () => {
    const scope: Platform.Scope = { type: "account" };
    expect(scope.type).toBe("account");
  });
});
```

Add a service surface assertion to `core/tests/service.test.ts`:

```ts
expect(ctx.yesimbot.platform).toMatchObject({
  register: expect.any(Function),
  publish: expect.any(Function),
});
```

- [ ] **Step 2: Run the focused tests and verify the red state**

Run:

```text
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-types.test.ts tests/service.test.ts
```

Expected: FAIL because `Platform`, the schemas, and `ctx.yesimbot.platform` do
not exist with the approved shape.

- [ ] **Step 3: Define the public namespace and declaration maps**

Implement the following public shape in `core/src/platform/types.ts`; use the
same field names in later tasks:

```ts
import type { ModelMessage } from "ai";
import type { Session } from "koishi";
import type { z } from "zod";

export namespace Platform {
  export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
  export type JsonObject = { [key: string]: Json };

  export interface Source {
    platform: string;
    selfId: string;
  }

  export type Scope =
    | { type: "channel"; channelId: string; guildId?: string; threadId?: string }
    | { type: "guild"; guildId: string }
    | { type: "account" };

  export interface Entity<T extends "user" | "channel" | "guild" | "role" =
    | "user"
    | "channel"
    | "guild"
    | "role"> {
    type: T;
    id: string;
    name?: string;
    avatar?: string;
  }

  export interface Events {}
  export interface Extensions {}

  export interface Ref {
    type: string;
    id: string;
    data?: JsonObject;
  }

  export interface Asset {
    hash: string;
    size: number;
    mime: string;
    name?: string;
  }

  export type Resource =
    | { type: "messages"; messages: MessageView[] }
    | { type: "metadata"; data: JsonObject }
    | { type: "asset"; asset: Asset };

  export type Snapshot =
    | { state: "resolved"; ref: Ref; value: Resource; policy: 1; truncated: boolean }
    | { state: "unavailable"; ref: Ref; policy: 1; reason: "disabled" | "missing" | "failed" | "timeout" | "limit" };

  export interface Message {
    version: 1;
    source: Source;
    scope: Extract<Scope, { type: "channel" }>;
    author: Entity<"user">;
    messageId: string;
    timestamp?: number;
    receivedAt: number;
    content: string;
    quote?: Ref;
    resources: Snapshot[];
    extensions: Partial<Extensions>;
  }

  export interface Event<K extends keyof Events = keyof Events> {
    version: 1;
    source: Source;
    scope: Scope;
    type: K;
    timestamp?: number;
    receivedAt: number;
    data: Events[K];
    extensions: Partial<Extensions>;
  }

  export type MessagePart =
    | { type: "text"; text: string }
    | { type: "mention"; entity: Entity<"user"> }
    | { type: "emoji"; id?: string; name?: string }
    | { type: "media"; media: "image" | "audio" | "video" | "file"; name?: string; mime?: string; asset?: Ref; alt?: string }
    | { type: "quote"; message?: MessageView; ref: Ref }
    | { type: "forward"; messages: MessageView[]; ref: Ref; truncated: boolean }
    | { type: "unknown"; name: string };

  export interface MessageView {
    author?: Entity<"user">;
    timestamp?: number;
    parts: MessagePart[];
  }

  export interface Fact {
    key: string;
    value: Json | Entity;
  }

  export interface EventView {
    action: string;
    actor?: Entity;
    target?: Entity;
    facts: Fact[];
  }

  export interface ReadContext {
    source: Source;
    scope: Scope;
    bot: unknown;
    signal: AbortSignal;
  }

  export type ReadResult =
    | { type: "messages"; messages: MessageView[] }
    | { type: "metadata"; data: Json }
    | {
        type: "asset";
        data: Uint8Array;
        name?: string;
        mime?: string;
      };

  export interface Reader {
    id: string;
    type: string;
    read(ref: Ref, context: ReadContext): Promise<ReadResult | undefined>;
  }

  export interface EventDefinition<T> {
    schema: z.ZodType<T>;
    view(data: T): EventView;
  }

  export interface Adapter {
    id: string;
    version?: string;
    platform?: string;
    adapter?: string;
    profile?: string;
    accepts?(session: Session): boolean;
    adapt?(session: Session, value?: Message | Event): Message | Event | void;
    events?: Record<string, EventDefinition<unknown>>;
    readers?: readonly Reader[];
  }
}
```

Use `@ai-sdk/provider-utils` only where an actual `ModelMessage` type is needed;
remove the unused import from this sketch if the final type file does not expose
it.

- [ ] **Step 4: Add built-in Zod schemas and global resource config**

In `core/src/platform/schema.ts`, define strict Zod schemas for `Source`, each
`Scope` branch, `Entity`, `Ref`, `Snapshot`, and `Message`. Export a helper used
by the registry for plugin schemas:

```ts
export function parseWith<T>(schema: z.ZodType<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  return result.data;
}
```

Extend `core/src/config.ts` with one nested policy and these first-version
defaults:

```ts
export interface ResourceConfig {
  forward: "off" | "inline" | "resolve";
  quote: "off" | "inline" | "resolve";
  detail: "reference" | "summary" | "full";
  maxDepth: number;
  maxItems: number;
  maxChars: number;
  timeoutMs: number;
  concurrency: number;
  maxRequests: number;
  media: "metadata" | "image";
  allowedMime: string[];
  maxFileBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_RESOURCES: ResourceConfig = {
  forward: "inline",
  quote: "inline",
  detail: "summary",
  maxDepth: 2,
  maxItems: 20,
  maxChars: 12_000,
  timeoutMs: 5_000,
  concurrency: 2,
  maxRequests: 4,
  media: "metadata",
  allowedMime: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
};
```

Represent the same defaults with Koishi `Schema` and add them under
`Config.platform.resources`. Add empty `Config.platform.profiles` and default
template fields in the same nested object so later tasks extend one stable
configuration boundary.

- [ ] **Step 5: Expose the narrow service shape**

Add the service type in `core/src/shared/types.ts` and initialize it from
`YesImBotService`:

```ts
export interface PlatformService {
  register(adapter: Platform.Adapter): () => void;
  publish(input: Omit<Platform.Message, "receivedAt">): Platform.Message;
  publish<K extends keyof Platform.Events>(
    input: Omit<Platform.Event<K>, "receivedAt">,
  ): Platform.Event<K>;
}
```

Keep consumer subscription internal to core for Slice 01. Expose only
`register()` and `publish()` on `ctx.yesimbot.platform`.

- [ ] **Step 6: Run tests, typecheck, format, and review checkpoint**

Run:

```text
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-types.test.ts tests/service.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
rtk yarn exec oxfmt --write core/src/platform core/src/config.ts core/src/shared/types.ts core/tests/platform-types.test.ts core/tests/service.test.ts
```

Expected: focused tests and core typecheck PASS; formatter exits 0.

Review checkpoint:

```text
rtk git diff --check
rtk git diff -- core/src/platform core/src/config.ts core/src/shared/types.ts core/src/service.ts core/tests/platform-types.test.ts core/tests/service.test.ts
```

---

## Task 2: Live Registry and Satori Conversion

**Files:**
- Create: `core/src/platform/registry.ts`
- Create: `core/src/platform/normalize.ts`
- Modify: `core/src/platform/schema.ts`
- Modify: `core/src/platform/index.ts`
- Modify: `core/src/config.ts`
- Test: `core/tests/platform-registry.test.ts`
- Test: `core/tests/platform-normalize.test.ts`

**Interfaces:**
- Consumes: all `Platform.*` types and schemas from Task 1.
- Produces: `createPlatformRegistry()`, `normalizeSession()`, reader lookup,
  internal subscription, diagnostics, and built-in Satori event definitions.
- Consumed by: Tasks 3, 4, 5, and 6.

- [ ] **Step 1: Write failing registry selection tests**

Create `core/tests/platform-registry.test.ts` covering fixed specificity,
decline, ties, disposal, and publication:

```ts
import { describe, expect, it, vi } from "vitest";

import { createPlatformRegistry } from "../src/platform/registry.js";

describe("platform registry", () => {
  it("selects profile over adapter over platform", () => {
    const registry = createPlatformRegistry({ now: () => 10 });
    registry.register({ id: "platform", platform: "onebot" });
    registry.register({ id: "adapter", adapter: "onebot" });
    registry.register({ id: "profile", profile: "napcat" });

    expect(
      registry.match({ platform: "onebot", adapter: "onebot", profile: "napcat" }),
    ).toMatchObject({ id: "profile" });
  });

  it("rejects equal winning matches", () => {
    const registry = createPlatformRegistry({ now: () => 10 });
    registry.register({ id: "a", platform: "onebot" });
    registry.register({ id: "b", platform: "onebot" });

    expect(() => registry.match({ platform: "onebot" })).toThrow(/conflict/i);
  });

  it("removes all bundled registrations through one disposer", () => {
    const registry = createPlatformRegistry({ now: () => 10 });
    const dispose = registry.register({ id: "onebot", platform: "onebot" });
    dispose();
    expect(registry.match({ platform: "onebot" })).toBeUndefined();
  });

  it("publishes one validated fact to internal consumers", () => {
    const registry = createPlatformRegistry({ now: () => 10 });
    const listener = vi.fn();
    registry.subscribe(listener);
    const result = registry.publish({
      version: 1,
      source: { platform: "onebot", selfId: "1" },
      scope: { type: "channel", channelId: "2" },
      author: { type: "user", id: "3" },
      messageId: "4",
      content: "hello",
      resources: [],
      extensions: {},
    });

    expect(result.receivedAt).toBe(10);
    expect(listener).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Write failing Satori conversion tests**

Create `core/tests/platform-normalize.test.ts` with a minimal `Session` factory
and table-driven standard-event checks:

```ts
import type { Session } from "koishi";
import { describe, expect, it } from "vitest";

import { normalizeSession } from "../src/platform/normalize.js";

function session(event: Record<string, unknown>): Session {
  return {
    platform: "onebot",
    selfId: "10000",
    channelId: "20000",
    userId: "30000",
    messageId: "40000",
    username: "Alice",
    content: "hello",
    timestamp: 1,
    type: String(event.type ?? "message-created"),
    event,
    bot: { adapterName: "onebot" },
  } as unknown as Session;
}

describe("normalizeSession", () => {
  it("creates one channel-scoped message from a Satori message Session", () => {
    const result = normalizeSession(session({}), { receivedAt: 2 });
    expect(result).toMatchObject({
      kind: "message",
      value: {
        version: 1,
        messageId: "40000",
        receivedAt: 2,
        scope: { type: "channel", channelId: "20000" },
        content: "hello",
      },
    });
  });

  it.each([
    "message-deleted",
    "message-updated",
    "message-pinned",
    "message-unpinned",
    "guild-added",
    "guild-removed",
    "guild-updated",
    "guild-member-added",
    "guild-member-removed",
    "guild-member-updated",
    "guild-role-created",
    "guild-role-deleted",
    "guild-role-updated",
    "reaction-added",
    "reaction-removed",
    "login-added",
    "login-removed",
    "login-updated",
    "friend-request",
    "guild-request",
    "guild-member-request",
    "interaction/button",
    "interaction/command",
  ])("recognizes %s as a standard inbound event", (type) => {
    const result = normalizeSession(session({ type }), { receivedAt: 2 });
    expect(result.kind).not.toBe("unknown");
  });
});
```

Adapt each fixture with the minimum Satori resource IDs required by its schema;
the table must not weaken those schemas to make the test pass.

- [ ] **Step 3: Run focused tests and verify the red state**

Run:

```text
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-registry.test.ts tests/platform-normalize.test.ts
```

Expected: FAIL because registry and normalization modules do not exist.

- [ ] **Step 4: Implement the live registry**

In `core/src/platform/registry.ts`, expose this internal interface and keep its
consumer subscription out of the public service type:

```ts
type Fact = Platform.Message | Platform.Event;

export interface MatchInput {
  platform: string;
  adapter?: string;
  profile?: string;
  session?: Session;
}

export interface PlatformRegistry {
  register(adapter: Platform.Adapter): () => void;
  match(input: MatchInput): Platform.Adapter | undefined;
  publish(input: Omit<Platform.Message, "receivedAt">): Platform.Message;
  publish<K extends keyof Platform.Events>(
    input: Omit<Platform.Event<K>, "receivedAt">,
  ): Platform.Event<K>;
  subscribe(listener: (fact: Fact) => void): () => void;
  getReader(type: string): Platform.Reader | undefined;
}

export function createPlatformRegistry(options: {
  now: () => number;
  diagnostic?: (diagnostic: Platform.Diagnostic) => void;
}): PlatformRegistry;
```

Calculate rank from exact descriptor fields: profile `3`, adapter `2`, platform
`1`. Filter with synchronous `accepts(session)` before tie detection. Register
all event schemas and readers atomically, reject duplicate ids/types, and remove
the same bundle through the returned disposer. Notify a snapshot of listeners so
a listener can safely unsubscribe during publication; catch and diagnose each
listener error without stopping later listeners.

- [ ] **Step 5: Implement built-in normalization and schemas**

In `core/src/platform/normalize.ts`, define built-in `Platform.Events` payloads
through module augmentation and expose:

```ts
export type Normalized =
  | { kind: "message"; value: Platform.Message }
  | { kind: "event"; value: Platform.Event }
  | { kind: "unknown"; source: Platform.Source; nativeType: string; receivedAt: number }
  | { kind: "invalid"; source?: Platform.Source; error: Error; receivedAt: number };

export function normalizeSession(
  session: Session,
  options: { receivedAt: number; profile?: string; registry?: PlatformRegistry },
): Normalized;
```

Use Satori resources from `session.event` as the primary source and compatibility
Session accessors only as fallback. Convert `message-created` to the message
branch, ignore the `message` alias as a duplicate semantic type, and exclude
`before-send`, `send`, and deprecated bot aliases. Return `invalid` when an
event-specific minimum schema lacks identity fields; return safe `unknown`
metadata for unregistered native event types. Never retain Session or raw data
inside `value`.

- [ ] **Step 6: Add explicit profile configuration**

Add this first-version configuration to `core/src/config.ts` and its Koishi
schema:

```ts
platform: {
  profiles: Record<string, string>;
}
```

Use `session.bot.sid` (`platform:selfId`) as the key. Default to `{}`. Pass the
configured value into registry matching; do not infer profiles from raw fields.

- [ ] **Step 7: Run tests, typecheck, format, and review checkpoint**

Run:

```text
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-registry.test.ts tests/platform-normalize.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
rtk yarn exec oxfmt --write core/src/platform core/src/config.ts core/tests/platform-registry.test.ts core/tests/platform-normalize.test.ts
```

Expected: focused tests and core typecheck PASS.

Review checkpoint:

```text
rtk git diff --check
rtk git diff -- core/src/platform core/src/config.ts core/tests/platform-registry.test.ts core/tests/platform-normalize.test.ts
```

---

## Task 3: Koishi Session Collection and Message Routing

**Files:**
- Modify: `core/src/service.ts`
- Modify: `core/src/runtime/message.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/message-flow.test.ts`
- Test: `core/tests/service.test.ts`
- Test: `core/tests/error-handling.test.ts`
- Test: `core/tests/reset.test.ts`
- Test: `core/tests/platform-session.test.ts`

**Interfaces:**
- Consumes: `PlatformRegistry`, `normalizeSession()`, and `Platform.Message`.
- Produces: one Session collection path, `WeakMap<Session, Platform.Message>`
  correlation, prepended middleware routing, and synchronous non-message
  notification.
- Consumed by: the resource preparation stage in Task 5.

- [ ] **Step 1: Add failing collection and duplicate-prevention tests**

Create `core/tests/platform-session.test.ts` around a real Koishi `Context` mock:

```ts
it("converts at internal/session and routes the same message in middleware", async () => {
  const append = vi.fn().mockResolvedValue(undefined);
  const session = createSession({ content: "hello" });

  ctx.emit(session, "internal/session", session);
  await service.handleSession(session);

  expect(normalizeSpy).toHaveBeenCalledTimes(1);
  expect(append).toHaveBeenCalledTimes(1);
});

it("notifies a native event without routing it to a channel agent", () => {
  const listener = vi.fn();
  service.platformRegistry.subscribe(listener);
  const session = createNativeSession();

  ctx.emit(session, "internal/session", session);

  expect(listener).toHaveBeenCalledOnce();
  expect(createAgentSpy).not.toHaveBeenCalled();
});
```

Keep `platformRegistry` private in production; expose it to tests through a
factory dependency or a narrow test fixture, not a public service property.

Extend existing routing tests so the exact current actions remain:

```ts
expect(createMessageRoute(group, { isBusy: false })).toEqual({ action: "append" });
expect(createMessageRoute(privateMessage, { isBusy: false })).toEqual({ action: "run" });
expect(createMessageRoute(mentioned, { isBusy: true })).toEqual({ action: "send", ifBusy: "join" });
```

- [ ] **Step 2: Run focused tests and verify the red state**

Run:

```text
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-session.test.ts tests/message-flow.test.ts tests/error-handling.test.ts
```

Expected: FAIL because `internal/session` correlation and prepended middleware do
not exist.

- [ ] **Step 3: Install one collector and correlate by Session identity**

Add private state to `YesImBotService`:

```ts
private readonly platformRegistry = createPlatformRegistry({
  now: () => Date.now(),
  diagnostic: (item) => this.logger.warn(item),
});
private readonly sessionMessages = new WeakMap<Session, Platform.Message>();
```

Register the collector before middleware:

```ts
ctx.on("internal/session", (session) => this.collectSession(session));
ctx.middleware((session, next) => this.handleSession(session, next), true);
```

`collectSession()` must synchronously normalize once. Store the message branch in
the WeakMap. Publish valid non-message events to internal consumers immediately.
Log safe metadata for unknown or invalid results without publishing them.

- [ ] **Step 4: Route only the correlated message**

Change `handleSession()` to retrieve the WeakMap value, with one direct
normalization fallback for tests or manually invoked sessions:

```ts
const message = this.sessionMessages.get(session) ?? this.collectMessageFallback(session);
if (!message) return next();
```

Pass `message` to existing route logic; do not call the old Session conversion
again. Keep reply sending on the live Session. Ordinary append failures still
log without sending; direct/mention failures may send the existing generic
error. Call `next()` only where current route semantics allow downstream
middleware, preserving existing tests.

- [ ] **Step 5: Expose the approved platform service**

Bind public operations without leaking registry internals:

```ts
readonly platform: PlatformService = {
  register: (adapter) => this.platformRegistry.register(adapter),
  publish: (input) => this.platformRegistry.publish(input as never) as never,
};
```

Implement overloads without keeping the cast at public call sites. Ensure core
plugin disposal removes internal listeners through Koishi lifecycle and disposes
registered adapters through their owning plugin disposers.

- [ ] **Step 6: Run focused and core package verification**

Run:

```text
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-session.test.ts tests/message-flow.test.ts tests/service.test.ts tests/error-handling.test.ts tests/reset.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
rtk yarn turbo run build --filter=koishi-plugin-yesimbot
rtk yarn exec oxfmt --write core/src/service.ts core/src/runtime/message.ts core/src/index.ts core/tests
```

Expected: focused tests, core typecheck, and core build PASS.

Commit point:

```text
rtk git diff --check
rtk git diff -- core/src/service.ts core/src/runtime/message.ts core/src/index.ts core/tests
```

---

## Task 4: Build Stable Message and Event Views

**Files:**
- Modify: core/src/platform/types.ts
- Create: core/src/platform/view.ts
- Create: core/src/platform/render.ts
- Modify: core/src/platform/index.ts
- Modify: core/src/runtime/message.ts
- Modify: core/src/config.ts
- Create: core/tests/platform-view.test.ts
- Modify: core/tests/channel-message.test.ts

**Step 1: Specify the two separate view models**

Add failing type and runtime tests for the approved split:

    Platform.MessageView {
      author?: Platform.Entity<"user">
      timestamp?: number
      parts: readonly Platform.MessagePart[]
    }

    Platform.EventView {
      action: string
      actor?: Platform.Entity
      target?: Platform.Entity
      facts: readonly Platform.Fact[]
    }

Platform.MessagePart is a closed discriminated union:

    export type MessagePart =
      | { type: "text"; text: string }
      | { type: "mention"; entity: Entity<"user"> }
      | { type: "emoji"; id?: string; name?: string }
      | {
          type: "media"
          media: "image" | "audio" | "video" | "file"
          name?: string
          mime?: string
          asset?: Ref
          alt?: string
        }
      | { type: "quote"; message?: MessageView; ref: Ref }
      | {
          type: "forward"
          messages: readonly MessageView[]
          ref: Ref
          truncated: boolean
        }
      | { type: "unknown"; name: string }

Platform.Fact accepts scalar values, entity references, message references,
media references, durations, and ordered scalar lists. It MUST NOT accept raw
objects or final prompt text.

Run:

    rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-view.test.ts

Expected: FAIL because the view types and parser do not exist.

**Step 2: Parse Satori content without duplicating persisted content**

Implement core/src/platform/view.ts with:

    export function createMessageView(
      message: Platform.Message,
      options: ViewOptions,
    ): Platform.MessageView

Use h.parse(message.content) and recursively map:

- text, paragraph, and line-break elements to text parts;
- at elements to mention parts;
- face and emoji elements to emoji parts;
- img, audio, video, and file elements to media references;
- quote elements and message.quote to quote parts;
- message/forward elements to nested message views;
- unknown elements to safe placeholders without dumping attrs.

Apply maxDepth, maxItems, and maxChars while building the view. When a limit is
reached, retain a truncated marker so the LLM knows content was omitted.

Do not resolve references or read assets in this function.

**Step 3: Define event views through registered event definitions**

Extend the internal event definition registry so each registered event type
contains:

    {
      schema: z.ZodType<T>
      view(data: T, context: EventViewContext): Platform.EventView
    }

Core supplies definitions for every Satori standard inbound event. A custom
definition may return only Platform.EventView data. Reject definitions that
return arbitrary ModelMessage values or templates.

Add cases proving:

- a standard guild-member-added event produces actor, target, action, and facts;
- a namespaced OneBot event can provide its own typed view;
- a definition cannot access raw Session data during later rendering.

**Step 4: Implement the core renderer and minimal template grammar**

Implement core/src/platform/render.ts:

    export function renderMessageView(
      view: Platform.MessageView,
      options: RenderOptions,
    ): ModelMessage

    export function renderEventView(
      view: Platform.EventView,
      options: RenderOptions,
    ): ModelMessage

Use a small interpolation grammar rather than adding a template dependency:

- message tokens: {author}, {content}, {time}, {source};
- event tokens: {actor}, {action}, {target}, {facts}, {time}, {source};
- optional fact lookup: {fact:key};
- unknown tokens are configuration errors;
- values are escaped and length limits are applied after interpolation.

Core controls the AI role, outer speaker/event boundary, media decisions, and
escaping. Templates control body order and wording only.

Add core config under platform.templates with global message/event defaults and
per-event body overrides. Do not add per-channel or per-user overrides.

**Step 5: Replace the current platformMessagePlugin projection**

Refactor core/src/runtime/message.ts so one core-owned runtime plugin handles
athena.platform.message and athena.platform.event:

- Platform.Message is converted through createMessageView and renderMessageView;
- persisted event history contains Platform.EventView rather than custom
  platform payload;
- Platform.EventView is rendered without requiring its source plugin to remain
  installed;
- no platform plugin registers a competing toModelMessages hook for these
  message types.

Keep model projection deterministic. At this stage all media renders as stable
metadata placeholders.

**Step 6: Run the focused presentation tests**

Run:

    rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-view.test.ts
    rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel-message.test.ts
    rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot

Expected: PASS.

**Step 7: Review the stable view milestone**

    rtk git diff --check
    rtk git diff -- core/src/platform core/src/runtime/message.ts core/src/config.ts core/tests

---

## Task 5: Resolve and Freeze Message Resources Before Persistence

**Files:**
- Modify: core/src/platform/types.ts
- Modify: core/src/platform/registry.ts
- Create: core/src/platform/resources.ts
- Create: core/src/platform/assets.ts
- Modify: core/src/platform/view.ts
- Modify: core/src/runtime/key.ts
- Modify: core/src/runtime/message.ts
- Modify: core/src/service.ts
- Modify: core/src/config.ts
- Create: core/tests/platform-resources.test.ts
- Modify: core/tests/message-flow.test.ts
- Modify: core/tests/reset.test.ts

**Step 1: Specify resource references and frozen snapshots**

Add failing tests for:

    Platform.Ref {
      type: string
      id: string
      data?: Platform.JsonObject
    }

    Platform.Snapshot =
      | { ref: Platform.Ref; state: "resolved"; value: Platform.Resource }
      | { ref: Platform.Ref; state: "unavailable"; reason: string }

    Platform.Resource =
      | { type: "messages"; messages: readonly Platform.MessageView[] }
      | { type: "metadata"; data: Platform.JsonObject }
      | { type: "asset"; asset: Platform.Asset }

Message snapshots also record the applied detail level, depth/item/character
limits, truncation state, and resource policy version.

Test that a persisted resolved/unavailable snapshot is never automatically
replaced on a later model build.

Run:

    rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-resources.test.ts

Expected: FAIL because the resource layer does not exist.

**Step 2: Add the one global resource policy**

Add platform.resources to core Config and Config schema with conservative
defaults:

    {
      forward: "inline",
      quote: "inline",
      detail: "summary",
      maxDepth: 2,
      maxItems: 20,
      maxChars: 12000,
      timeoutMs: 5000,
      concurrency: 2,
      maxRequests: 4,
      media: "metadata",
      allowedMime: [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
      ],
      maxFileBytes: 10 * 1024 * 1024,
      maxTotalBytes: 20 * 1024 * 1024,
    }

Allowed values:

- forward/quote: off, inline, resolve;
- detail: reference, summary, full;
- media: metadata, image.

These settings apply only to new messages. No adapter can increase the limits.

Use platform.profiles as the dictionary keyed by bot.sid that Task 1 introduced.
The value is the explicit implementation profile used by registry matching.

**Step 3: Discover references without I/O**

Implement a synchronous discovery pass in core/src/platform/resources.ts:

    export function discoverResources(
      message: Platform.Message,
    ): readonly Platform.Ref[]

It reads the Satori content, quote, and validated extension values. It must not
call readers, bots, the filesystem, or the network.

Use namespaced reference types, for example:

- satori.message;
- satori.forward;
- satori.media;
- onebot.forward;
- onebot.image.

**Step 4: Resolve selected references before agent storage**

Implement:

    export async function prepareMessage(
      message: Platform.Message,
      context: PrepareContext,
    ): Promise<Platform.Message>

prepareMessage:

1. discovers references;
2. filters them through core resource policy;
3. selects a reader from the live registry;
4. applies timeout, request count, concurrency, and cancellation limits;
5. validates reader output;
6. truncates structured messages according to policy;
7. freezes resolved or unavailable snapshots into a new Platform.Message.

Readers may call platform APIs or download content. They return structured data
or bytes, never ModelMessage or final text.

Call prepareMessage in YesImBotService after synchronous Session conversion and
before runtime.append(), runtime.send(), or runtime.run(). Do not place this work
inside toModelMessages.

**Step 5: Implement channel-local content-addressed assets**

Implement core/src/platform/assets.ts:

    export interface AssetStore {
      put(scope: ChannelScope, input: AssetInput): Promise<Platform.Asset>
      read(scope: ChannelScope, ref: Platform.Asset): Promise<Uint8Array>
      clear(scope: ChannelScope): Promise<void>
    }

Store files under:

    <basePath>/assets/<channel-storage-id>/<sha256>

Reuse the sanitized storage ID logic from core/src/runtime/key.ts. Validate MIME
and size before writing. Use SHA-256 over bytes, atomic creation, and immutable
reads. Do not create global cross-channel reference counts.

Keep a bounded in-process cache keyed by channel storage ID plus content hash.
The cache is an optimization only; deleting it cannot change model content.

**Step 6: Integrate assets into deterministic model projection**

When media mode is metadata, render the persisted metadata placeholder.

When media mode is image and a persisted Platform.Asset is allowed:

- read only the immutable local asset by content hash;
- construct the AI SDK image part from those bytes;
- do not contact the original URL or platform;
- fall back to the persisted metadata placeholder if the local file is missing;
- log the missing file as storage corruption without rewriting history.

This is the only allowed read during platform model projection.

**Step 7: Tie asset cleanup to channel reset**

Extend yesimbot.reset so it clears both:

- the channel JSONL storage;
- the channel-local asset directory and in-memory cache entries.

Do not delete global directories or assets for other channel keys.

**Step 8: Run the focused resource and regression tests**

Run:

    rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-resources.test.ts
    rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/message-flow.test.ts
    rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/reset.test.ts
    rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot

Expected: PASS.

**Step 9: Review the resource milestone**

    rtk git diff --check
    rtk git diff -- core/src core/tests

---

## Task 6: Validate the Extension Boundary with OneBot

**Files:**
- Create: plugins/platform-onebot/package.json
- Create: plugins/platform-onebot/tsconfig.json
- Create: plugins/platform-onebot/src/index.ts
- Create: plugins/platform-onebot/src/events.ts
- Create: plugins/platform-onebot/src/readers.ts
- Create: plugins/platform-onebot/tests/plugin.test.ts
- Create: plugins/platform-onebot/tests/events.test.ts
- Create: plugins/platform-onebot/tests/readers.test.ts
- Modify: yarn.lock
- Modify: README.md

**Step 1: Scaffold the independent plugin package**

Use the same package metadata and scripts as plugins/onebot-utils, with:

    {
      "name": "koishi-plugin-yesimbot-platform-onebot",
      "version": "0.0.1",
      "scripts": {
        "build": "npx pkgroll",
        "check-types": "tsc --noEmit",
        "clean": "rimraf dist && rimraf tsconfig.tsbuildinfo",
        "test": "vitest run"
      },
      "peerDependencies": {
        "koishi": "^4.18.10",
        "koishi-plugin-adapter-onebot": "^6.9.4",
        "koishi-plugin-yesimbot": "workspace:^"
      }
    }

Mirror those peer dependencies in devDependencies and add Vitest. Do not add
agent-runtime: this plugin registers platform behavior through core, not an
AgentPlugin.

Run:

    rtk yarn install
    rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-platform-onebot

Expected before source implementation: FAIL because the plugin entrypoint does
not exist.

**Step 2: Write the native reaction event test**

In plugins/platform-onebot/tests/events.test.ts, construct the adapter through a
small exported factory and pass a Session whose adapter has already populated
session.onebot:

    {
      post_type: "notice",
      notice_type: "message_reactions_updated",
      group_id: 20000,
      message_id: 30000,
      user_id: 40000,
      reactions: [
        { emoji_id: "128077", emoji_type: 1, count: 2 }
      ]
    }

Assert that the adapter creates a namespaced event with:

    {
      type: "onebot.message-reactions-updated",
      scope: { type: "channel", channelId: "20000", guildId: "20000" },
      data: {
        messageId: "30000",
        userId: "40000",
        reactions: [
          { id: "128077", type: "1", count: 2 }
        ]
      }
    }

The plugin schema may accept number/string protocol variants, but its normalized
payload uses strings for IDs and numbers for counts. It must not retain the raw
notice.

Run:

    rtk yarn workspace koishi-plugin-yesimbot-platform-onebot exec vitest run tests/events.test.ts

Expected: FAIL because the event definition and adapter do not exist.

**Step 3: Implement the event definition and view**

In plugins/platform-onebot/src/events.ts:

- augment Platform.Events with onebot.message-reactions-updated;
- define a strict normalized payload schema;
- define a separate tolerant raw notice schema for number/string protocol
  variants;
- map the raw notice into the normalized payload synchronously;
- return Platform.EventView with action message-reactions-updated, actor/user
  references where available, a message reference, and reaction facts.

Do not register ctx.on("onebot/message-reactions-updated"). The adapter handles
the Session received through core internal/session collection.

**Step 4: Write forward and image reader tests**

In plugins/platform-onebot/tests/readers.test.ts, use a fake OneBot bot with:

    internal.getForwardMsg = vi.fn().mockResolvedValue([
      {
        sender: { user_id: 1, nickname: "Alice" },
        time: 10,
        content: "hello[CQ:image,file=a.png,url=https://example.test/a.png]"
      }
    ])

    internal.getImage = vi.fn().mockResolvedValue({
      size: 4,
      filename: "a.png",
      url: "https://example.test/a.png"
    })

Stub the Koishi HTTP client to return Uint8Array bytes for the image URL. Assert:

- the forward reader calls getForwardMsg once;
- CQCode.parse converts CQ elements into canonical Satori content;
- the returned forward messages contain normalized entity snapshots and time;
- the image reader returns bytes plus filename/MIME metadata;
- abort, timeout, missing URL, oversized metadata, and protocol errors return
  typed failures without leaking tokens or raw responses.

Run:

    rtk yarn workspace koishi-plugin-yesimbot-platform-onebot exec vitest run tests/readers.test.ts

Expected: FAIL because readers do not exist.

**Step 5: Implement OneBot readers**

In plugins/platform-onebot/src/readers.ts:

- use OneBotBot.internal.getForwardMsg(ref.id);
- normalize each ForwardMessage.content with CQCode.parse(content) and Satori
  serialization;
- use the sender ID/name snapshot and source time supplied by OneBot;
- use OneBotBot.internal.getImage(file) to obtain a temporary URL and metadata;
- fetch bytes through ctx.http with the AbortSignal supplied by core;
- return only the Platform.Reader structured result.

Readers do not enforce global depth, count, byte, MIME, or timeout policy. Core
enforces those values before accepting and persisting reader output.

Do not let a reader construct ModelMessage, write files, mutate Platform.Message,
or cache results.

**Step 6: Register one lifecycle bundle**

Implement plugins/platform-onebot/src/index.ts:

    export const name = "yesimbot-platform-onebot";
    export const inject = ["yesimbot"];

    export function apply(ctx: Context) {
      const dispose = ctx.yesimbot.platform.register(createOneBotAdapter(ctx));
      ctx.on("dispose", dispose);
    }

createOneBotAdapter(ctx) returns one Platform.Adapter with:

- id yesimbot.onebot;
- adapter onebot;
- synchronous adapt(session, base);
- the reaction event definition;
- the forward and image readers.

The generic adapter works when no explicit implementation profile is selected.
Do not add NapCat/Lagrange fingerprint detection.

**Step 7: Run plugin and integration verification**

Run:

    rtk yarn workspace koishi-plugin-yesimbot-platform-onebot exec vitest run
    rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-platform-onebot
    rtk yarn turbo run build --filter=koishi-plugin-yesimbot-platform-onebot
    rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-resources.test.ts tests/platform-session.test.ts

Expected: all commands PASS.

**Step 8: Review the OneBot milestone**

    rtk git diff --check
    rtk git diff -- plugins/platform-onebot yarn.lock README.md

---

## Task 7: Complete Slice 01 Verification and Handoff

**Files:**
- Modify: openspec/changes/design-platform-adapter-system/slices/01-first-implementation/tasks.md
- Create: openspec/changes/design-platform-adapter-system/slices/01-first-implementation/verify.md
- Modify: openspec/changes/design-platform-adapter-system/ROADMAP.md
- Modify: openspec/changes/design-platform-adapter-system/README.md
- Modify: core/README.md
- Modify: plugins/platform-onebot/README.md

**Step 1: Run focused tests from narrow to broad**

Run each command separately and record exit status:

    rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-types.test.ts
    rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-registry.test.ts
    rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-normalize.test.ts
    rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-session.test.ts
    rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-view.test.ts
    rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-resources.test.ts
    rtk yarn workspace koishi-plugin-yesimbot-platform-onebot exec vitest run

Expected: PASS.

**Step 2: Run package-level regression checks**

Run:

    rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
    rtk yarn turbo run test --filter=koishi-plugin-yesimbot
    rtk yarn turbo run build --filter=koishi-plugin-yesimbot
    rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-platform-onebot
    rtk yarn turbo run test --filter=koishi-plugin-yesimbot-platform-onebot
    rtk yarn turbo run build --filter=koishi-plugin-yesimbot-platform-onebot

Expected: PASS.

**Step 3: Run repository checks in CI order**

Run:

    rtk yarn lint
    rtk yarn fmt:check
    rtk yarn check-types
    rtk yarn build
    rtk yarn test

Do not fix unrelated failures. Record whether each failure is caused by Slice 01,
pre-existing source, or environment/dependency state.

**Step 4: Run OpenSpec and patch checks**

Run:

    rtk openspec validate design-platform-adapter-system --strict
    rtk git diff --check
    rtk git status --short

Expected: OpenSpec and diff checks PASS. Status may contain unrelated user work;
verify.md must list it separately rather than reverting it.

**Step 5: Write the slice verification record**

Create verify.md with:

- slice version and date;
- commit(s) or working-tree state tested;
- each command and exit status;
- behavior scenarios proven;
- files or failures outside slice scope;
- remaining risks;
- reviewer conclusion.

Verification claims must cite fresh command output. Never mark a task complete
because its code merely exists.

**Step 6: Update progress documents**

- Check tasks.md items only as their evidence becomes available.
- Set Slice 01 to Verified only after all required focused/package checks pass.
- Update the ROADMAP decision log and Next Action.
- Keep later version slices unchanged.
- Do not create Slice 02 tasks or plan during Slice 01 verification.

**Step 7: Request review and complete the handoff**

Use the requesting-code-review skill against the Slice 01 implementation and
resolve only findings within this change.

Then inspect the final documentation patch:

    rtk git diff --check
    rtk git diff -- openspec/changes/design-platform-adapter-system core/README.md plugins/platform-onebot/README.md

Create a commit only if the user explicitly requests it.

Slice exit gate: the full first-version implementation, OneBot proof cases, all
required tests, verify.md, and ROADMAP status are complete.
