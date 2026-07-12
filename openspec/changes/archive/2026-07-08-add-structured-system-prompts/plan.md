# Structured System Prompts Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or
> superpowers:executing-plans to implement this plan task-by-task. This plan is
> intentionally implementation-ready, but the current session stops at planning.

**Goal:** Add append-only structured system prompt blocks to
`@yesimbot/agent-runtime`, keep the legacy string hook compatible, and migrate
all official prompt-extending plugins.

**Architecture:** The runtime keeps `extendSystemPrompt(prompt: string, context)`
as the legacy whole-string reducer. A new `appendSystemPrompt(context)` hook
collects additional system blocks after legacy prompt resolution. The agent maps
legacy-only output to AI SDK `system: string`, and maps structured output to
`system: SystemModelMessage[]` without injecting prompt blocks into model
`messages`.

**Tech Stack:** TypeScript, AI SDK 6, Yarn 4, Vitest, OpenSpec.

## Global Constraints

- Use `yarn`, not `npm` or `pnpm`.
- Prefix shell commands with `rtk`.
- Use TDD: write the failing test, run it and confirm the expected failure, then
  implement the minimal code.
- Keep the change scoped to `agent-runtime`, core prompt integration, official
  prompt-extending plugins, tests, and this OpenSpec change.
- Do not revert pre-existing deleted files under `core/src/extension/*`; they
  are unrelated worktree state.
- Do not add deletion, replacement, reordering, ids, or priority semantics for
  structured system prompt blocks.

---

## Task 1: Runtime Plugin API And Host Composition

**Files:**
- Modify: `packages/agent-runtime/src/types/plugin.ts`
- Modify: `packages/agent-runtime/src/plugin.ts`
- Test: `packages/agent-runtime/tests/plugin.test.ts`

**Interfaces:**
- Produces: `SystemPromptBlock`, `SystemPromptAppend`, and
  `AgentPlugin.appendSystemPrompt?(context: PromptContext): Awaitable<SystemPromptAppend | void>`.
- Produces: `PluginHostHelpers.appendSystemPrompt(context: PromptContext):
  Promise<SystemModelMessage[]>`.
- Preserves: `AgentPlugin.extendSystemPrompt?(prompt: string, context:
  PromptContext): Awaitable<string | void>`.

- [ ] **Step 1: Add failing plugin-host tests**

Append tests to `packages/agent-runtime/tests/plugin.test.ts`:

```ts
it("appends structured system prompt blocks in plugin order after legacy prompt hooks", async () => {
  const runtime = createRuntime();
  const host = createPluginHost({
    runtime,
    plugins: [
      {
        name: "legacy",
        extendSystemPrompt(prompt) {
          return `${prompt}\nlegacy`;
        },
      },
      {
        name: "structured-a",
        appendSystemPrompt() {
          return "structured a";
        },
      },
      {
        name: "structured-b",
        appendSystemPrompt() {
          return [
            { role: "system", content: "structured b", providerOptions: { mock: { cache: true } } },
            "structured c",
          ];
        },
      },
    ],
  });

  await host.init();

  const context = {
    runtime: { id: runtime.id },
    channel: runtime.channel,
    state: runtime.state,
  };

  await expect(host.helpers.extendSystemPrompt("base", context)).resolves.toBe("base\nlegacy");
  await expect(host.helpers.appendSystemPrompt(context)).resolves.toEqual([
    { role: "system", content: "structured a" },
    { role: "system", content: "structured b", providerOptions: { mock: { cache: true } } },
    { role: "system", content: "structured c" },
  ]);
});

it("keeps structured system prompt append hooks fail-open", async () => {
  const runtime = createRuntime();
  const seen: string[] = [];

  runtime.channel.subscribe("internal", (event) => {
    if (event.type === "plugin.error") {
      seen.push(`${event.plugin}:${event.error.name}:${event.error.message}`);
    }
  });

  const host = createPluginHost({
    runtime,
    plugins: [
      {
        name: "broken-structured",
        appendSystemPrompt() {
          throw new Error("bad structured prompt");
        },
      },
      {
        name: "later-structured",
        appendSystemPrompt() {
          return "later";
        },
      },
    ],
  });

  await host.init();

  const result = await host.helpers.appendSystemPrompt({
    runtime: { id: runtime.id },
    channel: runtime.channel,
    state: runtime.state,
  });

  expect(result).toEqual([{ role: "system", content: "later" }]);
  expect(seen).toEqual(["broken-structured:Error:bad structured prompt"]);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
rtk yarn workspace @yesimbot/agent-runtime exec vitest run tests/plugin.test.ts
```

Expected: FAIL because `appendSystemPrompt` does not exist on `AgentPlugin` and
`PluginHostHelpers`.

- [ ] **Step 3: Add runtime public types**

