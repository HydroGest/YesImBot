# Core Architecture Slimming Implementation Plan

> **For agentic workers:** implement this plan task-by-task. Steps use checkbox
> (`- [ ]`) syntax for tracking. Every task ends with a commit.

**Goal:** Remove ~700 lines of consumer-less features, defensive self-validation, and
duplicated schedulers from `core`, and fix the `elements`/`text` divergence, without
removing any capability that has a real consumer.

**Architecture:** `h.parse()` becomes the single owner of reply structure with `<raw>`
pre-extracted before lexing; sealed `elements` becomes the single source of truth for
persisted messages; validation collapses to Session ingress and JSONL read-back;
`runtime/index.ts` splits into manager / channel / delivery over one shared scheduler.

**Tech Stack:** TypeScript, Koishi (`h` element API), Yarn 4 workspaces, Turborepo,
Vitest, zod, pkgroll.

## Global Constraints

- Breaking changes are acceptable. No compatibility branch, migration reader, alias, or
  dual payload shape. Existing JSONL stays on disk unread.
- `@yesimbot/agent-runtime` is not modified. It is an explicit Non-Goal.
- Willingness scoring behaviour and its full tuning surface are retained unchanged.
- Channel identity, storage layout, and assignee admission are unchanged.
- Unrecognized elements are delivered structurally as-is: no literal recovery, no
  warning, no runtime registry of element types.
- Pacing configuration is exactly two keys: `charactersPerSecond`, `maxTotalDelayMs`.
- `schemaVersion` becomes `3` on both `MessageRecord` and `EventBase`.
- Prompt prose lives only in `core/resources/*.md`. Zero prose in any `.ts` file.
- Yarn 4 only (`nodeLinker: node-modules`). Never `npm` or `pnpm`.
- Communicate in Chinese; keep code, identifiers, logs, and error messages in English.
- Do not revert or stage the pre-existing uncommitted `plugins/sticker` deletion or the
  `spec.md` modification.

---

## Task 1: Reply Parsing On Koishi Elements

**Files:**
- Modify: `core/src/reply/parse.ts` (full rewrite, currently 172 lines)
- Modify: `core/src/config.ts:17-19,33-35,68-71,145-152`
- Modify: `core/src/runtime/index.ts:34,507-519,551-553,780-809`
- Modify: `core/src/gateway/index.ts:185`
- Test: `core/tests/ocl.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `h`, `Element` from `koishi`.
- Produces: `parseReply(raw: string): Element[][]`. Task 4 consumes `Element[]`
  segments to compute visible text; Task 7 relocates its caller unchanged.

- [ ] **Step 1: Replace the whole of `core/src/reply/parse.ts`**

```ts
import { Element, h } from "koishi";

const RAW_OPEN = "<raw>";
const RAW_CLOSE = "</raw>";
const SEPARATOR = "sep";
const INNER_THOUGHT = "inner_thought";
const MARK = "\u0000";

export function parseReply(raw: string): Element[][] {
  const source = raw.replaceAll(MARK, "");
  const nonce = `${MARK}r${Math.random().toString(36).slice(2)}`;
  const captured: string[] = [];
  const masked = maskRaw(source, nonce, captured);
  return partition(h.parse(masked))
    .map((segment) => segment.map((element) => restore(element, nonce, captured)))
    .filter((segment) => !isBlank(segment));
}

function maskRaw(source: string, nonce: string, captured: string[]): string {
  let masked = "";
  let cursor = 0;
  for (;;) {
    const open = source.indexOf(RAW_OPEN, cursor);
    if (open < 0) return masked + source.slice(cursor);
    masked += source.slice(cursor, open);
    const start = open + RAW_OPEN.length;
    const close = source.indexOf(RAW_CLOSE, start);
    masked += `${nonce}${captured.length}${MARK}`;
    captured.push(close < 0 ? source.slice(start) : source.slice(start, close));
    if (close < 0) return masked;
    cursor = close + RAW_CLOSE.length;
  }
}

function partition(tree: readonly Element[]): Element[][] {
  const segments: Element[][] = [];
  let current: Element[] = [];
  for (const element of tree) {
    if (element.type === INNER_THOUGHT) continue;
    if (element.type === SEPARATOR) {
      segments.push(current);
      current = [];
      continue;
    }
    current.push(strip(element));
  }
  segments.push(current);
  return segments;
}

function strip(element: Element): Element {
  if (element.children.length === 0) return element;
  return h(
    element.type,
    element.attrs,
    element.children
      .filter((child) => child.type !== INNER_THOUGHT && child.type !== SEPARATOR)
      .map(strip),
  );
}

function restore(element: Element, nonce: string, captured: string[]): Element {
  if (element.type === "text") {
    return h.text(expand(`${element.attrs["content"] ?? ""}`, nonce, captured));
  }
  const attrs = Object.fromEntries(
    Object.entries(element.attrs).map(([key, value]) => [
      key,
      typeof value === "string" ? expand(value, nonce, captured) : value,
    ]),
  );
  return h(
    element.type,
    attrs,
    element.children.map((child) => restore(child, nonce, captured)),
  );
}

function expand(value: string, nonce: string, captured: string[]): string {
  let expanded = "";
  let cursor = 0;
  for (;;) {
    const start = value.indexOf(nonce, cursor);
    if (start < 0) return expanded + value.slice(cursor);
    const end = value.indexOf(MARK, start + nonce.length);
    if (end < 0) return expanded + value.slice(cursor);
    expanded +=
      value.slice(cursor, start) + (captured[Number(value.slice(start + nonce.length, end))] ?? "");
    cursor = end + 1;
  }
}

