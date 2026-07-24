# @yesimbot/agent-runtime

`@yesimbot/agent-runtime` is Athena's message runtime. It owns the generic loop around messages, model calls, tools, plugins, state, events, and storage. It does not depend on Koishi; the Koishi-facing package is `koishi-plugin-yesimbot` in `core/`.

## What It Does

- Stores runtime entries through an append-only `AgentStorage`.
- Separates observation from generation: `append()` records a message, `send()` starts a model turn.
- Runs AI SDK `LanguageModel`s with runtime tools.
- Emits typed internal events through `agent.channel`.
- Lets plugins contribute stable tools and system blocks, transform messages, project custom messages, and observe turns.
- Provides optional runtime plugins from `@yesimbot/agent-runtime/plugins`.

## Install Context

Inside this monorepo, use the workspace package:

```ts
import { createAgent, createUserMessage } from "@yesimbot/agent-runtime";
```

The package exports both ESM and CommonJS builds from `dist/`, plus a `./plugins` subpath for built-in plugins.

## Create An Agent

```ts
import { createAgent, createUserMessage } from "@yesimbot/agent-runtime";

const agent = createAgent({
  id: "demo",
  model,
  systemPrompt: "You are a concise assistant.",
});

for await (const event of agent.run(createUserMessage("hello"))) {
  if (event.type === "message.appended" && event.message.role === "assistant") {
    console.log(event.message.content);
  }
}
```

`model` is an AI SDK `LanguageModel`. Provider packages in this repo adapt OpenAI, Anthropic, DeepSeek, and Google models for the Koishi core.

## Core API

| Method                    | Purpose                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `init()`                  | Initializes plugins and emits `agent.init`. Usually called automatically. |
| `append(message)`         | Records an observation without starting a model turn.                     |
| `send(message, options?)` | Enqueues a turn and returns a `turnId`.                                   |
| `run(message, options?)`  | Enqueues a turn and returns a turn-scoped async event stream.             |
| `wait(options?)`          | Resolves when no turn is active or queued; returns `void`.                |
| `interrupt(reason?)`      | Aborts the active turn, if any.                                           |
| `clear()`                 | Clears storage.                                                           |
| `stop()`                  | Stops active plugins and emits `agent.stop`.                              |

`send()` supports `ifBusy: "defer" | "join" | "reject"`. The Koishi core uses `"join"` when a channel is already in a turn.

## Messages

All runtime messages carry a top-level `id` and `timestamp`.

```ts
const message = createUserMessage("hello", {
  id: "platform-message-id",
  timestamp: Date.now(),
});
```

Use custom messages for structured observations that should not go to the model by default. A plugin can project them with `toModelMessages`.

```ts
import { createCustomMessage, type CustomMessageBase } from "@yesimbot/agent-runtime";

declare module "@yesimbot/agent-runtime" {
  interface AgentCustomMessages {
    "example.note": CustomMessageBase<"example.note", { text: string }>;
  }
}

const note = createCustomMessage("example.note", {
  text: "visible only if a plugin projects it",
});
```

## Turns And Events

Use `wait()` when you only need to wait until the runtime is idle:

```ts
agent.send(createUserMessage("status"));
await agent.wait();
```

Use `run()` when you want turn events:

```ts
for await (const event of agent.run(createUserMessage("stream this"))) {
  if (event.type === "turn.delta") {
    process.stdout.write(event.delta);
  }
}
```

Common internal events include `agent.init`, `message.appended`, `turn.queued`, `turn.start`, `turn.delta`, `turn.step`, `turn.done`, `turn.failed`, `turn.aborted`, `tool.start`, `tool.done`, `tool.failed`, and `plugin.error`.

## Tools

Runtime tools are AI SDK tools with a stable `name` and an Athena execution context.

```ts
import { createAgent, jsonSchema, type AgentTool } from "@yesimbot/agent-runtime";

const echoTool: AgentTool<{ text: string }, { text: string }> = {
  name: "echo",
  description: "Echo text.",
  inputSchema: jsonSchema({
    type: "object",
    properties: {
      text: { type: "string" },
    },
    required: ["text"],
    additionalProperties: false,
  }),
  execute: async ({ text }, context) => {
    console.log(context.turnId);
    return { text };
  },
};

const agent = createAgent({
  model,
  tools: [echoTool],
});
```

Tool names must be unique after runtime tools, plugin tools, initialization-only compatibility extensions, and the optional terminal tool are merged.

## Plugins

Plugins are the main extension boundary. New plugins provide stable tools through `AgentPlugin.tools` and stable instructions through `appendSystemPrompt`. They can also transform appended entries, project custom messages to model messages, wrap tool calls, and observe turn completion.

```ts
import { createAgent, type AgentPlugin } from "@yesimbot/agent-runtime";

const plugin: AgentPlugin = {
  name: "example-plugin",
  tools: [echoTool],
  appendSystemPrompt() {
    return "Prefer short answers.";
  },
  toModelMessages(message) {
    if (message.role !== "custom" || message.type !== "example.note") {
      return undefined;
    }

    return {
      role: "user",
      content: `[note]: ${message.data.text}`,
    };
  },
};

const agent = createAgent({
  model,
  plugins: [plugin],
});
```

Plugin order is `enforce: "pre"` first, then normal plugins, then `enforce: "post"`.
`extendSystemPrompt` and `extendTools` remain deprecated, initialization-only compatibility hooks. New plugins must use `appendSystemPrompt` and `AgentPlugin.tools`; neither compatibility hook runs per turn.

## Storage

Storage is append-only from the runtime's point of view:

```ts
import { createAgent, createMemoryStorage } from "@yesimbot/agent-runtime";

const storage = createMemoryStorage();
const agent = createAgent({
  model,
  storage,
});
```

The core package provides its own JSONL storage for channel sessions. Tool-loop responses are persisted at step boundaries as complete assistant/tool messages, not as streaming deltas.

## Built-In Plugins

Built-in runtime plugins are exported from `@yesimbot/agent-runtime/plugins`.

```ts
import { auditPlugin, compactPlugin } from "@yesimbot/agent-runtime/plugins";
```

- `compactPlugin()` keeps history compaction outside runtime core. It summarizes old messages into custom entries and projects summaries back into model context.
- `auditPlugin()` can persist selected runtime events for diagnostics without changing default message storage.

## Verification

```bash
yarn workspace @yesimbot/agent-runtime exec vitest run
yarn turbo run check-types --filter=@yesimbot/agent-runtime
yarn turbo run build --filter=@yesimbot/agent-runtime
```

For a focused loop, run one test file:

```bash
yarn workspace @yesimbot/agent-runtime exec vitest run tests/turn.test.ts
```