In `packages/agent-runtime/src/types/plugin.ts`, import `SystemModelMessage` and
add the new types near `AgentPluginRuntime`:

```ts
import type { ModelMessage, SystemModelMessage } from "@ai-sdk/provider-utils";

export type SystemPromptBlock = string | SystemModelMessage;
export type SystemPromptAppend = SystemPromptBlock | readonly SystemPromptBlock[];
```

Add the hook to `AgentPlugin` without changing the legacy hook:

```ts
appendSystemPrompt?(context: PromptContext): Awaitable<SystemPromptAppend | void>;
```

- [ ] **Step 4: Implement plugin host helper**

In `packages/agent-runtime/src/plugin.ts`, import the new types:

```ts
import type { SystemPromptAppend } from "./types/plugin.js";
import type { ModelMessage, SystemModelMessage } from "ai";
```

Add to `PluginHostHelpers`:

```ts
appendSystemPrompt(context: PromptContext): Promise<SystemModelMessage[]>;
```

Add a small normalizer near `createPluginHost`:

```ts
function normalizeSystemPromptAppend(value: SystemPromptAppend): SystemModelMessage[] {
  const blocks = Array.isArray(value) ? value : [value];
  return blocks.map((block) =>
    typeof block === "string" ? { role: "system", content: block } : block,
  );
}
```

Add the helper beside `extendSystemPrompt`:

```ts
async appendSystemPrompt(context) {
  const current: SystemModelMessage[] = [];

  for (const plugin of activePlugins) {
    const hook = plugin?.appendSystemPrompt;
    if (!hook) continue;

    try {
      const next = await hook(context);
      if (next !== undefined) current.push(...normalizeSystemPromptAppend(next));
    } catch (error) {
      emitPluginError(plugin.name, error);
    }
  }

  return current;
},
```

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```bash
rtk yarn workspace @yesimbot/agent-runtime exec vitest run tests/plugin.test.ts
```

Expected: PASS.

---

## Task 2: Agent System Input Resolution

**Files:**
- Modify: `packages/agent-runtime/src/agent.ts`
- Test: create `packages/agent-runtime/tests/system-prompt.test.ts`

**Interfaces:**
- Consumes: `PluginHostHelpers.extendSystemPrompt(prompt, context)` and
  `PluginHostHelpers.appendSystemPrompt(context)`.
- Produces: `resolveSystemPrompt()` result compatible with AI SDK
  `system?: string | SystemModelMessage | Array<SystemModelMessage>`.

- [ ] **Step 1: Add failing model-call tests**

Create `packages/agent-runtime/tests/system-prompt.test.ts`:

```ts
import { streamText } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAgent } from "../src/agent.js";
import { createUserMessage } from "../src/message.js";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn(() => ({
      fullStream: (async function* () {})(),
    })),
  };
});

const streamTextMock = vi.mocked(streamText);

describe("system prompt resolution", () => {
  beforeEach(() => {
    streamTextMock.mockClear();
  });

  it("passes structured prompt blocks through the ai-sdk system option", async () => {
    const agent = createAgent({
      model: {} as never,
      systemPrompt: "base",
      plugins: [
        {
          name: "legacy",
          extendSystemPrompt(prompt) {
            return `${prompt}\nlegacy`;
          },
        },
        {
          name: "structured",
          appendSystemPrompt() {
            return [
              "structured a",
              { role: "system", content: "structured b", providerOptions: { mock: { cache: true } } },
            ];
          },
        },
      ],
    });

    const turnId = agent.send(createUserMessage("hello"));
    await agent.waitTurn(turnId);

    expect(streamTextMock).toHaveBeenCalledOnce();
    expect(streamTextMock.mock.calls[0]![0].system).toEqual([
      { role: "system", content: "base\nlegacy" },
      { role: "system", content: "structured a" },
      { role: "system", content: "structured b", providerOptions: { mock: { cache: true } } },
    ]);
    expect(streamTextMock.mock.calls[0]![0].messages).toEqual([
      expect.objectContaining({ role: "user", content: "hello" }),
    ]);
  });

  it("preserves string system output when no structured blocks exist", async () => {
    const agent = createAgent({
      model: {} as never,
      systemPrompt: "base",
      plugins: [
        {
          name: "legacy",
          extendSystemPrompt(prompt) {
            return `${prompt}\nlegacy`;
          },
        },
      ],
    });

    const turnId = agent.send(createUserMessage("hello"));
    await agent.waitTurn(turnId);

    expect(streamTextMock.mock.calls[0]![0].system).toBe("base\nlegacy");
  });

  it("allows structured prompt blocks without a base system prompt", async () => {
    const legacy = vi.fn();
    const agent = createAgent({
      model: {} as never,
      plugins: [
        {
          name: "structured-only",
          extendSystemPrompt: legacy,
          appendSystemPrompt() {
            return "structured only";
          },
        },
      ],
    });

    const turnId = agent.send(createUserMessage("hello"));
    await agent.waitTurn(turnId);

    expect(legacy).not.toHaveBeenCalled();
    expect(streamTextMock.mock.calls[0]![0].system).toEqual([
      { role: "system", content: "structured only" },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
rtk yarn workspace @yesimbot/agent-runtime exec vitest run tests/system-prompt.test.ts
```