function isBlank(segment: readonly Element[]): boolean {
  return segment.every(
    (element) =>
      element.type === "text" && `${element.attrs["content"] ?? ""}`.trim().length === 0,
  );
}
```

Note the ordering guarantee: `maskRaw` runs on the raw string before `h.parse`, because
that is the last moment the author's literal text still exists intact. The nonce is
per call, so a model emitting a placeholder cannot inject captured content.

- [ ] **Step 2: Strip `reply.segmentation` from configuration**

In `core/src/config.ts` delete the `ReplySegmentationConfig` interface (17-19), the
`DEFAULT_REPLY_SEGMENTATION_CONFIG` constant (33-35), the `segmentation` field on
`Config["reply"]` (68-71), and the `segmentation` Schema block (147-152). Leave
`reply.pacing` alone; Task 4 rewrites it.

- [ ] **Step 3: Move the runtime to element segments**

In `core/src/runtime/index.ts`: change `ChannelOutput.segments` (62-66) to
`readonly Element[][]`; change `parseAssistantContent` (507-511) to
`parseReply(text)` returning `Element[][]`; delete the `maxSegments` field and its
constructor plumbing (551-553) plus the `DEFAULT_REPLY_SEGMENTATION_CONFIG` import;
in `consumeStream` (780-809) pass the parsed segments straight through.

`hasRenderableSegment` (513-519) still exists at this point — Task 6 deletes it. For
now, adapt it minimally to the new segment shape so the build stays green.

- [ ] **Step 4: Deliver structured segments**

In `core/src/gateway/index.ts:185` replace `await session.send(segment.text);` with
`await session.send(segment);`. Koishi accepts an element fragment, which is what
enables `<at>` and images in replies.

- [ ] **Step 5: Rewrite the parser tests**

Rewrite `core/tests/ocl.test.ts` to cover, at minimum: single segment with no control
element; `<sep/>` splitting into ordered segments; leading, trailing, and consecutive
`<sep/>` producing no empty segment; `<inner_thought>` fully removed from output;
`<raw>List<String> generic</raw>` delivering the literal text with no `String`
element; a code fence inside `<raw>` surviving every `<`; `<raw>` containing `<sep/>`
not splitting; an unterminated `<raw>` dropping no content; text resembling the nonce
placeholder not triggering substitution; `<at id="42"/>` surviving as an element;
entity form `&lt;sep/&gt;` arriving as literal text; and an unknown element type
passing through structurally without warning.

- [ ] **Step 6: Verify**

```bash
yarn workspace koishi-plugin-yesimbot exec vitest run tests/ocl.test.ts
yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

- [ ] **Step 7: Commit**

```bash
git add core/src/reply/parse.ts core/src/config.ts core/src/runtime/index.ts \
  core/src/gateway/index.ts core/tests/ocl.test.ts
git commit -m "refactor(core): parse replies as koishi elements with raw pre-extraction"
```

---

## Task 2: Prompt Resources And The `<raw>` Instruction

**Files:**
- Create: `core/resources/constitution.md`
- Create: `core/resources/athena-persona.md`
- Create: `core/src/runtime/prompts/resource.ts`
- Modify: `core/src/runtime/prompts/constitution.ts` (57 lines → version constant only)
- Delete: `core/src/runtime/prompts/athena.ts` (35 lines)
- Modify: `core/src/runtime/prompt.ts:1-2,69-84`
- Modify: `core/package.json:19-21`
- Test: `core/tests/prompt.test.ts`

**Interfaces:**
- Produces: `readPromptResource(name: "constitution" | "athena-persona"): Promise<string>`
  from `core/src/runtime/prompts/resource.ts`, and `CORE_CONSTITUTION_VERSION = 3`
  still exported from `core/src/runtime/prompts/constitution.ts`.
- Consumes: nothing from other tasks. Depends on Task 1 only for the grammar it teaches.

- [ ] **Step 1: Move the prose into resources**

Copy the `String.raw` body of `core/src/runtime/prompts/constitution.ts` verbatim into
`core/resources/constitution.md`, and the body of `core/src/runtime/prompts/athena.ts`
verbatim into `core/resources/athena-persona.md`. Do not reword anything in this step —
a pure move keeps the diff reviewable.

- [ ] **Step 2: Teach `<raw>` in the constitution**

Inside the output-shape section of `core/resources/constitution.md`, document exactly
three control elements and add the `<raw>` obligation. Required content:

```markdown
You control your delivered output with exactly three control elements.

- `<inner_thought>...</inner_thought>` — private deliberation. Removed before delivery;
  never seen by any reader. Use it to think before you speak.
- `<sep/>` — a boundary between delivered messages. You own every visible split.
- `<raw>...</raw>` — verbatim plain text. Its contents are never parsed as markup.

Wrap any plain-text content that may contain `<`, `>`, or code in `<raw>`. This includes
generics such as `List<String>`, comparisons such as `a < b`, code fences, HTML
snippets, and email addresses in angle brackets. Text outside `<raw>` is parsed as
Koishi element markup, so an unwrapped `<` may be interpreted as the start of an
element and the surrounding text may not be delivered as you wrote it.
```

- [ ] **Step 3: Add the resource loader**

Create `core/src/runtime/prompts/resource.ts`:

