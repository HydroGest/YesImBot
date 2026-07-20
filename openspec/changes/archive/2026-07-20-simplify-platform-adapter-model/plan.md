# Simplify Platform Adapter Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the first Platform Adapter resource/view/template stack with pure-data `Platform.Message` (`elements: Element[]`), image-only preparation via `ImagePrepareSink`, publish-only events, FIFO channel lifecycle, explicit bounded OneBot forward access, and a cohesive platform module layout.

**Architecture:** Core owns versionless fact types, Session→draft conversion, element allowlist normalization, sealing, fixed envelope projection, and channel lifecycle ordering. Adapter is a flat object (`id` / `platform` / `adapter` / `profile` + optional `adapt` + optional `prepare`). `prepare` receives `PrepareContext` with `ImagePrepareSink` and may fully rewrite `elements`. Forwards seal as `<forward id summary/>`. Modules: `types`, `config`, `assets`, `message`, `service`, internal `utils/*` only when shared; no public top-level sanitize/formatter/prepare/projection files.

**Tech Stack:** TypeScript, Koishi/Satori `h` Element APIs (`@satorijs/element` / `koishi`), AI SDK model content parts, Vitest, Yarn 4 workspaces, Koishi Service lifecycle.

## Global Constraints

- Use `yarn` via `rtk`; never npm or pnpm.
- Destructive storage upgrade: do not decode, migrate, or write legacy Platform JSONL shapes.
- No Zod/runtime Platform fact schemas, extension registries, reader registries, resource URI schemes, ContentStore, template configuration, or `BodyPart` algebras.
- `Platform.Message` is pure data with `elements: Element[]` (not a class). Behavior is module functions in `message.ts` / `service.ts`.
- No nested `AdapterIdentity`; identity fields stay flat on `Adapter`.
- `PrepareContext.images` is typed `ImagePrepareSink` (keep the type; do not pass bare put callbacks as the only API).
- `Adapter.prepare?(ctx)` returns `Promise<Element[] | void>`; no `AbortSignal`; FIFO is the sole reset coordination.
- **Persistence encoding (pinned):** runtime domain type is `Platform.Message` with `elements`. JSONL / `athena.platform.message` custom-message **data** stores a serializable snapshot:

  ```ts
  interface PersistedPlatformMessage {
    source: Platform.Source
    scope: Platform.Message["scope"]
    sender: Platform.Sender
    messageId: string
    timestamp?: number
    receivedAt: number
    content: string // sealed element literal from h.stringify
  }
  ```

  `createPlatformMessage` converts domain → persisted (`content = elementsToLiteral(elements)`). Projection rehydrates with `h.parse(content)` (or equivalent) before formatting. Do not store class instances or non-JSON element brands in JSONL.
- **Element state dialect v1 (pinned attrs):**

  | State | Sealed form |
  | --- | --- |
  | Image asset | `<img id="asset_<sha256>" mime="image/jpeg\|png\|webp\|gif"/>` |
  | Image unavailable | `<img unavailable="true"/>` |
  | Audio/video/file omitted | `<audio\|video\|file omitted="true" title="…"/>` (title optional safe name only) |
  | Quote | `<quote id="…"/>` |
  | Forward | `<forward id="…" summary="[合并转发] 使用 onebot_get_forward_message 查看详情"/>` |

  No `data-yesimbot` attribute protocol in this revision.
- **Image budget constants (pinned):**

  ```ts
  export const IMAGE_BUDGET = {
    maxImages: 4,
    maxBytesPerImage: 5 * 1024 * 1024,
    maxTotalBytes: 10 * 1024 * 1024,
    timeoutMs: 10_000,
    concurrency: 2,
    allowedMime: ["image/jpeg", "image/png", "image/webp", "image/gif"] as const,
  } satisfies Platform.ImageBudget
  ```

- **Forward fixed summary string (pinned):** `[合并转发] 使用 onebot_get_forward_message 查看详情`
- Public `core/src/platform/index.ts` exports only: `PlatformService`, types from `types.ts`, config symbols, and `AssetStore` **only if** required for typing tests—prefer not exporting transform helpers.
- Inline single-caller helpers; multi-caller helpers go under `core/src/platform/utils/` and are **not** re-exported from `index.ts`.
- Do not overwrite unrelated working-tree changes under `openspec/changes/design-platform-adapter-system/`, untracked `core/src/runtime/index.ts`, or generated `.pi-subagents/`.
- **Worktree reconcile (pinned):** these files may already be partially edited toward simplify — treat them as the start point, finish toward this plan, do not `git checkout` them to discard user intent: `core/src/platform/types.ts`, `core/src/platform/config.ts`, `core/src/platform/index.ts`, `core/src/runtime/message.ts`, related tests. Intermediate commits **may** leave core typecheck red until Task 4/5 delete the old stack; each task must still pass its **focused** tests.
- `Adapter.adapt` return type stays `Message | Event | void` where `void` means keep base (no separate public `RefineResult` type required).
- Run focused tests before each commit. Use package-scoped typecheck/build after cross-package changes.

## Target module map

```text
core/src/platform/
  types.ts       # Platform.* contracts, IMAGE_BUDGET type, PrepareContext
  config.ts      # profiles only
  assets.ts      # AssetStore (private ids; put returns { assetId, mime, ... })
  message.ts     # draftFromSession pieces, normalizeElements, sealMessage,
                 # elementsToLiteral, messageFromPersisted, header helpers used by service
  service.ts     # collect, match, register, publish, prepareMessage dispatch,
                 # ImagePrepareSink wrapper, createMessagePlugin
  utils/
    elements.ts  # shared transform only if message.ts AND onebot-utils/service both need it
  index.ts       # thin exports

DELETE after call sites gone:
  view.ts, render.ts, resources.ts, schema.ts
  (never add public sanitize.ts / formatter.ts / prepare.ts / projection.ts)
```

---

## Task 1: Replace Platform Fact Contracts

**Covers:** tasks.md 1.1 (type/config surface).

**Files:**
- Modify: `core/src/platform/types.ts`
- Modify: `core/src/platform/config.ts`
- Modify: `core/src/platform/index.ts`
- Modify: `core/src/runtime/message.ts`
- Modify: `core/tests/platform-types.test.ts`
- Modify: `core/tests/channel-message.test.ts` (only if it imports removed shapes)

**Consumes:** none (start of chain). Existing half-edited types/config/message factory.

**Produces:**
- `Platform.Message` with `elements: Element[]`
- `Platform.Event`, `Platform.Adapter` with `prepare?(ctx): Promise<Element[] | void>`
- `Platform.ImagePrepareSink`, `Platform.ImageBudget`, `Platform.PrepareContext`
- `PlatformConfig = { profiles: Record<string, string> }`
- `createPlatformMessage(message: Platform.Message)` → custom message whose **data** is `PersistedPlatformMessage` (`content` literal)
- `elementsToLiteral` / persistence helpers may live in Task 3; for Task 1, `createPlatformMessage` may temporarily stringify with a minimal helper inline:

```ts
function elementsToLiteral(elements: Element[]): string {
  return elements.map((el) => el.toString()).join("")
}
```

**Interfaces (authoritative for later tasks):**

```ts
import type { Element } from "@satorijs/element"
import type { Session } from "koishi"

export interface PlatformEventVariants {}

export namespace Platform {
  export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
  export type JsonObject = { [key: string]: Json }

  export interface Source { platform: string; selfId: string }
  export interface Diagnostic {
    code: string
    message: string
    adapterId?: string
    eventType?: string
    nativeType?: string
    cause?: string
  }
  export type Scope =
    | { type: "channel"; channelId: string; guildId?: string; threadId?: string }
    | { type: "guild"; guildId: string }
    | { type: "account" }

  export interface Sender { id: string; name?: string }

  export interface Message {
    source: Source
    scope: Extract<Scope, { type: "channel" }>
    sender: Sender
    messageId: string
    timestamp?: number
    receivedAt: number
    elements: Element[]
  }

  export interface Event<K extends keyof PlatformEventVariants = keyof PlatformEventVariants> {
    source: Source
    scope: Scope
    type: K
    timestamp?: number
    receivedAt: number
    data: PlatformEventVariants[K]
    content: string
  }

  export interface ImagePrepareSink {
    put(
      bytes: Uint8Array,
      mimeHint?: string,
    ): Promise<{ assetId: string; mime: string }>
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
    session: Session
    message: Readonly<Message>
    images: ImagePrepareSink
    budget: ImageBudget
  }

  export interface Adapter {
    id: string
    platform?: string
    adapter?: string
    profile?: string
    accepts?(session: Session): boolean
    adapt?(session: Session, fact?: Message | Event): Message | Event | void
    prepare?(ctx: PrepareContext): Promise<Element[] | void>
  }
}

export interface PersistedPlatformMessage {
  source: Platform.Source
  scope: Platform.Message["scope"]
  sender: Platform.Sender
  messageId: string
  timestamp?: number
  receivedAt: number
  content: string
}
```