Expected: FAIL because `appendSystemPrompt` is not yet included in agent system
resolution and/or because TypeScript compilation rejects the missing hook until
Task 1 is complete.

- [ ] **Step 3: Implement system input resolution**

In `packages/agent-runtime/src/agent.ts`, import `SystemModelMessage`:

```ts
import {
  hasToolCall,
  isLoopFinished,
  LanguageModel,
  streamText,
  type LanguageModelUsage,
  type SystemModelMessage,
} from "ai";
```

Change `resolveSystemPrompt` to return structured input:

```ts
  const resolveSystemPrompt = async (
    turnId: string,
    signal?: AbortSignal,
  ): Promise<string | SystemModelMessage[] | undefined> => {
    const promptContext: PromptContext = {
      ...runtimeContext,
      turnId,
      signal,
    };
    const basePrompt =
      typeof systemPrompt === "function" ? await systemPrompt(promptContext) : systemPrompt;

    const legacyPrompt =
      basePrompt === undefined
        ? undefined
        : await pluginHost.helpers.extendSystemPrompt(basePrompt, promptContext);
    const appended = await pluginHost.helpers.appendSystemPrompt(promptContext);

    if (appended.length === 0) {
      return legacyPrompt;
    }

    return legacyPrompt === undefined
      ? appended
      : [{ role: "system", content: legacyPrompt }, ...appended];
  };
```

- [ ] **Step 4: Run runtime tests to verify GREEN**

Run:

```bash
rtk yarn workspace @yesimbot/agent-runtime exec vitest run tests/plugin.test.ts tests/system-prompt.test.ts
```

Expected: PASS.

---

## Task 3: Core Prompt File Migration

**Files:**
- Modify: `core/src/runtime/prompt.ts`
- Modify: `core/tests/prompt.test.ts`

**Interfaces:**
- Consumes: `AgentPlugin.appendSystemPrompt`.
- Produces: `core.prompt-files` plugin that appends `AGENTS.md` and
  `PERSONA.md` as separate structured system blocks.

- [ ] **Step 1: Update core tests first**

In `core/tests/prompt.test.ts`, replace the existing `extendSystemPrompt` test
with a structured hook assertion:

```ts
const result = await plugin.appendSystemPrompt?.({} as never);

expect(result).toEqual([
  { role: "system", content: "<agents>\nagent rules\n</agents>" },
  { role: "system", content: "<persona>\npersona rules\n</persona>" },
]);
```

Update the missing-file test:

```ts
await expect(plugin.appendSystemPrompt?.({} as never)).resolves.toBeUndefined();
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/prompt.test.ts
```

Expected: FAIL because `core.prompt-files` still implements
`extendSystemPrompt`.

- [ ] **Step 3: Implement core prompt migration**

In `core/src/runtime/prompt.ts`, replace `extendSystemPrompt(prompt)` with:

```ts
      async appendSystemPrompt() {
        const agents = await readPromptFile(options.basePath, "AGENTS.md", options.logger);
        const persona = await readPromptFile(options.basePath, "PERSONA.md", options.logger);
        const blocks = [];

        if (agents) {
          blocks.push(`<agents>\n${agents}\n</agents>`);
        }

        if (persona) {
          blocks.push(`<persona>\n${persona}\n</persona>`);
        }

        return blocks.length > 0 ? blocks : undefined;
      },
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/prompt.test.ts tests/service.test.ts
```

Expected: PASS.

---

## Task 4: Official Plugin Prompt Migration

**Files:**
- Modify: `plugins/workspace/src/index.ts`
- Modify: `plugins/workspace/tests/plugin.test.ts`
- Modify: `plugins/memos-client/src/index.ts`
- Modify: `plugins/memos-client/tests/plugin.test.ts`
- Modify: `plugins/skill/src/index.ts`
- Modify: `plugins/search-service/src/index.ts`

**Interfaces:**
- Consumes: `AgentPlugin.appendSystemPrompt`.
- Produces: official plugins that use structured system prompt append blocks
  instead of legacy whole-string prompt mutation.

- [ ] **Step 1: Update workspace and MemOS tests first**

In `plugins/workspace/tests/plugin.test.ts`, change prompt retrieval to:

```ts
const prompt = await plugin?.appendSystemPrompt?.({} as never);
const promptText = Array.isArray(prompt) ? prompt.join("\n") : String(prompt ?? "");
```