```ts
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type PromptResource = "constitution" | "athena-persona";

const RESOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "resources");

export async function readPromptResource(name: PromptResource): Promise<string> {
  const path = join(RESOURCE_ROOT, `${name}.md`);
  const content = (await readFile(path, "utf8")).trim();
  if (content.length === 0) throw new Error(`Prompt resource ${name} is empty`);
  return content;
}
```

`RESOURCE_ROOT` assumes the built entry sits at `core/dist/<entry>` and resources at
`core/resources/`, so `..` from the module directory reaches the package root. Step 5
verifies this against real build output instead of trusting it.

- [ ] **Step 4: Reduce the prompt modules and wire the loader**

Reduce `core/src/runtime/prompts/constitution.ts` to exactly:

```ts
export const CORE_CONSTITUTION_VERSION = 3 as const;
```

Delete `core/src/runtime/prompts/athena.ts`. In `core/src/runtime/prompt.ts`, replace
the `CORE_CONSTITUTION` and `DEFAULT_ATHENA_PERSONA` imports with
`readPromptResource`, and `await` both resources inside `buildCoreSystemPrompt`
alongside the existing `AGENTS.md` / `PERSONA.md` reads. Keep the existing precedence:
an on-disk `PERSONA.md` still overrides the packaged default persona.

- [ ] **Step 5: Publish the resources and prove both module formats resolve**

In `core/package.json`, change `files` to include the new directory:

```json
  "files": [
    "dist",
    "resources"
  ],
```

Then build and check both outputs actually load a resource:

```bash
yarn workspace koishi-plugin-yesimbot run build
node -e "import('koishi-plugin-yesimbot/dist/runtime/prompts/resource.js').then(m=>m.readPromptResource('constitution')).then(t=>console.log('ESM ok',t.length))"
node -e "require('./core/dist/index.cjs'); console.log('CJS entry ok')"
```

If `import.meta.url` is not shimmed in the `.cjs` output and the ESM check passes but
CJS fails, switch `RESOURCE_ROOT` to a `createRequire`-based resolution of
`koishi-plugin-yesimbot/package.json` and re-run both checks. Do not leave this
unverified — a resource that resolves only under ESM breaks the published package.

- [ ] **Step 6: Update the prompt tests**

In `core/tests/prompt.test.ts`, drop the `CORE_CONSTITUTION` / `DEFAULT_ATHENA_PERSONA`
imports and assert instead that the composed prompt contains the constitution text
loaded from resources, that `<raw>` is taught in it, that constitution version 3 is
reported, that an on-disk `PERSONA.md` overrides the packaged persona, and that a
missing resource file raises rather than silently yielding an empty prompt.

- [ ] **Step 7: Verify**

```bash
yarn workspace koishi-plugin-yesimbot exec vitest run tests/prompt.test.ts
yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

- [ ] **Step 8: Commit**

```bash
git add core/resources core/src/runtime/prompts core/src/runtime/prompt.ts \
  core/package.json core/tests/prompt.test.ts