- [ ] **Step 1: Write failing contract tests**

In `core/tests/platform-types.test.ts`, replace legacy assertions with:

```ts
import { h } from "koishi"
import type { Platform } from "../src/platform/types.js"

it("defines a versionless channel-scoped message with sender and elements", () => {
  const message: Platform.Message = {
    source: { platform: "test", selfId: "bot" },
    scope: { type: "channel", channelId: "room" },
    sender: { id: "user", name: "Alice" },
    messageId: "m-1",
    receivedAt: 1,
    elements: [h.text("hello")],
  }
  expect(message.sender).toEqual({ id: "user", name: "Alice" })
  expect(message.elements[0]?.type).toBe("text")
  expect(message).not.toHaveProperty("version")
  expect(message).not.toHaveProperty("resources")
  expect(message).not.toHaveProperty("extensions")
  expect(message).not.toHaveProperty("author")
  expect(message).not.toHaveProperty("content")
})

it("types Adapter.prepare to return elements via PrepareContext.images sink", () => {
  const adapter: Platform.Adapter = {
    id: "t",
    async prepare(ctx) {
      const sink: Platform.ImagePrepareSink = ctx.images
      expect(typeof sink.put).toBe("function")
      return ctx.message.elements
    },
  }
  expect(adapter.id).toBe("t")
})
```

- [ ] **Step 2: Run tests — expect FAIL or type errors against incomplete stack**

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-types.test.ts
```

Expected: fail on missing `elements` / still having `content` string domain field / old adapter `prepareMessage` shape — until Step 3 lands types.

- [ ] **Step 3: Implement types + config + createPlatformMessage**

`config.ts`:

```ts
export interface PlatformConfig {
  profiles: Record<string, string>
}
export const DEFAULT_PLATFORM: PlatformConfig = { profiles: {} }
export const PlatformConfigSchema = Schema.object({
  profiles: Schema.dict(Schema.string()).default({}),
}).default(DEFAULT_PLATFORM)
```

`runtime/message.ts` factory:

```ts
export function createPlatformMessage(message: Platform.Message) {
  const content = message.elements.map((el) => el.toString()).join("")
  const data: PersistedPlatformMessage = {
    source: message.source,
    scope: message.scope,
    sender: message.sender,
    messageId: message.messageId,
    receivedAt: message.receivedAt,
    content,
    ...(message.timestamp !== undefined ? { timestamp: message.timestamp } : {}),
  }
  return createCustomMessage("athena.platform.message", data, {
    id: message.messageId,
    timestamp: message.timestamp ?? message.receivedAt,
  })
}
```

Update `AgentCustomMessages` binding so `athena.platform.message` data is `PersistedPlatformMessage` (not domain `Platform.Message` with live Elements).

- [ ] **Step 4: Run focused tests**

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-types.test.ts tests/channel-message.test.ts
```

Expected: these two files pass (or channel-message only fails on unrelated imports — fix imports only, no feature creep).

- [ ] **Step 5: Commit**

```bash
git add core/src/platform/types.ts core/src/platform/config.ts core/src/platform/index.ts core/src/runtime/message.ts core/tests/platform-types.test.ts core/tests/channel-message.test.ts
git commit -m "refactor(core): pure-data platform message with elements"
```

---

## Task 2: Draft Normalization, Refiner, Publish-Only Events

**Covers:** tasks.md 1.2.

**Files:**
- Create: `core/src/platform/message.ts` (domain helpers used from normalize/service)
- Modify: `core/src/platform/normalize.ts` (shrink: remove Zod fact parse / eventDefinitions / extension schema paths; produce `elements`)
- Modify: `core/src/platform/service.ts` (register/match/publish/collect)
- Modify: `core/tests/platform-normalize.test.ts`
- Modify: `core/tests/platform-session.test.ts`
- Modify: `core/tests/platform-service-helper.ts`
- Delete when unreferenced: `core/src/platform/schema.ts`

**Consumes:** Task 1 `Platform.Message` / `Event` / `Adapter.adapt` / `PersistedPlatformMessage`.

**Produces:**
- `normalizeSession(session, opts) → { kind: "message", value: Platform.Message } | { kind: "event", value: Platform.Event } | { kind: "ignore" | "invalid" | ... }` simplified to message | event | none
- `PlatformService.publish(draft: Omit<Platform.Event, "receivedAt">): Platform.Event`
- Single `receivedAt` from collect path for session-derived facts
- No `getReader` / `getEventDefinition` / `getExtensionSchema` on service

**Key signatures:**

```ts
// message.ts
export function draftMessageFromSession(
  session: Session,
  receivedAt: number,
): Platform.Message | undefined

// service.ts
publish<K extends keyof PlatformEventVariants>(
  event: Omit<Platform.Event<K>, "receivedAt">,
): Platform.Event<K>
```

- [ ] **Step 1: Rewrite normalize tests (failing)**

Replace schema/EventView cases. Minimal cases:

```ts
it("creates a message with sender and elements from a Satori message Session", () => {
  const result = normalizeSession(session, { receivedAt: 1000, registry })
  expect(result.kind).toBe("message")
  if (result.kind !== "message") return
  expect(result.value.receivedAt).toBe(1000)
  expect(result.value.sender.id).toBeDefined()
  expect(Array.isArray(result.value.elements)).toBe(true)
  expect(result.value).not.toHaveProperty("extensions")
  expect(result.value).not.toHaveProperty("resources")
})

it("preserves base message when adapt returns void", () => {
  const adapter: Platform.Adapter = {
    id: "a",
    platform: "test",
    adapt: () => undefined,
  }
  // register adapter; normalize; expect base content retained
})

it("allows adapt to produce an event when base is absent", () => {
  const adapter: Platform.Adapter = {
    id: "a",
    adapt: (session) => ({
      source: { platform: session.platform, selfId: session.selfId },
      scope: { type: "channel", channelId: session.channelId! },
      type: "onebot.message-reactions-updated" as never,
      receivedAt: 0, // core must overwrite/stamp — see collect/publish rules
      data: {} as never,
      content: "reactions updated",
    }),
  }
  // assert event published/normalized with registry receivedAt, not 0 from adapter if collect stamps
})

it("does not try a second adapter when the first adapt throws", () => {
  // expect diagnostic + no second adapt call
})
```

- [ ] **Step 2: Run normalize tests — expect FAIL**

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-normalize.test.ts tests/platform-session.test.ts
```

- [ ] **Step 3: Implement draft + shrink normalize**

In `message.ts` / `normalize.ts`:

```ts
export function draftMessageFromSession(
  session: Session,
  receivedAt: number,
): Platform.Message | undefined {
  if (!session.channelId) return undefined
  // only for message-like sessions; mirror existing is-message detection without Zod packages
  const elements = h.normalize(session.elements ?? session.content ?? "")
  return {
    source: { platform: session.platform, selfId: session.selfId },
    scope: {
      type: "channel",
      channelId: session.channelId,
      ...(session.guildId ? { guildId: session.guildId } : {}),
    },
    sender: {
      id: session.userId ?? session.author?.id ?? "",
      ...(session.author?.name || session.username
        ? { name: session.author?.name ?? session.username }
        : {}),
    },
    messageId: String(session.messageId ?? ""),
    receivedAt,
    elements,
    ...(session.timestamp ? { timestamp: +session.timestamp } : {}),
  }
}
```

`applyAdapter`:

```ts
const adapted = adapter?.adapt?.(session, base)
if (adapted === undefined) return base
// if adapted is Message, force receivedAt from base/collection
// if Event, force receivedAt from collection
return adapted
```

- [ ] **Step 4: Implement publish-only service API**

```ts
publish(input: object): Platform.Event {
  const receivedAt = this.#now()
  // accept only event drafts: must have type, source, scope, data, content; reject message-shaped input by TypeScript public type
  const event = { ...(input as object), receivedAt } as Platform.Event
  this.#notify(event)
  return event
}