Keep the existing `toContain` assertions against `promptText`.

In `plugins/memos-client/tests/plugin.test.ts`, change prompt retrieval to:

```ts
const prompt = await runtimePlugin.appendSystemPrompt?.({} as never);
const promptText = Array.isArray(prompt) ? prompt.join("\n") : String(prompt ?? "");
```

Keep the existing `toContain` and `not.toContain("mpg-secret")` assertions
against `promptText`.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot-workspace exec vitest run tests/plugin.test.ts
rtk yarn workspace koishi-plugin-yesimbot-memos-client exec vitest run tests/plugin.test.ts
```

Expected: FAIL because the plugins still expose `extendSystemPrompt`.

- [ ] **Step 3: Migrate workspace plugin**

In `plugins/workspace/src/index.ts`, replace:

```ts
        extendSystemPrompt: async (prompt) => {
          const workspace = await this.getOrCreateWorkspace(context.channel);
          return `${prompt}\n\n${formatWorkspacePrompt(workspace)}`;
        },
```

with:

```ts
        appendSystemPrompt: async () => {
          const workspace = await this.getOrCreateWorkspace(context.channel);
          return formatWorkspacePrompt(workspace);
        },
```

- [ ] **Step 4: Migrate MemOS plugin**

In `plugins/memos-client/src/index.ts`, replace:

```ts
        extendSystemPrompt: async (prompt) => {
          return `${prompt}\n\n${formatMemosPrompt()}`;
        },
```

with:

```ts
        appendSystemPrompt: async () => {
          return formatMemosPrompt();
        },
```

- [ ] **Step 5: Migrate skill plugin**

In `plugins/skill/src/index.ts`, replace:

```ts
        extendSystemPrompt: (prompt) => {
          const skillPrompt = formatSkillsForPrompt(this.skills);
          return `${prompt}\n\n${skillPrompt}`;
        },
```

with:

```ts
        appendSystemPrompt: () => {
          return formatSkillsForPrompt(this.skills);
        },
```

- [ ] **Step 6: Migrate search-service plugin**

In `plugins/search-service/src/index.ts`, replace:

```ts
        extendSystemPrompt(prompt) {
          return prompt + `\n\n` + formatSearchPrompt(backend.name, hasScrape);
        },
```

with:

```ts
        appendSystemPrompt() {
          return formatSearchPrompt(backend.name, hasScrape);
        },
```

- [ ] **Step 7: Run migrated plugin tests**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot-workspace exec vitest run tests/plugin.test.ts
rtk yarn workspace koishi-plugin-yesimbot-memos-client exec vitest run tests/plugin.test.ts
rtk yarn workspace koishi-plugin-yesimbot-skill exec vitest run tests/format-skills.test.ts
```

Expected: PASS. `search-service` has no test script; cover it with type-check in
Task 5.

---

## Task 5: Type-Check, Specs, And Final Verification

**Files:**
- Modify: `openspec/changes/add-structured-system-prompts/tasks.md`

**Interfaces:**
- Consumes: all previous task outputs.
- Produces: verified implementation and checked-off OpenSpec tasks.

- [ ] **Step 1: Run targeted package type checks**

Run:

```bash
rtk yarn turbo run check-types --filter=@yesimbot/agent-runtime
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-workspace
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-memos-client
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-skill
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-search-service
```

Expected: all commands exit 0.

- [ ] **Step 2: Run targeted tests**

Run:

```bash
rtk yarn workspace @yesimbot/agent-runtime exec vitest run tests/plugin.test.ts tests/system-prompt.test.ts
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/prompt.test.ts tests/service.test.ts
rtk yarn workspace koishi-plugin-yesimbot-workspace exec vitest run tests/plugin.test.ts
rtk yarn workspace koishi-plugin-yesimbot-memos-client exec vitest run tests/plugin.test.ts
rtk yarn workspace koishi-plugin-yesimbot-skill exec vitest run tests/format-skills.test.ts
```

Expected: all commands exit 0.

- [ ] **Step 3: Validate OpenSpec**

Run:

```bash
rtk openspec validate add-structured-system-prompts
```

Expected: `Change 'add-structured-system-prompts' is valid`.

- [ ] **Step 4: Mark implementation tasks complete**

Only after the implementation and verification above pass, update
`openspec/changes/add-structured-system-prompts/tasks.md` by changing each
completed checkbox from `- [ ]` to `- [x]`.

- [ ] **Step 5: Review final diff**

Run:

```bash
rtk git diff -- packages/agent-runtime core plugins/workspace plugins/memos-client plugins/skill plugins/search-service openspec/changes/add-structured-system-prompts
```

Expected: diff is scoped to the runtime prompt API, official plugin prompt
migration, tests, and this OpenSpec change.