git commit -m "refactor(core): ship prompt prose as packaged markdown resources"
```

---

## Task 3: Sealed Elements As The Single Source Of Truth

**Files:**
- Modify: `core/src/event/index.ts:21-31,33-41,47-54,95-123`
- Modify: `core/src/gateway/index.ts:306-330,332-369`
- Modify: `core/src/event/formatter.ts:21-26`
- Modify: `core/src/media/index.ts:299-311,313-359`
- Modify: `core/src/will/willingness.ts:173-177,204-209`, `core/src/will/index.ts:83-94`
- Modify: `core/src/platforms/onebot/index.ts:29-37`
- Test: `core/tests/{event,formatter,gateway,gateway-delivery,channel-runtime,runtime-manager,will,storage}.test.ts`, `core/tests/platform/onebot.test.ts`

**Interfaces:**
- Produces: `MessageRecord` without `text`, `schemaVersion: 3` on both record kinds, and
  `renderElements(elements: readonly Element[]): string` exported from
  `core/src/event/element.ts` as the one text projection used by formatter and will.
- Consumes: nothing from Tasks 1-2. Task 5 depends on this task's `schemaVersion: 3`.

- [ ] **Step 1: Close the record types**

In `core/src/event/index.ts`: delete `readonly text: string;` from `MessageRecord`
(line 29) and delete `readonly text?: string;` from `ResolvedMessageDraft` (line 51).
Keep `EventBase.text` — Events carry no `elements`, so `text` is their only content.
Change the `schemaVersion` literal from `2` to `3` on `MessageRecord` (line 22) and on
`EventBase` (line 34). Both bump together so one JSONL file never holds two versions.

- [ ] **Step 2: Add the single text renderer**

Append to `core/src/event/element.ts`:

```ts
export function renderElements(elements: readonly Element[]): string {
  return elements.map((element) => element.toString()).join("");
}
```

This replaces the three duplicated `map(toString).join("")` expressions at
`gateway/index.ts:328`, `gateway/index.ts:355`, and `platforms/onebot/index.ts:33`.

- [ ] **Step 3: Persist sealed elements once per path**

In `core/src/gateway/index.ts`, `resolveFallbackMessage` (306-330): compute
`const elements = sealElements(session.elements);` once, return `elements` in the
record, and delete the `text` property entirely. `sealElements` already calls
`normalizeElements` internally, so drop the outer `normalizeElements(...)` wrapper.

In `normalizeDraft` (332-369), message branch: compute
`const elements = sealElements(draft.elements);`, return that as `elements`, and delete
the `text: draft.text ?? ...` line. The event branch keeps `text` unchanged.

This is the correctness fix: previously `elements` kept the original image `src` while
`text` said the image was unavailable. Now one sealed array is the only answer.

- [ ] **Step 4: Render text at projection time**

In `core/src/event/formatter.ts:23`, replace `input.data.text` with
`renderElements(input.data.elements)`. The header construction is unchanged. Event
formatting at line 55 keeps reading `input.data.text`.

- [ ] **Step 5: Discover assets from elements**

In `core/src/media/index.ts`, delete `imageAssetIds` (307-311) with its
`h.normalize` round trip, and change the loop at line 325 to walk
`input.data.elements` with the existing `collectAssetIds` recursion so nested elements
are covered and document order is preserved. Asset discovery must no longer depend on
the text rendering format.

- [ ] **Step 6: Match keywords against rendered element text**

In `core/src/will/willingness.ts:173`, replace `data.text.includes(keyword)` with a
match against `renderElements(data.elements)`. Then delete the duplicate
`isSelfMention`: keep the array-shaped one in `willingness.ts` (204-209) and have
`core/src/will/index.ts` (83-94) import it instead of defining its own single-element
variant, adapting the call site accordingly.

- [ ] **Step 7: Stop supplying draft text in the OneBot resolver**

In `core/src/platforms/onebot/index.ts`, delete the `text` property from the returned
message draft and the local text derivation at line 33. The resolver supplies elements
only; Gateway owns sealing.

- [ ] **Step 8: Update the test fixtures**

Remove `text: "hello"` (and equivalents) from every `MessageRecord` fixture builder:
`event.test.ts:31`, `formatter.test.ts:35`, `channel-runtime.test.ts:81`,
`runtime-manager.test.ts:36`, `gateway-delivery.test.ts:36`, `will.test.ts:41`,
`storage.test.ts:276`, and the `ResolvedMessageDraft` builder at `gateway.test.ts:45`.
Update `schemaVersion` expectations from 2 to 3 everywhere. Delete the type assertion
`expectTypeOf<Message["data"]["text"]>().toBeString()` at `event.test.ts:168-171`.

Add these assertions:
- Gateway fallback and resolver paths both persist sealed elements, and a persisted
  image element retains no original remote `src`.
- The same persisted Message projected twice yields byte-identical text.
- Asset discovery still finds a nested frozen image reference after the text projection
  format is changed (assert via elements, not via a rendered string).

- [ ] **Step 9: Verify**

```bash
yarn workspace koishi-plugin-yesimbot exec vitest run
yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

- [ ] **Step 10: Commit**

```bash
git add core/src core/tests
git commit -m "fix(core): make sealed elements the single source of truth for messages"

---

## Task 4: Pacing Reduced To Two Knobs

**Files:**
- Modify: `core/src/reply/pacing.ts` (full rewrite, currently 111 lines)
- Modify: `core/src/config.ts:21-31,37-47,49-51,153-181`
- Modify: `core/src/gateway/index.ts:164-179`
- Test: `core/tests/pacing.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `Element[]` segments from Task 1.
- Produces: `nextSegmentDelayMs(input: { text: string; consumedDeliveryMs: number; config: PacingConfig }): number`
  and `PacingConfig = { charactersPerSecond: number; maxTotalDelayMs: number }`.

- [ ] **Step 1: Replace the whole of `core/src/reply/pacing.ts`**

```ts
import type { PacingConfig } from "../config.js";

const MIN_DELAY_MS = 250;
const MAX_SEGMENT_DELAY_MS = 10_000;
const JITTER_MIN = 0.85;
const JITTER_MAX = 1.15;

export interface PacingInput {
  readonly text: string;
  readonly consumedDeliveryMs: number;
  readonly config: PacingConfig;
}

export function nextSegmentDelayMs(input: PacingInput): number {
  const jitter = JITTER_MIN + (JITTER_MAX - JITTER_MIN) * Math.random();
  const typingMs = ([...input.text].length / input.config.charactersPerSecond) * 1_000 * jitter;
  const delayMs = Math.min(Math.max(typingMs, MIN_DELAY_MS), MAX_SEGMENT_DELAY_MS);
  if (input.consumedDeliveryMs + delayMs >= input.config.maxTotalDelayMs) return MIN_DELAY_MS;
  return Math.round(delayMs);
}
```

Every character counts the same — the CJK/Latin split is gone, not relocated. There is no
first-segment branch: the first segment is paced by the same rule as every other. When
the total ceiling is hit, remaining segments get `MIN_DELAY_MS`; none are dropped.

- [ ] **Step 2: Shrink the pacing configuration**

In `core/src/config.ts`: reduce `PacingConfig` (21-31) to `charactersPerSecond` and
`maxTotalDelayMs`; reduce `DEFAULT_REPLY_PACING_CONFIG` (37-47) to
`{ charactersPerSecond: 8, maxTotalDelayMs: 60_000 }`; keep
`resolveReplyPacingConfig` (49-51) as-is; and reduce the `pacing` Schema block
(153-181) to two `Schema.number().min(1)` fields with those defaults.

- [ ] **Step 3: Feed pacing from segment elements**

In `core/src/gateway/index.ts` (164-179), compute the segment's visible text from its
elements using `renderElements` from Task 3, then call:

```ts
const delayMs = nextSegmentDelayMs({
  text: renderElements(segment),
  consumedDeliveryMs,
  config: this.pacing,
});
```

Delete the `isFirst`, `elapsedGenerationMs`, and `routeStartedAt` plumbing that existed
only to serve the removed first-segment branch, including the `elapsedSince(routeStartedAt)`
call. Keep `consumedDeliveryMs` accumulation and the abort checks unchanged.

- [ ] **Step 4: Rewrite the pacing tests**

Rewrite `core/tests/pacing.test.ts` to assert: every returned delay lies within
`[MIN_DELAY_MS, MAX_SEGMENT_DELAY_MS]`; a longer text never yields a smaller delay than
a shorter text under the same config, checked across repeated runs to survive jitter;
the first segment and a later segment with identical text receive delays from the same
distribution (no special case); once `consumedDeliveryMs` reaches `maxTotalDelayMs` the
result is exactly `MIN_DELAY_MS`; and a segment whose text is empty still returns at
least `MIN_DELAY_MS`.

Assert bounds and monotonicity, not exact values — `Math.random()` stays internal and no
injection seam is added.

- [ ] **Step 5: Verify**

```bash
yarn workspace koishi-plugin-yesimbot exec vitest run tests/pacing.test.ts
yarn workspace koishi-plugin-yesimbot exec vitest run tests/gateway-delivery.test.ts
yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

- [ ] **Step 6: Commit**

```bash
git add core/src/reply/pacing.ts core/src/config.ts core/src/gateway/index.ts \
  core/tests/pacing.test.ts
git commit -m "refactor(core): reduce reply pacing to two configuration knobs"
```

---

## Task 5: Validation At The Two Trust Boundaries

**Files:**
- Modify: `core/src/gateway/index.ts:142-154,400-424`
- Modify: `core/src/runtime/storage.ts:19-32`
- Modify: `core/src/event/index.ts:95-127`
- Test: `core/tests/jsonl-storage.test.ts`, `core/tests/gateway.test.ts`

**Interfaces:**
- Consumes: `schemaVersion: 3` from Task 3.
- Produces: `createJsonlStorage` validating `yesimbot.message` / `yesimbot.event`
  payloads on read; `isMessage` / `isEvent` scoped to read-back only.

- [ ] **Step 1: Delete the self-validation helpers**

In `core/src/gateway/index.ts`, delete `isRecord` (400-404), `hasScope` (406-413), and
`containsReference` (415-424), plus the admission branch at 142-154 that called them.
Keep the `if (!record) return;` guard at line 141 and the `scope` null check, folding
the latter into the existing flow.

`hasScope` compared fields against the scope they were assigned from and was always
true. `containsReference` deep-walked every inbound record to enforce an architectural
invariant — that invariant moves to a test in Step 4.

- [ ] **Step 2: Validate JSONL on read-back**

In `core/src/runtime/storage.ts`, add zod schemas for the two custom payloads and
validate each parsed line before returning it, following the
`storage/manifest.ts:70-95` pattern:

```ts
import { z } from "zod";

const channelSchema = z.object({ id: z.string().min(1) }).passthrough();

const messageDataSchema = z
  .object({
    schemaVersion: z.literal(3),
    platform: z.string().min(1),
    selfId: z.string().min(1),
    channel: channelSchema,
    user: z.object({ id: z.string().min(1) }).passthrough(),
    messageId: z.string().min(1),
    elements: z.array(z.unknown()),
    timestamp: z.number(),
  })
  .passthrough();

const eventDataSchema = z
  .object({
    schemaVersion: z.literal(3),
    platform: z.string().min(1),
    selfId: z.string().min(1),
    channel: channelSchema,
    eventType: z.string().min(1),
    text: z.string(),
    timestamp: z.number(),
  })
  .passthrough();
```

In `read()`, after `JSON.parse(line)`, inspect the entry: when it is a custom message
whose `type` is `yesimbot.message` validate `data` with `messageDataSchema`; when
`yesimbot.event` validate with `eventDataSchema`; otherwise pass the entry through
untouched. A validation failure must throw — an invalid stored record fails loudly
rather than being silently reinterpreted. Do not modify `@yesimbot/agent-runtime`.

- [ ] **Step 3: Narrow the type guards**

In `core/src/event/index.ts`, reduce `isMessage` (95-109) and `isEvent` (111-123) to a
discriminator on `role === "custom"` plus the `type` string, dropping the field-by-field
`typeof` checks now covered by zod at read-back. Model projection discriminates on
`type` alone. Keep `isInput` behaviour intact.

- [ ] **Step 4: Replace the runtime invariant with a test**

In `core/tests/gateway.test.ts`, add a test that routes a Session through Gateway and
asserts the persisted record graph contains no reference to that Session object — a
deep walk in the test, which is where the invariant belongs. Also assert that a resolver
returning a record for a different channel scope does not reach the runtime.

- [ ] **Step 5: Add read-back validation tests**

In `core/tests/jsonl-storage.test.ts`, add: a valid `yesimbot.message` entry round-trips
through append and read; a stored line whose message payload has `schemaVersion: 2`
throws on read; a stored line missing `elements` throws on read; and a non-custom entry
type passes through unvalidated.

- [ ] **Step 6: Verify**

```bash
yarn workspace koishi-plugin-yesimbot exec vitest run tests/jsonl-storage.test.ts
yarn workspace koishi-plugin-yesimbot exec vitest run tests/gateway.test.ts
yarn workspace koishi-plugin-yesimbot exec vitest run tests/event.test.ts
yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