#publishCollected(fact: Platform.Message | Platform.Event): void {
  // messages: store on session map only (or notify message listeners if any) WITHOUT re-stamping receivedAt
  // events: notify listeners with fact.receivedAt unchanged
}
```

Remove reader/eventDefinition/extension registration from `register()`.

- [ ] **Step 5: Run tests + commit**

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-normalize.test.ts tests/platform-session.test.ts
rtk rg "parsePlatformFact|EventDefinition|getExtensionSchema|getReader" core/src/platform
```

Expected: no production references to deleted registry APIs (tests may still fail elsewhere).

```bash
git add core/src/platform/message.ts core/src/platform/normalize.ts core/src/platform/service.ts core/tests/platform-normalize.test.ts core/tests/platform-session.test.ts core/tests/platform-service-helper.ts core/src/platform/schema.ts
git commit -m "refactor(core): draft elements and publish-only events"
```

---

## Task 3: Element Allowlist Normalization + Core Projection

**Covers:** tasks.md 2.1 and 2.2.

**Files:**
- Modify: `core/src/platform/message.ts`
- Create only if Task 7 or service also imports the same pure transform: `core/src/platform/utils/elements.ts` (otherwise keep transforms private in `message.ts`)
- Modify: `core/src/platform/service.ts` (`createMessagePlugin` only projects `athena.platform.message`)
- Modify: `packages/agent-runtime/src/types/plugin.ts` (add `requiresMessageId?: boolean`)
- Modify: `plugins/onebot-utils/src/index.ts` (set `requiresMessageId: true` on the agent plugin)
- Modify: `core/src/runtime/service.ts` (`createRuntimePlugins` derives `includeMessageId`)
- Create: `core/tests/platform-elements.test.ts` (rename/replace `platform-view.test.ts` content; delete old file after)
- Create: `core/tests/platform-projection.test.ts` (replace `render.test.ts` responsibilities; delete old when green)
- Delete when unreferenced: `core/src/platform/view.ts`, `core/src/platform/render.ts`

**Consumes:** Task 1–2 domain message, `PersistedPlatformMessage`, draft elements, thin service.

**Produces (exact names later tasks import):**

```ts
// message.ts
export const FORWARD_SUMMARY =
  "[合并转发] 使用 onebot_get_forward_message 查看详情"

export function normalizeElements(elements: readonly Element[]): Element[]
export function sealMessage(message: Platform.Message): Platform.Message
export function elementsToLiteral(elements: readonly Element[]): string
export function literalToElements(content: string): Element[]
export function messageFromPersisted(data: PersistedPlatformMessage): Platform.Message
export function formatMessageHeader(
  message: Pick<Platform.Message, "sender" | "messageId" | "timestamp" | "receivedAt">,
  options: { includeMessageId: boolean },
): string
export async function projectPlatformMessage(
  data: PersistedPlatformMessage,
  options: {
    scope: ChannelScope
    assetStore: AssetStore
    includeMessageId: boolean
    onAssetMissing?: (assetId: string, cause: unknown) => void
  },
): Promise<UserModelMessage>
```

**Pinned transform table:**

| Input pattern | Output |
| --- | --- |
| text / br / p / at / face / emoji | keep allowlisted attrs only |
| `img` with remote `src` before prepare | leave for prepare; after seal without asset → `<img unavailable="true"/>` |
| `img` after successful prepare | `<img id="asset_…" mime="…"/>` |
| audio / video / file | keep type + optional `title`; set `omitted="true"`; strip urls |
| `quote` | `<quote id="…"/>` children dropped |
| `message` with `forward` / forward-like | single `<forward id="…" summary={FORWARD_SUMMARY}/>` |
| unknown / component | unwrap children only |

- [ ] **Step 1: Write failing element + projection tests**

`core/tests/platform-elements.test.ts`:

```ts
import { h } from "koishi"
import { FORWARD_SUMMARY, normalizeElements, elementsToLiteral } from "../src/platform/message.js"

it("unwraps unknown wrappers and keeps at", () => {
  const input = h.parse('<x token="secret">hi <at id="42"/></x>')
  const out = normalizeElements(input)
  expect(elementsToLiteral(out)).toBe('hi <at id="42"/>')
})

it("collapses forward message trees to shallow forward", () => {
  const input = h.parse('<message id="f1" forward><message id="c"/></message>')
  const out = normalizeElements(input)
  const lit = elementsToLiteral(out)
  expect(lit).toContain('<forward')
  expect(lit).toContain('id="f1"')
  expect(lit).toContain(FORWARD_SUMMARY)
  expect(lit).not.toContain("<message")
})

it("keeps quote id only", () => {
  const out = normalizeElements(h.parse('<quote id="q1">body</quote>'))
  expect(elementsToLiteral(out)).toBe('<quote id="q1"/>')
})

it("marks non-image media omitted without urls", () => {
  const out = normalizeElements(h.parse('<audio src="https://x" title="v"/>'))
  const lit = elementsToLiteral(out)
  expect(lit).toContain('omitted="true"')
  expect(lit).not.toContain("https://")
})
```

`core/tests/platform-projection.test.ts`:

```ts
it("formats fixed header with JSON-escaped values", async () => {
  const data = {
    source: { platform: "t", selfId: "b" },
    scope: { type: "channel" as const, channelId: "c" },
    sender: { id: "u1", name: 'A"B' },
    messageId: "m1",
    receivedAt: Date.parse("2026-07-18T12:34:00+08:00"),
    content: "hello",
  }
  const text = formatMessageHeader(
    { ...data, timestamp: data.receivedAt },
    { includeMessageId: true },
  )
  expect(text).toBe(
    `[time=${JSON.stringify("2026/7/18 12:34")} id=${JSON.stringify("m1")} sender=${JSON.stringify('A"B (u1)')}]`,
  )
})

it("projects local asset images without network", async () => {
  // put bytes in AssetStore under asset id; persisted content has <img id="asset_…" mime="image/png"/>
  // projectPlatformMessage returns multimodal content with image part
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-elements.test.ts tests/platform-projection.test.ts
```

Expected: cannot resolve `normalizeElements` / `FORWARD_SUMMARY` / projection helpers.

- [ ] **Step 3: Implement normalizeElements + seal + literal codec in message.ts**

```ts
import { h, type Element } from "koishi"

export const FORWARD_SUMMARY =
  "[合并转发] 使用 onebot_get_forward_message 查看详情"

export function elementsToLiteral(elements: readonly Element[]): string {
  return elements.map((el) => el.toString()).join("")
}

export function literalToElements(content: string): Element[] {
  return h.normalize(content)
}

export function normalizeElements(elements: readonly Element[]): Element[] {
  return h.transform(elements as Element[], ({ type, attrs, children }) => {
    if (type === "text" || type === "br" || type === "p") return true
    if (type === "at") return h("at", { id: attrs.id, ...(attrs.name ? { name: attrs.name } : {}) })
    if (type === "face" || type === "emoji") {
      return h(type, { ...(attrs.id ? { id: attrs.id } : {}), ...(attrs.name ? { name: attrs.name } : {}) })
    }
    if (type === "img" || type === "image") {
      if (attrs.id && String(attrs.id).startsWith("asset_") && attrs.mime) {
        return h("img", { id: attrs.id, mime: attrs.mime })
      }
      if (attrs.unavailable === true || attrs.unavailable === "true") {
        return h("img", { unavailable: "true" })
      }
      // remote src retained only on draft; sealMessage rewrites leftovers
      if (attrs.src) return h("img", { src: String(attrs.src) })
      return h("img", { unavailable: "true" })
    }
    if (type === "audio" || type === "video" || type === "file") {
      return h(type, {
        omitted: "true",
        ...(attrs.title || attrs.name ? { title: String(attrs.title ?? attrs.name) } : {}),
      })
    }
    if (type === "quote") return h("quote", { id: String(attrs.id ?? "") })
    if (type === "forward") {
      return h("forward", {
        id: String(attrs.id ?? ""),
        summary: String(attrs.summary ?? FORWARD_SUMMARY),
      })
    }
    if (type === "message" && (attrs.forward === true || attrs.forward === "" || attrs.forward === "true")) {
      return h("forward", {
        id: String(attrs.id ?? ""),
        summary: FORWARD_SUMMARY,
      })
    }
    // unwrap unknown / components: return children fragment
    return children
  }) as Element[]
}

export function sealMessage(message: Platform.Message): Platform.Message {
  const elements = normalizeElements(message.elements).map((el) => {
    if ((el.type === "img" || el.type === "image") && el.attrs.src) {
      return h("img", { unavailable: "true" })
    }
    return el
  })
  return { ...message, elements: normalizeElements(elements) }
}

export function messageFromPersisted(data: PersistedPlatformMessage): Platform.Message {
  return {
    source: data.source,
    scope: data.scope,
    sender: data.sender,
    messageId: data.messageId,
    receivedAt: data.receivedAt,
    elements: literalToElements(data.content),
    ...(data.timestamp !== undefined ? { timestamp: data.timestamp } : {}),
  }
}
```