- [ ] **Step 7: Commit**

```bash
git add core/src/gateway/index.ts core/src/runtime/storage.ts core/src/event/index.ts \
  core/tests/jsonl-storage.test.ts core/tests/gateway.test.ts

---

## Task 6: Delivery Acknowledgement And Willingness Construction

**Files:**
- Modify: `core/src/runtime/index.ts:513-528,529-905` (delivery bookkeeping)
- Modify: `core/src/will/willingness.ts:74,111-118,172,211-233`
- Modify: `core/src/will/index.ts:12-18`
- Test: `core/tests/will.test.ts`, `core/tests/channel-runtime.test.ts`, `core/tests/gateway-delivery.test.ts`

**Interfaces:**
- Produces: `ChannelRuntime.complete(turnId: string): Promise<void>` calling
  `will.onReply()` at most once per turn; `decayScore` no longer exported.
- Consumes: nothing from Tasks 1-5. Task 7 moves the resulting code into `delivery.ts`.

- [ ] **Step 1: Replace the reconciler with an acknowledged-turn set**

In `core/src/runtime/index.ts`, delete `ReplyEligibility` (521), `ReplyCompletion`
(523-528), `hasRenderableSegment` (513-519), `recordReplyCompletion` (821-837),
`reconcileReplyCompletion` (839-858), `enqueueReplyCompletion` (860-867), and the
`replyCompletions` (542) and `replyCompletionTail` fields.

Replace them with one field and one method on `ChannelRuntime`:

```ts
private readonly acknowledged = new Set<string>();

async complete(turnId: string): Promise<void> {
  if (this.acknowledged.has(turnId)) return;
  this.acknowledged.add(turnId);
  try {
    await this.opts.will.onReply?.();
  } catch (cause) {
    this.warn("will_reply_failed", { cause });
  }
}
```

Have `releaseDelivery(turnId)` (811-819) delete the turn id from `acknowledged`. Gateway
already calls `delivery.complete(turnId)` only after a successful `session.send()` of a
segment that exists, so acknowledgement alone proves a reply reached the channel — the
`eligibility` dimension re-derived a known fact by re-parsing output the same turn had
already parsed.

- [ ] **Step 2: Validate willingness configuration once**

In `core/src/will/willingness.ts`, call `assertValidConfig(this.config)` from the
`WillingnessWillEngine` constructor and remove the calls at line 74 (`onReply`), line
118 (`decayScore`), and line 172 (`calculateScore`). Invalid configuration must now fail
construction. The config is frozen at construction, so per-call revalidation could never
detect anything new.

- [ ] **Step 3: Stop exporting `decayScore`**

Remove `export` from `decayScore` in `core/src/will/willingness.ts:111` so it becomes
module-internal, and remove it from the re-export list in `core/src/will/index.ts:12-18`.

- [ ] **Step 4: Update the tests**

In `core/tests/will.test.ts`, delete the `decayScore` import (line 20) and rewrite the
six direct `decayScore(...)` assertions (202-230) to drive decay through the public
engine: construct a `WillingnessWillEngine`, advance time with fake timers or an
injected clock if one exists, feed observations, and assert the resulting
`"wait" | "trigger"` decisions and exposed state. Add a test asserting that a non-finite
or out-of-range willingness config throws at construction.

In `core/tests/channel-runtime.test.ts` and `core/tests/gateway-delivery.test.ts`, assert:
`onReply()` fires exactly once when several segments of one turn are delivered; it does
not fire when the first `session.send()` throws; and it does not fire for an aborted turn.

- [ ] **Step 5: Verify**

```bash
yarn workspace koishi-plugin-yesimbot exec vitest run tests/will.test.ts
yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel-runtime.test.ts
yarn workspace koishi-plugin-yesimbot exec vitest run tests/gateway-delivery.test.ts
yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

- [ ] **Step 6: Commit**

```bash
git add core/src/runtime/index.ts core/src/will core/tests
git commit -m "refactor(core): acknowledge delivery by turn id and validate will config once"
```

---

## Task 7: Runtime Module Split

**Files:**
- Create: `core/src/runtime/serial-queue.ts`
- Create: `core/src/runtime/delivery.ts`
- Create: `core/src/runtime/channel.ts`
- Create: `core/src/runtime/manager.ts`
- Modify: `core/src/runtime/index.ts` (905 lines → barrel)
- Test: `core/tests/runtime-manager.test.ts`, `core/tests/channel-runtime.test.ts`

**Interfaces:**
- Consumes: the acknowledged-turn set from Task 6.
- Produces: `serialQueue()` returning `{ run<T>(operation: () => Promise<T>): Promise<T> }`;
  `core/src/runtime/index.ts` re-exporting exactly the symbols it exports today so no
  importer outside `runtime/` changes.

- [ ] **Step 1: Extract one scheduler**

Create `core/src/runtime/serial-queue.ts`:

```ts
export interface SerialQueue {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

export function serialQueue(): SerialQueue {
  let tail: Promise<void> = Promise.resolve();
  return {
    run(operation) {
      const next = tail.then(operation, operation);
      tail = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
}
```

Replace `enqueue` (897-904) and `enqueueLifecycle` (378-390) with this. `enqueueLifecycle`
is per-identity, so `RuntimeManager` keeps a `Map<string, SerialQueue>` and retains the
existing cleanup that deletes an identity's queue once it settles. A rejected operation
must not prevent the next one from running — that is why both handlers pass `operation`.

- [ ] **Step 2: Move delivery into its own module**

Create `core/src/runtime/delivery.ts` holding `OutputQueue` (431-475), the delivery lease
acquisition and release (659-681), `deliverySignal` (683-687), `abortDelivery` (869-871),
the `AbortController` table (543), the acknowledged-turn set from Task 6, and the
`RuntimeDelivery` type (78-83). Export a constructible delivery object; do not re-export
it from the barrel unless it is already public today.

- [ ] **Step 3: Move ChannelRuntime into its own module**

Create `core/src/runtime/channel.ts` holding `ChannelRuntime`, `ChannelRuntimeOptions`,
`ChannelRuntimeDrainingError`, `ChannelOutput`, and the free helpers `errorMessage`,
`isAssistantMessage`, `renderAssistantText`, `parseAssistantContent`. It composes the
delivery object from Step 2 and a `serialQueue` for its FIFO. Preserve the existing
ordering exactly: persist, observe, evaluate will, then submit.

- [ ] **Step 4: Move RuntimeManager and reduce index to a barrel**

Create `core/src/runtime/manager.ts` holding `RuntimeManager`, `RuntimeManagerOptions`,
`AgentPluginFactory`, `RuntimeEntry`, `RuntimeResult`, `ChannelRuntimeResult`, the
reload/reset/stop errors, and `assertAssignee`. Reduce `core/src/runtime/index.ts` to
re-exports only. Confirm the barrel still exports every symbol currently imported by
`core/src/service.ts`, `core/src/gateway/index.ts`, and the tests — no importer outside
`runtime/` should need editing.

- [ ] **Step 5: Delete the test-only construction seam**

Delete `createChannelRuntime` from `RuntimeManagerOptions` (line 48) and its call at
line 318, leaving `new ChannelRuntime(options)`. Rewrite
`core/tests/runtime-manager.test.ts` to construct real `ChannelRuntime` instances now
that delivery is separable, removing the factory at line 72 and the state it captured.

- [ ] **Step 6: Verify no behaviour moved**

```bash
yarn workspace koishi-plugin-yesimbot exec vitest run
yarn turbo run check-types --filter=koishi-plugin-yesimbot
yarn turbo run build --filter=koishi-plugin-yesimbot
```

The existing lifecycle tests are the contract for this task: FIFO ordering, delivery
leases, drain, and stop semantics must all still pass unchanged.

- [ ] **Step 7: Commit**