Use the real `h.transform` callback shape from `@satorijs/element` if the object form above does not match the installed API — prefer `h.transform(elements, { img(attrs, children) { ... }, default(attrs, children, type) { return children } })` per Koishi docs when implementing. The **output element shapes** above are normative; the transform API wiring must match the installed `h` version.

- [ ] **Step 4: Implement header + projectPlatformMessage (in message.ts) and wire createMessagePlugin**

```ts
export function formatMessageHeader(
  message: Pick<Platform.Message, "sender" | "messageId" | "timestamp" | "receivedAt">,
  options: { includeMessageId: boolean },
): string {
  const instant = message.timestamp ?? message.receivedAt
  const time = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(instant))
  // normalize slash style to match product examples if needed
  const sender = message.sender.name
    ? `${message.sender.name} (${message.sender.id})`
    : message.sender.id
  const fields = [
    `time=${JSON.stringify(time)}`,
    ...(options.includeMessageId ? [`id=${JSON.stringify(message.messageId)}`] : []),
    `sender=${JSON.stringify(sender)}`,
  ]
  return `[${fields.join(" ")}]`
}

export async function projectPlatformMessage(data, options): Promise<UserModelMessage> {
  const message = messageFromPersisted(data)
  const header = formatMessageHeader(message, { includeMessageId: options.includeMessageId })
  const body = elementsToLiteral(message.elements)
  const text = `${header}\n${body}`
  const images = []
  for (const el of h.select(message.elements, "img")) {
    const id = el.attrs.id
    const mime = el.attrs.mime
    if (!id || !String(id).startsWith("asset_") || !mime) continue
    try {
      const bytes = await options.assetStore.readByAssetId(options.scope, String(id))
      images.push({ type: "image" as const, image: bytes, mediaType: String(mime) })
    } catch (cause) {
      options.onAssetMissing?.(String(id), cause)
    }
  }
  if (!images.length) return { role: "user", content: text }
  return {
    role: "user",
    content: [{ type: "text", text }, ...images],
  }
}
```

If `AssetStore` still only has `read(scope, { hash, size, mime })`, Task 3 may add `readByAssetId(scope, assetId)` that strips `asset_` prefix and reads by hash — implement the smallest adapter; full AssetStore reshape is Task 4.

`createMessagePlugin`:

```ts
createMessagePlugin(deps: {
  scope: ChannelScope
  includeMessageId: boolean
  assetStore?: AssetStore
  diagnostic?: ...
}): AgentPlugin {
  return {
    name: "core.platform-message",
    async toModelMessages(message) {
      if (message.role !== "custom" || message.type !== "athena.platform.message") return
      return projectPlatformMessage(message.data as PersistedPlatformMessage, {
        scope: deps.scope,
        assetStore: deps.assetStore ?? this.#assetStore,
        includeMessageId: deps.includeMessageId,
        onAssetMissing: ...
      })
    },
  }
}
```

In `packages/agent-runtime/src/types/plugin.ts`:

```ts
export interface AgentPlugin {
  // existing fields...
  requiresMessageId?: boolean
}
```

In `YesImBotService` plugin construction:

```ts
const external = /* build channel plugins first */
const includeMessageId = external.some((p) => p.requiresMessageId === true)
const platformPlugin = this.platformService.createMessagePlugin({
  scope,
  includeMessageId,
})
```

OneBot utils plugin object:

```ts
return {
  name: "yesimbot.onebot-utils",
  requiresMessageId: true,
  tools: ...
}
```

- [ ] **Step 5: Run focused tests**

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-elements.test.ts tests/platform-projection.test.ts tests/channel-message.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot --filter=@yesimbot/agent-runtime --filter=koishi-plugin-yesimbot-onebot-utils
```

Expected: element/projection tests pass. Broader core typecheck may still fail on resources/view until Task 4–5.

- [ ] **Step 6: Commit**

```bash
git add core/src/platform/message.ts core/src/platform/service.ts core/src/platform/utils core/src/runtime/service.ts packages/agent-runtime/src/types/plugin.ts plugins/onebot-utils/src/index.ts core/tests/platform-elements.test.ts core/tests/platform-projection.test.ts core/tests/platform-view.test.ts core/tests/render.test.ts core/src/platform/view.ts core/src/platform/render.ts
git commit -m "feat(core): normalize elements and project platform messages"
```

---

## Task 4: Image Preparation via ImagePrepareSink

**Covers:** tasks.md 3.1.

**Files:**
- Modify: `core/src/platform/assets.ts` (private asset ids; `put` → `{ assetId, mime }`; `readByAssetId`)
- Modify: `core/src/platform/service.ts` (`prepareMessage` dispatch + sink wrapper + default fallback)
- Modify: `core/src/runtime/service.ts` (call new prepare; stop passing raw bot into resource engine if signature changes)
- Create: `core/tests/platform-prepare.test.ts` (replace `platform-resources.test.ts`)
- Delete: `core/src/platform/resources.ts` after imports gone
- Delete: `core/tests/platform-resources.test.ts` after rewrite

**Consumes:** Task 3 `normalizeElements`, `sealMessage`, `elementsToLiteral`, `Platform.PrepareContext`, `IMAGE_BUDGET` constants from Global Constraints.

**Produces:**

```ts
// assets.ts
export class AssetStore {
  constructor(options: {
    basePath: string
    allowedMime: readonly string[]
    maxFileBytes: number
  })
  /** Returns implementation-private id like asset_<sha256> and verified mime */
  put(
    scope: ChannelScope,
    input: { data: Uint8Array; mimeHint?: string },
  ): Promise<{ assetId: string; mime: string }>
  readByAssetId(scope: ChannelScope, assetId: string): Promise<Uint8Array>
  clear(scope: ChannelScope): Promise<void>
}

// service.ts
prepareMessage(
  session: Session,
  message: Platform.Message,
): Promise<Platform.Message> // sealed domain message; caller persists via createPlatformMessage