```bash

---

## Task 8: Model Module Consolidation

**Files:**
- Modify: `core/src/model/service.ts` (427 lines, absorbs `config.ts`)
- Modify: `core/src/model/provider.ts` (92 lines, absorbs `schema.ts` and the kept types)
- Delete: `core/src/model/config.ts`, `core/src/model/schema.ts`, `core/src/model/types.ts`
- Modify: `core/src/model/index.ts` (4 lines → complete entry point)
- Modify: `core/src/index.ts:4`, `core/src/service.ts:7`
- Test: `core/tests/model.test.ts`

**Interfaces:**
- Produces: `core/src/model/index.ts` exporting everything any consumer needs, with the
  existing `koishi-plugin-yesimbot/model` surface unchanged: `createProviderPlugin`,
  `BaseProviderConfig`, `createChatModelsSchema`, `createEmbeddingModelsSchema`,
  `ModelService`, `ModelServiceConfig`, `ChatModelConfig`, `EmbeddingModelConfig`, `ModelId`.
- Consumes: nothing from Tasks 1-7.

- [ ] **Step 1: Confirm the external surface before touching anything**

All four packages under `providers/` import only from `koishi-plugin-yesimbot/model`, and
no `plugins/` or `packages/` file imports from `core/src/model/**`. Re-confirm before
editing:

```bash
rg -n "koishi-plugin-yesimbot/model" providers plugins packages
rg -n "from \"\.\./model/|from \"\./model/" core/src core/tests
```

Whatever the first command lists must keep working byte-identically. The second command
lists the deep imports this task removes.

- [ ] **Step 2: Fold `types.ts` into its two real consumers**

Move `ModelId`, `CHAT_MODEL_MODALITIES`, `ChatModelModality`, `ChatModelConfig`,
`EmbeddingModelConfig`, `ChatModelRef`, `isChatModelModality`, `parseModelId`, and
`formatModelId` into `core/src/model/provider.ts`. Delete `EmbeddingModelRef` (types.ts:54,
zero references) and the single-shape `ModelProvider` (types.ts:37) and
`ModelProviderCapabilities` (types.ts:32) interfaces, inlining their shape at the sole
construction site in `createProviderPlugin` (provider.ts:71-86).

- [ ] **Step 3: Fold `config.ts` and `schema.ts` in**

Move `loadModelsConfig`, `writeModelsConfig`, `ModelsConfigData`, `ModelsConfigLoadResult`,
`ChatModelOverride`, and `EmbeddingModelOverride` into `core/src/model/service.ts` —
`ModelService` is their only production consumer. Delete `isModelId` (config.ts:186, zero
references). Move `createChatModelsSchema` and `createEmbeddingModelsSchema` into
`provider.ts`. Delete `ProviderPluginOptions` (provider.ts:23, self-use only). Then delete
`config.ts`, `schema.ts`, and `types.ts`.

- [ ] **Step 4: Complete the barrel**

Rewrite `core/src/model/index.ts` to export the full public surface from the two remaining
modules, keeping every name currently exported so `koishi-plugin-yesimbot/model` is
unchanged. Update `core/src/service.ts:7` to import `ModelService` through the barrel
instead of `./model/service.js`; `core/src/index.ts:4` already uses the barrel.

- [ ] **Step 5: Rewrite the model tests to use the entry point**

In `core/tests/model.test.ts`, replace the three deep imports (lines 10-12) with imports
from `../src/model/index.js`. The `import * as modelConfig` form at line 10 was used to
stub module functions — rebuild those stubs against the barrel, or against `ModelService`
behaviour directly where the stub only existed to reach a private path.

- [ ] **Step 6: Verify core and every provider**

```bash
yarn workspace koishi-plugin-yesimbot exec vitest run tests/model.test.ts
yarn turbo run check-types --filter=koishi-plugin-yesimbot
yarn turbo run build --filter=koishi-plugin-yesimbot
yarn turbo run check-types --filter=@yesimbot/koishi-plugin-provider-openai
yarn turbo run check-types --filter=@yesimbot/koishi-plugin-provider-anthropic
yarn turbo run check-types --filter=@yesimbot/koishi-plugin-provider-deepseek
yarn turbo run check-types --filter=@yesimbot/koishi-plugin-provider-google
```

All four provider type-checks must pass without any edit to `providers/`. If one fails, the
barrel lost a name and must regain it — do not modify the provider package.

- [ ] **Step 7: Commit**

```bash
git add core/src/model core/src/index.ts core/src/service.ts core/tests/model.test.ts
git commit -m "refactor(core): merge model module into service and provider"
```

---

## Task 9: Remaining Housekeeping And Documentation

**Files:**
- Modify: `core/src/media/index.ts:141-255,273-280`
- Delete: `core/src/path.ts`
- Modify: `core/src/model/service.ts`, `core/src/runtime/manager.ts`, `core/src/service.ts` (inline `resolveBasePath`)
- Modify: `AGENTS.md`
- Modify: `core/README.md`
- Test: `core/tests/image-freeze.test.ts`

**Interfaces:**
- Consumes: the module layout produced by Tasks 7 and 8 (docs must describe the final state).
- Produces: no new interface.

- [ ] **Step 1: Turn the image freezer into a class**

Convert `createImageFreezer` (media/index.ts:141-255) into a class owning `imageCount`,
`totalBytes`, `active`, and the `waiting` queue as private fields, with `freezeImage` as a
method. Keep the exported factory name as a thin wrapper if any call site depends on it,
otherwise update the call sites. Behaviour, limits, and concurrency must not change.

- [ ] **Step 2: Delete the unreachable branch**

In `reportAssetFailure` (media/index.ts:273-280), both arms of the `catch` return, so the
second `return` is dead. Reduce the catch body to a single statement.

- [ ] **Step 3: Inline `resolveBasePath` and delete the module**

`core/src/path.ts` is five lines wrapping `path.resolve` with an `isAbsolute` check. Inline
it at its three call sites — `model/service.ts:5`, the runtime module that now owns the
former `runtime/index.ts:33` usage, and `service.ts:8` — then delete the file.

- [ ] **Step 4: Correct `AGENTS.md`**

Fix every statement the repository contradicts:
- Remove `platforms/*` from the project-overview bullet list and remove the
  `platforms/onebot/` row from the workspace package table. The `platforms/` directory does
  not exist; the OneBot adapter lives at `core/src/platforms/onebot/`. State that
  `ctx.yesimbot.registerResolver()` remains the extension point for third-party platform
  packages.
- Remove the `plugins/sticker/` row (`koishi-plugin-yesimbot-sticker`) and its mention in
  the capability plugin list; the package is deleted.
- Replace the `core/src/runtime/index.ts` descriptions with the split modules from Task 7
  (`manager.ts`, `channel.ts`, `delivery.ts`, `serial-queue.ts`), and update the Context
  Files section accordingly.
- Update the persisted-record description: `elements` is the sole structured message field
  and is persisted sealed; there is no frozen `text` on a Message; `EventRecord` keeps
  `eventType` and `text`; `schemaVersion` is 3.
- Update the `model/` context entry for the two-file layout.

- [ ] **Step 5: Update `core/README.md`**

Update the message-persistence paragraph (no `text` on messages, sealed `elements`,
schema version 3), the reply configuration section (`reply.segmentation` removed;
`reply.pacing` is `charactersPerSecond` + `maxTotalDelayMs`), and the runtime paragraph
that names `runtime/index.ts` as holding both owners.

- [ ] **Step 6: Run the full pipeline**

```bash
yarn lint
yarn fmt:check
yarn check-types
yarn build
yarn test
```

Record any failure explicitly. Do not claim completion on a partial run, and do not
reconcile failures by editing tests to match broken behaviour.

- [ ] **Step 7: Commit**

```bash
git add core/src/media/index.ts core/src/service.ts core/src/model/service.ts \
  core/src/runtime AGENTS.md core/README.md core/tests/image-freeze.test.ts
git rm core/src/path.ts
git commit -m "chore(core): housekeeping cleanups and documentation corrections"
```
````
git add core/src/runtime core/tests
git commit -m "refactor(core): split runtime into manager, channel, and delivery modules"
```
git commit -m "refactor(core): validate only at session ingress and jsonl read-back"
```