// Fixed budget export (message.ts or assets.ts or service private const — one place)
export const IMAGE_BUDGET = {
  maxImages: 4,
  maxBytesPerImage: 5 * 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
  timeoutMs: 10_000,
  concurrency: 2,
  allowedMime: ["image/jpeg", "image/png", "image/webp", "image/gif"] as const,
}
```

**MIME detection (pinned for AssetStore.put):** sniff magic bytes; do not trust URL extensions. Reject SVG and unknown.

```ts
function detectImageMime(data: Uint8Array): string | undefined {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg"
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png"
  if (data.length >= 6 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return "image/gif"
  if (
    data.length >= 12 &&
    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
    data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
  ) return "image/webp"
  return undefined
}
```

- [ ] **Step 1: Write failing prepare tests**

`core/tests/platform-prepare.test.ts`:

```ts
import { h } from "koishi"
import { PlatformService } from "../src/platform/service.js"
// use existing platform-service-helper patterns

it("does not prepare ignored self messages at the runtime boundary", async () => {
  // assert adapter.prepare is not called when route is ignore — may live in message-flow;
  // here assert PlatformService.prepareMessage is only invoked by runtime for admitted routes
})

it("gives prepare a readonly message and ImagePrepareSink", async () => {
  let seen: Platform.PrepareContext | undefined
  const adapter: Platform.Adapter = {
    id: "t",
    platform: "test",
    async prepare(ctx) {
      seen = ctx
      expect(Object.isFrozen(ctx.message) || true).toBeTruthy()
      const { assetId, mime } = await ctx.images.put(PNG_1x1, "image/png")
      expect(assetId.startsWith("asset_")).toBe(true)
      expect(mime).toBe("image/png")
      return [h("img", { id: assetId, mime }), h.text("hi")]
    },
  }
  // register adapter; call service.prepareMessage(session, draft)
  // expect result.elements sealed without src; meta unchanged
})

it("ignores adapter attempts to change metadata by only applying elements", async () => {
  const draft = { /* fixed meta */ elements: [h.text("a")] }
  const adapter: Platform.Adapter = {
    id: "t",
    async prepare(ctx) {
      // mutate a shallow copy of message fields if returned whole — API returns Element[] only
      return [h.text("b")]
    },
  }
  const prepared = await service.prepareMessage(session, draft)
  expect(prepared.messageId).toBe(draft.messageId)
  expect(prepared.receivedAt).toBe(draft.receivedAt)
  expect(elementsToLiteral(prepared.elements)).toContain("b")
})

it("without prepare, external images become unavailable and urls are dropped", async () => {
  const draft = {
    /* meta */
    elements: h.parse('hi <img src="https://evil/x.png"/>'),
  }
  const prepared = await service.prepareMessage(session, draft) // no adapter prepare
  const lit = elementsToLiteral(prepared.elements)
  expect(lit).toContain("hi")
  expect(lit).toContain('unavailable="true"')
  expect(lit).not.toContain("https://")
})

it("clears channel assets on clearChannel", async () => {
  // put via sink path; clearChannel; readByAssetId throws
})
```

- [ ] **Step 2: Run prepare tests — expect FAIL**

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-prepare.test.ts
```

Expected: old `prepareMessage(message, bot)` / resources API cannot satisfy sink + elements contract.

- [ ] **Step 3: Reshape AssetStore**

Replace public `Platform.Asset` return with private ids:

```ts
async put(
  scope: ChannelScope,
  input: { data: Uint8Array; mimeHint?: string },
): Promise<{ assetId: string; mime: string }> {
  const mime = detectImageMime(input.data) ?? input.mimeHint
  if (!mime || !this.#allowedMime.has(mime)) throw new Error("unsupported image mime")
  if (input.data.byteLength > this.#maxFileBytes) throw new Error("image too large")
  const hash = createHash("sha256").update(input.data).digest("hex")
  // write file as today under hash path
  return { assetId: `asset_${hash}`, mime }
}

async readByAssetId(scope: ChannelScope, assetId: string): Promise<Uint8Array> {
  const hash = assetId.startsWith("asset_") ? assetId.slice("asset_".length) : ""
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("invalid asset id")
  // read file; integrity checks as today
}
```

Construct store with `IMAGE_BUDGET.allowedMime` and `maxBytesPerImage`.

- [ ] **Step 4: Implement service.prepareMessage**

```ts
async prepareMessage(session: Session, message: Platform.Message): Promise<Platform.Message> {
  const adapter = this.match({
    platform: session.platform,
    adapter: session.bot?.adapter?.name ?? session.bot?.adapter,
    profile: this.#platformConfig.profiles?.[session.bot?.sid ?? ""],
    session,
  })
  const scope = channelScopeFromMessage(message)
  const images: Platform.ImagePrepareSink = {
    put: (bytes, mimeHint) => this.#assetStore.put(scope, { data: bytes, mimeHint }),
  }
  const ctx: Platform.PrepareContext = {
    session,
    message: message, // treat as readonly by convention; Object.freeze shallow if easy
    images,
    budget: IMAGE_BUDGET,
  }
  let elements = message.elements
  if (adapter?.prepare) {
    try {
      const replaced = await adapter.prepare(ctx)
      if (replaced) elements = replaced
    } catch (error) {
      this.#reportDiagnostic({
        code: "platform.prepare_failed",
        message: "Platform adapter prepare failed",
        adapterId: adapter.id,
        cause: errorMessage(error),
      })
      // fall through with original elements → seal will unavailable remote imgs
    }
  }
  return sealMessage({ ...message, elements })
}
```

Default path without adapter prepare: `sealMessage` already rewrites residual `src` to unavailable.

Update `runtime/service.ts`:

```ts
const prepared = await this.platformService.prepareMessage(session, message)
const runtimeMessage = createPlatformMessage(prepared)
```

Remove `prepareMessage(message, session.bot)` bot-second-arg resource API.

- [ ] **Step 5: Delete resources engine and old tests**

```bash
rtk rg "resources\.js|prepareResources|discoverResources|Platform\.Reader|Platform\.Snapshot" core/src core/tests
```

Remove matches; delete `resources.ts` and `platform-resources.test.ts`.

- [ ] **Step 6: Run focused tests + commit**

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-prepare.test.ts tests/platform-elements.test.ts tests/platform-projection.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

```bash
git add core/src/platform/assets.ts core/src/platform/service.ts core/src/runtime/service.ts core/tests/platform-prepare.test.ts core/src/platform/resources.ts core/tests/platform-resources.test.ts core/src/platform/message.ts core/src/platform/types.ts
git commit -m "refactor(core): prepare images via ImagePrepareSink"
```

---

## Task 5: FIFO Channel Lifecycle + Dead Module Purge

**Covers:** tasks.md 4.1 and 4.2.

**Files:**
- Modify: `core/src/runtime/service.ts` (enqueueChannel for handleSession + reset)
- Modify: `core/tests/reset.test.ts`
- Modify: `core/tests/message-flow.test.ts`
- Modify: `core/tests/error-handling.test.ts` if broken by prepare signature
- Modify: `core/src/platform/index.ts` (thin exports)
- Delete remaining: `core/src/platform/view.ts`, `core/src/platform/render.ts` if still present; any leftover resource/presentation tests

**Consumes:** Task 4 `prepareMessage(session, message)`, `createPlatformMessage`, sealed domain messages.

**Produces:**

```ts
// YesImBotService private
private readonly lifecycleTails = new Map<string, Promise<unknown>>()

private enqueueChannel<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const prev = this.lifecycleTails.get(key) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(operation)
  const tail = next.then(() => {}, () => {})
  this.lifecycleTails.set(key, tail)
  void tail.finally(() => {
    if (this.lifecycleTails.get(key) === tail) this.lifecycleTails.delete(key)
  })
  return next
}
```

**Ordering rules (normative):**
1. For each admitted message: `route decision → prepareMessage → getChannelAgent → append|send|run()` **submission** runs inside `enqueueChannel`.
2. For `run`: only the call that **starts** `runtime.run(msg)` is inside the lock; `for await` stream consumption and outbound send run **outside** the lock.
3. `reset` for a channel key is `enqueueChannel`'d: after prior ops, `interrupt` → `stop` → `storage.clear` + `platformService.clearChannel` → delete runtime cache.
4. Messages enqueued after reset wait behind reset.
5. Busy-join (`route.action === "send"`) uses the **same** FIFO queue.

- [ ] **Step 1: Write failing FIFO tests**

In `core/tests/reset.test.ts` (and/or `message-flow.test.ts`), use a deferred prepare:

```ts
it("orders prepare A, reset, prepare B on one channel", async () => {
  let releaseA!: () => void
  const gateA = new Promise<void>((r) => { releaseA = r })
  let phase = ""
  const adapter: Platform.Adapter = {
    id: "t",
    platform: "test",
    async prepare(ctx) {
      if (ctx.message.messageId === "A") {
        phase = "prepare-A-start"
        await gateA
        phase = "prepare-A-done"
      } else if (ctx.message.messageId === "B") {
        phase = "prepare-B"
      }
      return ctx.message.elements
    },
  }
  // 1) start handleSession for message A (do not await completion fully if needed)
  // 2) invoke reset for same channel (promise pending)
  // 3) start handleSession for message B
  // 4) assert B has not prepared yet (phase !== prepare-B)
  // 5) releaseA()
  // 6) await reset; assert storage/assets cleared
  // 7) await B path; assert prepare-B ran after reset completed
})

it("does not hold the lifecycle queue for the full model stream", async () => {
  // start run() that streams slowly; assert a second message can enter prepare after run() returned the stream but before stream ends
})

it("serializes busy-join send behind an in-flight prepare", async () => {
  // message1 prepare gated; message2 is reply-eligible while busy → action send;
  // assert message2 prepare starts only after message1 prepare+submit finished
})
```

Wire tests through the same helper that constructs `YesImBotService` + `PlatformService` + controllable adapter (extend `platform-service-helper.ts` if needed).

- [ ] **Step 2: Run lifecycle tests — expect FAIL**

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/reset.test.ts tests/message-flow.test.ts
```

Expected: current `handleSession` prepares/resets without FIFO; assertions fail.

- [ ] **Step 3: Implement enqueueChannel and wrap handleSession**

```ts
async handleSession(session: Session, next?: () => Promise<unknown>): Promise<void> {
  const message =
    this.platformService.getMessage(session) ??
    this.platformService.collectIfNeeded(session)
  if (!message) {
    await next?.()
    return
  }
  const scope = getChannelScope(session)
  const key = createChannelRuntimeKey(scope)

  const routeSession = {
    ...session,
    content: session.content ?? elementsToLiteral(message.elements),
    userId: session.userId ?? message.sender.id,
    selfId: session.selfId || message.source.selfId,
  } as Session

  // Route may be computed inside the queue so isBusy reflects latest activeTurns
  let stream: AsyncIterable<RuntimeEvent> | undefined

  await this.enqueueChannel(key, async () => {
    const route = createMessageRoute(routeSession, { isBusy: this.activeTurns.has(key) })
    if (route.action === "ignore") return

    const prepared = await this.platformService.prepareMessage(session, message)
    const { runtime } = await this.getChannelAgent(session)
    const runtimeMessage = createPlatformMessage(prepared)

    if (route.action === "append") {
      await runtime.append(runtimeMessage)
      return
    }
    if (route.action === "send") {
      runtime.send(runtimeMessage, { ifBusy: route.ifBusy })
      return
    }
    // run: mark busy + start run inside lock; consume outside
    this.activeTurns.set(key, "active")
    stream = runtime.run(runtimeMessage)
  })

  if (!stream) {
    await next?.()
    return
  }

  try {
    const assistantMessages: AgentMessage[] = []
    for await (const event of stream) {
      // existing stream handling...
    }
  } finally {
    this.activeTurns.delete(key)
  }
  await next?.()
}
```

Keep existing assistant delivery logic; only move boundaries so stream wait is outside `enqueueChannel`.

- [ ] **Step 4: Enqueue reset on the same key**

```ts
// inside reset command / resetChannel method
await this.enqueueChannel(key, async () => {
  const runtime = this.runtimes.get(key)
  if (runtime) {
    await runtime.interrupt("reset")
    await runtime.stop()
  }
  const storage = /* channel storage for scope */
  await Promise.all([
    storage?.clear() ?? Promise.resolve(),
    this.platformService.clearChannel(scope),
  ])
  this.runtimes.delete(key)
  this.activeTurns.delete(key)
})
```

Do **not** wait for in-flight model streams outside the queue beyond `interrupt`/`stop` behavior already provided by runtime.

- [ ] **Step 5: Purge obsolete modules and thin index**

```bash
rtk rg "Snapshot|Reader|ReadContext|MessageView|MessagePart|EventView|StoredPlatform|createPlatformEvent|from \"./view|from \"./render|from \"./resources|from \"./schema" core/src plugins/platform-onebot plugins/onebot-utils
```

`index.ts` target:

```ts
export { PlatformService } from "./service.js"
export type * from "./types.js"
export { PlatformConfigSchema, DEFAULT_PLATFORM, type PlatformConfig } from "./config.js"
export { AssetStore } from "./assets.js" // only if tests/adapters need the class type; otherwise type-only
// do NOT export normalizeElements, sealMessage, formatMessageHeader
```

- [ ] **Step 6: Run focused tests + commit**

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/reset.test.ts tests/message-flow.test.ts tests/error-handling.test.ts tests/platform-prepare.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

Expected: FIFO tests pass; no production imports of deleted modules.

```bash
git add core/src/runtime/service.ts core/tests/reset.test.ts core/tests/message-flow.test.ts core/tests/error-handling.test.ts core/src/platform/index.ts core/src/platform/view.ts core/src/platform/render.ts core/src/platform/resources.ts core/src/platform/schema.ts
git commit -m "fix(core): serialize platform message lifecycle"
```

---

## Task 6: OneBot prepare + typed reaction events

**Covers:** tasks.md 3.2.

**Files:**
- Create: `plugins/platform-onebot/src/prepare.ts`
- Modify: `plugins/platform-onebot/src/index.ts`
- Modify: `plugins/platform-onebot/src/events.ts`
- Create: `plugins/platform-onebot/tests/prepare.test.ts` (replace `tests/readers.test.ts`)
- Modify: `plugins/platform-onebot/tests/plugin.test.ts`
- Modify: `plugins/platform-onebot/tests/events.test.ts`
- Delete: `plugins/platform-onebot/src/readers.ts`

**Consumes:** Task 4 `Platform.PrepareContext`, `ImagePrepareSink`, `IMAGE_BUDGET`, Task 3 element dialect, Task 2 `adapt` / `PlatformEventVariants`.

**Produces:**

```ts
// prepare.ts
export async function prepareOneBotMessage(
  ctx: Context,
  prepareCtx: Platform.PrepareContext,
): Promise<Element[]>

// events.ts
export function adaptMessageReactionsUpdated(
  session: Session,
  fact?: Platform.Message | Platform.Event,
): Platform.Event | void

// PlatformEventVariants augmentation (not Platform.Events)
declare module "koishi-plugin-yesimbot/platform" {
  interface PlatformEventVariants {
    "onebot.message-reactions-updated": MessageReactionsUpdatedData
  }
}

// index.ts adapter
export function createOneBotAdapter(ctx: Context): Platform.Adapter {
  return {
    id: "yesimbot.onebot",
    adapter: "onebot",
    adapt: (session, fact) => adaptMessageReactionsUpdated(session, fact),
    prepare: (prepareCtx) => prepareOneBotMessage(ctx, prepareCtx),
  }
}
```

**Image rules (must match IMAGE_BUDGET):** max 4 images; 5 MiB each; 10 MiB total; 2 concurrent; 10s timeout via `Promise.race`; magic-byte mime; SVG rejected; failures → `<img unavailable="true"/>`; do not fetch forward/quote bodies.

- [ ] **Step 1: Write failing OneBot prepare + event tests**

`plugins/platform-onebot/tests/prepare.test.ts`:

```ts
import { h } from "koishi"
import { prepareOneBotMessage } from "../src/prepare.js"

const PNG_1x1 = Uint8Array.from(/* minimal png bytes or fixture */)

it("freezes up to four images and marks the rest unavailable", async () => {
  const elements = [
    h("img", { src: "https://a/1" }),
    h("img", { src: "https://a/2" }),
    h("img", { src: "https://a/3" }),
    h("img", { src: "https://a/4" }),
    h("img", { src: "https://a/5" }),
    h.text("tail"),
  ]
  const puts: number[] = []
  const out = await prepareOneBotMessage(fakeCtxWithHttp(PNG_1x1), {
    session: fakeSession(),
    message: baseMessage(elements),
    images: {
      put: async (bytes) => {
        puts.push(bytes.byteLength)
        return { assetId: `asset_${puts.length}`, mime: "image/png" }
      },
    },
    budget: IMAGE_BUDGET,
  })
  const imgs = out.filter((e) => e.type === "img")
  expect(imgs.filter((e) => e.attrs.id).length).toBe(4)
  expect(imgs.some((e) => e.attrs.unavailable === "true" || e.attrs.unavailable === true)).toBe(true)
  expect(out.some((e) => e.type === "text")).toBe(true)
})

it("rejects svg / unknown bytes as unavailable without put", async () => {
  const puts = vi.fn()
  const out = await prepareOneBotMessage(fakeCtxWithHttp(SVG_BYTES), {
    session: fakeSession(),
    message: baseMessage([h("img", { src: "https://a/x.svg" })]),
    images: { put: puts },
    budget: IMAGE_BUDGET,
  })
  expect(puts).not.toHaveBeenCalled()
  expect(elementsToLiteral(out)).toContain("unavailable")
})

it("does not call getForwardMsg during prepare", async () => {
  const getForwardMsg = vi.fn()
  await prepareOneBotMessage(fakeCtx({ getForwardMsg }), {
    session: fakeSession(),
    message: baseMessage(h.parse('<forward id="f" summary="s"/>')),
    images: { put: async () => ({ assetId: "asset_x", mime: "image/png" }) },
    budget: IMAGE_BUDGET,
  })
  expect(getForwardMsg).not.toHaveBeenCalled()
})
```

`events.test.ts` updates:

```ts
it("adapts message_reactions_updated into Platform.Event with frozen content", () => {
  const event = adaptMessageReactionsUpdated(sessionWithNotice())
  expect(event?.type).toBe("onebot.message-reactions-updated")
  expect(event?.data).toMatchObject({ messageId: expect.any(String), reactions: expect.any(Array) })
  expect(typeof event?.content).toBe("string")
  expect(event).not.toHaveProperty("extensions")
})
```

- [ ] **Step 2: Run OneBot tests — expect FAIL**

```bash
rtk yarn workspace koishi-plugin-yesimbot-platform-onebot exec vitest run tests/prepare.test.ts tests/events.test.ts tests/plugin.test.ts
```

Expected: readers-based adapter / EventDefinition tests fail or prepare module missing.

- [ ] **Step 3: Implement prepareOneBotMessage**

Port download logic from `readers.ts` image reader **without** AbortSignal/Reader types:

```ts
export async function prepareOneBotMessage(
  ctx: Context,
  prepareCtx: Platform.PrepareContext,
): Promise<Element[]> {
  const { message, images, budget, session } = prepareCtx
  const bot = session.bot
  // collect img indices with remote src
  // process with concurrency budget.concurrency
  // per image:
  //   1) optional bot.internal.getImage(fileId) if platform file id present
  //   2) download URL via ctx.http with Promise.race timeout budget.timeoutMs
  //   3) enforce maxImages / maxBytesPerImage / running maxTotalBytes
  //   4) images.put(bytes) → <img id mime>
  //   5) on any failure → <img unavailable="true"/>
  // return full elements array preserving non-image nodes and order
}
```

Use `h` to rebuild the tree; do not return a string.

- [ ] **Step 4: Simplify events + adapter registration**

In `events.ts`:
- Remove `EventDefinition`, Zod view/Fact builders, `Platform.Events` augmentation.
- Keep structured `MessageReactionsUpdatedData`.
- Augment `PlatformEventVariants`.
- `adaptMessageReactionsUpdated` returns full `Platform.Event` draft fields **except** leave `receivedAt` as collection-provided when adapting an existing base, or set a placeholder that core overwrites — match Task 2 rule: core stamps/preserves collection `receivedAt`. Prefer: return event without relying on adapter clock; if type requires `receivedAt`, pass `0` and ensure normalize/collect overwrites from session collection timestamp.

Frozen `content` example:

```ts
content: `消息表态更新: ${data.messageId} (${data.reactions.length} reactions)`
```

In `index.ts`:

```ts
export function createOneBotAdapter(ctx: Context): Platform.Adapter {
  return {
    id: "yesimbot.onebot",
    adapter: "onebot",
    adapt: (session, fact) => adaptMessageReactionsUpdated(session, fact) ?? undefined,
    prepare: (pctx) => prepareOneBotMessage(ctx, pctx),
  }
}
```

Delete `readers` export and module.

- [ ] **Step 5: Run tests + typecheck + commit**

```bash
rtk yarn workspace koishi-plugin-yesimbot-platform-onebot exec vitest run tests/plugin.test.ts tests/events.test.ts tests/prepare.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-platform-onebot
```

```bash
git add plugins/platform-onebot/src plugins/platform-onebot/tests
git commit -m "refactor(onebot): prepare images without readers"
```

---

## Task 7: Paginated sanitized OneBot forward tool

**Covers:** tasks.md 5.1.

**Files:**
- Modify: `plugins/onebot-utils/src/index.ts`
- Modify: `plugins/onebot-utils/src/types.ts`
- Modify: `plugins/onebot-utils/tests/onebot-utils.test.ts`

**Consumes:** Task 3 element dialect semantics (unavailable/omitted). **Package boundary (pinned):** `onebot-utils` MUST NOT import `core/src/platform/utils/*` (not public). Implement a **local** `sanitizeForwardContent(raw: string): string` inside the plugin that applies the same allowlist outcomes for tool text (strip urls; media → omitted/unavailable text markers; no asset ids). Duplicating the small allowlist here is acceptable YAGNI; do not create a new shared workspace package in this change.

**Produces:**

```ts
// types.ts (public tool shapes)
export interface ForwardRecord {
  sender: string
  time?: string
  content: string
}

export interface ForwardPage {
  forwardId: string
  offset: number
  messages: ForwardRecord[]
  hasMore: boolean
}

// tool input
{
  messageId: string
  offset?: number // default 0, integer ≥ 0
  limit?: number  // default 10, clamp 1..20
}
```

**Caps (pinned):** per-record content 1000 chars; page total content 6000 chars; when page budget ends mid-list, return only consecutive records already fully included and `hasMore: true`; next offset = `offset + messages.length`.

**Sender/time formatting:** reuse core product rules where practical — sender `name (id)` or id; time `Asia/Shanghai` `zh-CN` minute precision via `JSON`/`Intl` consistent with header policy (tool fields are plain strings, not header-escaped).

- [ ] **Step 1: Replace raw forward tests with paginated contract tests**

```ts
it("returns the first page with defaults offset 0 limit 10", async () => {
  const getForwardMsg = vi.fn(async () => makeRawForward(15))
  const tool = getTool(createPluginWithInternal({ getForwardMsg }))
  const page = await tool.execute({ messageId: "fwd-1" }, toolContext())
  expect(getForwardMsg).toHaveBeenCalledWith("fwd-1")
  expect(page).toMatchObject({
    forwardId: "fwd-1",
    offset: 0,
    hasMore: true,
  })
  expect(page.messages).toHaveLength(10)
  expect(page.messages[0]).toEqual({
    sender: expect.any(String),
    content: expect.any(String),
  })
  expect(page.messages[0]).not.toHaveProperty("message_id")
  expect(JSON.stringify(page)).not.toContain("raw_message")
})

it("clamps limit to 20 and serves later offsets", async () => {
  const getForwardMsg = vi.fn(async () => makeRawForward(50))
  const tool = getTool(createPluginWithInternal({ getForwardMsg }))
  const page = await tool.execute({ messageId: "f", offset: 20, limit: 99 }, toolContext())
  expect(page.messages.length).toBeLessThanOrEqual(20)
  expect(page.offset).toBe(20)
})

it("caps record and page characters and keeps consecutive hasMore", async () => {
  const getForwardMsg = vi.fn(async () => [
    rawItem({ text: "x".repeat(5000) }),
    rawItem({ text: "y".repeat(5000) }),
  ])
  const page = await tool.execute({ messageId: "f" }, toolContext())
  expect(page.messages[0].content.length).toBeLessThanOrEqual(1000)
  const total = page.messages.reduce((n, m) => n + m.content.length, 0)
  expect(total).toBeLessThanOrEqual(6000)
  // if second record excluded by page budget:
  if (page.messages.length === 1) {
    expect(page.hasMore).toBe(true)
  }
})

it("strips media urls and does not download", async () => {
  const httpGet = vi.fn()
  const getForwardMsg = vi.fn(async () => [
    rawItem({ cq: "[CQ:image,url=https://evil/a.png]" }),
  ])
  const page = await tool.execute({ messageId: "f" }, toolContext({ httpGet }))
  expect(httpGet).not.toHaveBeenCalled()
  expect(JSON.stringify(page)).not.toContain("https://")
  expect(JSON.stringify(page)).not.toContain("asset_")
})

it("still fails clearly without OneBot internal", async () => {
  await expect(tool.execute({ messageId: "f" }, noInternalContext()))
    .rejects.toThrow(/OneBot/)
})
```

Keep existing reaction/essence tests green; only forward tool behavior changes. Plugin still sets `requiresMessageId: true` from Task 3.

- [ ] **Step 2: Run onebot-utils tests — expect FAIL on new assertions**

```bash
rtk yarn workspace koishi-plugin-yesimbot-onebot-utils exec vitest run tests/onebot-utils.test.ts
```

Expected: current tool returns raw `getForwardMsg` payload → shape assertions fail.

- [ ] **Step 3: Implement types + execute path**

```ts
const FORWARD_MESSAGE_SCHEMA = jsonSchema({
  type: "object",
  properties: {
    messageId: { type: "string", description: "合并转发消息的 ID" },
    offset: { type: "integer", minimum: 0, description: "分页偏移，默认 0" },
    limit: { type: "integer", minimum: 1, maximum: 20, description: "每页条数，默认 10，最大 20" },
  },
  required: ["messageId"],
  additionalProperties: false,
})

async execute({ messageId, offset = 0, limit = 10 }, context) {
  const internal = getOneBotInternal(context.platform.unsafeBot)
  const raw = await internal.getForwardMsg(messageId)
  const records = normalizeForwardRecords(raw) // sender, time?, content sanitized
  const clampedLimit = Math.min(20, Math.max(1, limit ?? 10))
  const start = Math.max(0, offset ?? 0)
  const slice = records.slice(start, start + clampedLimit)
  const messages: ForwardRecord[] = []
  let used = 0
  for (const rec of slice) {
    let content = rec.content.length > 1000 ? rec.content.slice(0, 1000) : rec.content
    if (used + content.length > 6000) break
    messages.push({ ...rec, content })
    used += content.length
  }
  return {
    forwardId: messageId,
    offset: start,
    messages,
    hasMore: start + messages.length < records.length,
  }
}
```

`normalizeForwardRecords`:
- Accept array or `{ messages: [...] }` if OneBot variants appear; prefer existing raw `ForwardMessage[]`.
- Map sender from `sender.nickname/card/user_id`.
- Convert `message` / `raw_message` through CQ/element path to a plain sanitized literal string (plugin-local).
- Never call `getImage`, `ctx.http`, or AssetStore.

- [ ] **Step 4: Run tests + typecheck + commit**

```bash
rtk yarn workspace koishi-plugin-yesimbot-onebot-utils exec vitest run tests/onebot-utils.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-onebot-utils
```

```bash
git add plugins/onebot-utils/src/index.ts plugins/onebot-utils/src/types.ts plugins/onebot-utils/tests/onebot-utils.test.ts
git commit -m "feat(onebot): paginate sanitized forward messages"
```

---

## Task 8: Regression matrix, builds, verify.md

**Covers:** tasks.md 6.1 and 6.2.

**Files:**
- Modify: `core/tests/platform-service-helper.ts` only when Tasks 4–6 fixtures need a shared adapter/session factory (keep helper minimal)
- Modify: any failing tests from Tasks 1–7
- Create: `openspec/changes/simplify-platform-adapter-model/verify.md` (only after commands below succeed)
- Optionally update an existing user-facing upgrade note **only if** one already exists in-repo; do not invent a new docs site page

**Consumes:** complete implementation from Tasks 1–7.

**Produces:** green focused suites + typecheck/build + `verify.md` evidence.

### Regression matrix (every row must have a test)

| Area | Assertion | Primary test file |
| --- | --- | --- |
| Legacy | old nested PlatformMessage / author / resources not decoded | `platform-types` / projection |
| Domain | Message has `elements` only (persisted uses `content` literal) | `platform-types`, `channel-message` |
| Forward seal | `<forward id summary>` not nested `<message forward>` | `platform-elements` |
| Quote | `<quote id/>` no lookup | `platform-elements`, prepare |
| Images | sink put → asset img; missing/no prepare → unavailable; no URL | `platform-prepare`, onebot `prepare` |
| Envelope | time / conditional id / sender + JSON escaping | `platform-projection` |
| requiresMessageId | onebot-utils true → id present | runtime plugin construction test or projection with flag |
| Events | publish stamps one receivedAt; no JSONL event append | `platform-normalize` / session |
| FIFO | reset waits prepare A; B after reset; stream outside lock; busy-join queued | `reset`, `message-flow` |
| Forward tool | page defaults, clamp 20, caps, no raw/urls/assets | `onebot-utils` |
| Exports | no public sanitize/formatter; no Reader/Snapshot imports in prod | `rg` step |

- [ ] **Step 1: Fill any missing matrix tests**

Add only the gaps found after Tasks 1–7 — do not duplicate already-green cases. Prefer extending existing files listed above.

- [ ] **Step 2: Run focused suites in dependency order**

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run \
  tests/platform-types.test.ts \
  tests/platform-normalize.test.ts \
  tests/platform-session.test.ts \
  tests/platform-elements.test.ts \
  tests/platform-projection.test.ts \
  tests/platform-prepare.test.ts \
  tests/message-flow.test.ts \
  tests/reset.test.ts \
  tests/channel-message.test.ts \
  tests/error-handling.test.ts

rtk yarn workspace koishi-plugin-yesimbot-platform-onebot exec vitest run \
  tests/plugin.test.ts tests/events.test.ts tests/prepare.test.ts

rtk yarn workspace koishi-plugin-yesimbot-onebot-utils exec vitest run \
  tests/onebot-utils.test.ts
```

Expected: all pass. No test file should import deleted Reader/View/Render/Snapshot APIs.

- [ ] **Step 3: Typecheck + build**

```bash
rtk yarn turbo run check-types \
  --filter=@yesimbot/agent-runtime \
  --filter=koishi-plugin-yesimbot \
  --filter=koishi-plugin-yesimbot-platform-onebot \
  --filter=koishi-plugin-yesimbot-onebot-utils

rtk yarn turbo run build \
  --filter=@yesimbot/agent-runtime \
  --filter=koishi-plugin-yesimbot \
  --filter=koishi-plugin-yesimbot-platform-onebot \
  --filter=koishi-plugin-yesimbot-onebot-utils
```

Expected: success from source; do not rely on stale `dist/`.

- [ ] **Step 4: Removal and export hygiene**

```bash
rtk rg "Snapshot|Reader|ReadContext|MessageView|MessagePart|EventView|BodyPart|AdapterIdentity|StoredPlatformMessage|createPlatformEvent|prepareMessage\\(session, message, assets\\)|data-yesimbot" \
  core/src plugins/platform-onebot/src plugins/onebot-utils/src

rtk rg "export \\* from \\\"./message|normalizeElements|formatMessageHeader|sealMessage" core/src/platform/index.ts

rtk git diff --check
```

Expected: no production hits except intentional comments/docs; `index.ts` stays thin; no whitespace errors.

- [ ] **Step 5: Write verify.md and final commit**

Create `openspec/changes/simplify-platform-adapter-model/verify.md` with:
- commands from Steps 2–4 and pass/fail excerpts
- list of deleted modules/behaviors (Reader/Snapshot/templates/legacy JSONL)
- **operational note:** upgrade requires clearing or replacing channel session JSONL + assets directories; rollback = previous binary + previous data directory

```bash
git add core plugins packages/agent-runtime openspec/changes/simplify-platform-adapter-model
git commit -m "refactor: simplify platform adapter model"
```

---

## Plan Self-Review (writing-plans checklist)

### Spec coverage map

| Spec requirement | Task |
| --- | --- |
| Pure-data Message + elements + persisted content literal | T1, T3 |
| ImagePrepareSink + prepare → Element[] + budgets | T4, T6 |
| `<forward id summary/>`, `<quote id/>` | T3 |
| Fixed envelope + requiresMessageId | T3 |
| Publish-only events + single receivedAt | T2 |
| Flat Adapter (no AdapterIdentity) | T1, T6 |
| FIFO + reset + busy-join + stream outside lock | T5 |
| Forward tool pagination/caps/sanitize | T7 |
| Destructive legacy boundary + verify | T1 Global, T8 |
| Thin modules / no public free-function forest | Global, T3–T5 |
| OneBot reaction events without EventDefinition | T6 |

### Placeholder scan

- Storage encoding **pinned** (persisted `content` literal).
- Attr dialect **pinned** (no `data-yesimbot`).
- IMAGE_BUDGET / FORWARD_SUMMARY **pinned**.
- busy-join **required** in T5 (not “if applicable”).
- onebot-utils allowlist **local duplicate** pinned (no “maybe shared package”).
- Worktree reconcile files listed.
- Intermediate typecheck red allowed until T4/T5 with focused tests green per task.

### Type consistency

- Domain: `Platform.Message.elements: Element[]`
- Persist: `PersistedPlatformMessage.content: string`
- Adapter: `prepare?(ctx: PrepareContext): Promise<Element[] | void>`
- Sink: `PrepareContext.images: ImagePrepareSink`
- Asset ids: `asset_<sha256>`
- No `AdapterIdentity`, no `BodyPart`, no `prepareMessage(..., assets)` string API

### writing-plans compliance notes for executors

- Each task has Files / Consumes / Produces / failing tests / commands / commit.
- Where `h.transform` callback shape differs by version, **output element shapes** are normative; match installed Koishi API when wiring.
- Do not start Task N+1 until Task N focused tests pass.
- Do not claim complete until Task 8 matrix + verify.md exist with fresh command output.
