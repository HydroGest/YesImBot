# Brainstorm: Reimplement Core on Agent Runtime

## Background

Athena already has an experimental `@yesimbot/agent-runtime` package that owns the generic agent loop, message-centered history, turn lifecycle, plugin hooks, tool execution, state, and storage contracts. The next step is to reimplement `core` (`koishi-plugin-yesimbot`) as a thinner Koishi host adapter on top of that runtime.

The current minimal `core` prototype proves the basic path:

- resolve a chat model from the Koishi model registry;
- create one agent runtime per channel;
- convert Koishi sessions into runtime custom messages;
- read `AGENTS.md` and `PERSONA.md`;
- inject system instructions;
- append ordinary group messages;
- send direct or mentioned messages into the agent;
- render assistant text back to Koishi.

The first production-oriented version should stabilize this shape without restoring the old, heavy core architecture.

## Confirmed First-Version Scope

The first version includes only:

- Koishi plugin startup and configuration.
- Model registration and model selection.
- Per-channel runtime creation.
- Reading `AGENTS.md` and optional `PERSONA.md`.
- Converting Koishi text content into a runtime custom message.
- Appending ordinary group messages.
- Sending direct messages and bot mentions, then rendering assistant text replies.
- Minimal error logging and a generic development-time error reply.
- Disposing runtime instances.

The first version may also include the minimal persistence and reset behavior discussed later in this brainstorm: per-channel JSONL storage and current-channel reset.

## Core Extension Direction

The initial question was whether `core` should keep its own extension system or rely only on `agent-runtime` plugins.

Three approaches were considered:

- Keep core extensions only at the Koishi/platform layer.
- Let Koishi extensions bridge platform APIs and runtime plugins.
- Keep only a lifecycle shell with almost no extension capability.

The chosen direction is a lightweight bridge:

- Extension packages remain normal Koishi plugins managed by Koishi.
- `core` does not introduce a heavy `CoreExtension` lifecycle.
- The main `ctx.yesimbot` service exposes a small registration API for per-channel runtime plugin factories.
- Runtime behavior changes still go through `AgentPlugin`.
- Platform APIs are accessed by the Koishi plugin itself and can be captured by the plugin factory closure.

Confirmed API shape:

```ts
interface YesImBotService {
  registerAgentPlugin(factory: AgentPluginFactory): () => void;
}

type AgentPluginFactory = (context: ChannelAgentContext) => AgentPlugin;

interface ChannelAgentContext {
  channel: {
    platform: string;
    selfId: string;
    channelId: string;
    type: "private" | "group";
  };
  logger: Logger;
}
```

Multiple plugins are registered by calling `registerAgentPlugin()` multiple times. A factory returns exactly one `AgentPlugin`; it does not return an array. `core` must not register global `AgentPlugin` singletons because that would risk cross-channel state leaks.

Plugin registration and unregistration affect only channel runtimes created after the registration change. Existing channel runtimes are not dynamically rebuilt. Plugin changes take effect after restart or future explicit reload support.

## Channel Runtime Identity

Each channel runtime is isolated by:

```text
platform + selfId + channelId
```

The channel `type` (`private` or `group`) is metadata and does not participate in the runtime key.

This means:

- one group channel has one runtime per bot identity;
- one direct channel has one runtime per bot identity;
- multiple bot identities do not share context;
- group history is not separated by user;
- thread or topic separation is out of scope.

## Platform Message Model and Flow

The first version uses a single custom runtime message type for Koishi channel messages.

Candidate shape:

```ts
interface ChannelMessage {
  version: 1;
  kind: "message";
  id: string;
  timestamp: number;
  author: {
    id: string;
    name?: string;
    isSelf?: boolean;
  };
  message: {
    id: string;
    content: string;
  };
  quote?: {
    id: string;
  };
}
```

Confirmed message rules:

- All non-self messages enter runtime history.
- Ordinary group messages use `append()`.
- Direct messages and messages mentioning the bot use `send()`.
- Bot self messages are ignored by default.
- First version only handles Koishi `session.content` as text content.
- Koishi message element strings are preserved exactly.
- Bot mention elements are not stripped.
- Images, files, audio, structured element parsing, and multimodal conversion are out of scope.

The model-facing message format can be:

```text
[sender]: Koishi message content
```

The system prompt should explain that message content may contain Koishi message elements such as `<at/>`.

## Reply Rendering

The first version treats assistant output as text.

Confirmed rendering rules:

- Iterate through `TurnResult.messages`.
- Send every assistant message with non-empty text content.
- Preserve generation order.
- Do not send tool messages.
- Do not send empty assistant messages.
- Do not treat Koishi element output as a first-class product feature.

The system prompt should lightly say that the agent outputs plain text. It should not over-emphasize XML, HTML, or Koishi element restrictions.

## Append and Join Semantics During Active Turns

The distinction between `append` and busy `join` is important.

Confirmed conceptual semantics:

- `append()` records an observed event.
- `send(..., { ifBusy: "join" })` records explicit user input that should join the active turn.
- Both should be visible to the active turn at a safe model boundary.
- They do not have the same response-triggering meaning.

For group chat, this matters because the agent should continue observing the room while it is thinking or using tools. If a group message is appended during an active turn and the agent only sees it in a later top-level turn, behavior feels temporally split. It can also pressure later systems to reorder messages by timestamp, which would violate append-only ordering and destabilize prompt caching.

The desired runtime behavior is:

```text
active turn starts
ordinary group message append() arrives
runtime persists it in append-only order
next safe model boundary includes the appended observation
```

Likewise:

```text
active turn starts
direct or mentioned message send(ifBusy: "join") arrives
runtime persists it in append-only order
next safe model boundary includes it as joined explicit input
```

This should be addressed in `agent-runtime`, not by `core` bypassing runtime semantics.

## Prompt Injection Strategy

The first idea was to concatenate all prompt sources into one `systemPrompt` string. This was rejected for first-version design because several model providers cache at message-block granularity. Combining core instructions, channel context, persona, agent guidelines, and plugin instructions into one block would cause unnecessary cache invalidation.

Confirmed first-version direction:

- `systemPrompt` contains only core and channel context.
- `AGENTS.md` and `PERSONA.md` are injected as additional system messages through `transformMessages()`.
- No `developer` role is introduced.
- No separate `extendModelPreamble` or prompt-block API is introduced in the first version.
- Plugin prompt injection is left to plugins; core does not define a special plugin prompt API.

Confirmed order:

```text
core + channel system prompt
AGENTS.md system message
PERSONA.md system message
plugin-defined instruction messages, if any
conversation messages
```

Known side effect:

- Because `AGENTS.md` and `PERSONA.md` are injected via `transformMessages()`, they flow through the same transform pipeline as other messages.
- Compact, truncation, or compatibility plugins may modify, remove, compress, or reorder them unless those plugins explicitly preserve system instruction messages.
- This is accepted for the first version to keep the runtime API small.
- A future runtime can introduce separate prompt preamble messages that are isolated from history transforms.

## Model Boundary

Confirmed model boundary:

- Provider plugins register models with `ctx["yesimbot.model"]`.
- `core` resolves `config.chatModel` through `ModelService`.
- `core` passes the resolved `ai-sdk` `LanguageModel` to `createAgent()`.
- `agent-runtime` does not own model registry behavior.

Out of scope:

- runtime model registry;
- hot model switching;
- per-channel model selection;
- fallback model;
- retry model;
- embedding integration;
- automatic strategy changes based on model metadata.

Model selection is resolved at startup or first channel runtime creation. Configuration and provider changes take effect after restart.

## Storage and Session Boundary

The first version should use persistent JSONL storage rather than memory-only storage.

Confirmed storage scope:

- one JSONL file per channel runtime;
- append-only file format;
- implements the minimal `AgentStorage` contract: `append`, `read`, and `clear`;
- no indexes;
- no pagination;
- no migration framework;
- no compaction by default;
- no session manager;
- no old `packages/agent` session compatibility.

File path strategy:

```text
basePath/
  sessions/
    sanitize(`${platform}-${selfId}-${channelId}.jsonl`)
```

The filename is generated by concatenating `platform`, `selfId`, and `channelId`, then filtering special characters with `sanitize-filename`. Base64 encoding is not used.

Known risk:

- sanitized names can theoretically collide.
- This is accepted in the first version unless implementation finds a cheap, simple fallback.

## Reset and Interrupt

The first version needs channel reset.

Confirmed reset scope:

- reset only the current channel;
- require administrator authority;
- no cross-channel reset argument;
- no global reset.

The service API uses a target object rather than a full Koishi session:

```ts
interface YesImBotService {
  resetChannel(target: ChannelRuntimeTarget): Promise<void>;
}

interface ChannelRuntimeTarget {
  platform: string;
  selfId: string;
  channelId: string;
}
```

Reset requires runtime interrupt support:

```ts
agent.interrupt(reason?: string): Promise<void>;
```

Desired interrupt semantics:

- no-op when no active turn exists;
- abort the active turn when possible;
- settle `waitTurn(turnId)` with `status: "aborted"`;
- emit and persist a `turn.aborted` event;
- do not roll back already persisted messages;
- do not clear storage;
- do not stop the runtime.

Reset is composed as:

```text
interrupt active turn
stop runtime
clear JSONL storage
remove runtime from cache
next message lazily creates a new runtime
```

## Service API

Confirmed main service name:

```ts
ctx.yesimbot
```

The model service remains:

```ts
ctx["yesimbot.model"]
```

Minimal service API:

```ts
interface YesImBotService {
  registerAgentPlugin(factory: AgentPluginFactory): () => void;
  resetChannel(target: ChannelRuntimeTarget): Promise<void>;
}
```

The first version should not expose runtime handles or direct message operations:

- no `getRuntime()`;
- no `createRuntime()`;
- no `send()`;
- no `append()`.

External Koishi plugins should influence runtime behavior through `registerAgentPlugin()` rather than bypassing the core message flow.

## Built-In Plugin Ordering

Confirmed order:

```text
core built-in plugins first
external registered plugins afterward, in registration order
```

Core does not introduce its own plugin priority system. If finer ordering is needed, use the existing `AgentPlugin.enforce` mechanism from `agent-runtime`.

## Configuration

Confirmed first-version configuration:

```ts
interface Config {
  basePath: string;
  chatModel: string;
  logLevel?: number;
}
```

`basePath` is the unified data root for:

- `AGENTS.md`;
- `PERSONA.md`;
- `models.json`;
- `sessions/`.

Relative `basePath` values are resolved against Koishi `ctx.baseDir`. Absolute paths are used as-is.

## Error Handling and Debugging

Confirmed behavior:

- direct or mentioned message failures can send a generic error reply to the current channel;
- ordinary group append failures only log errors;
- the generic channel error reply is a development debugging behavior, not a product feature;
- more detailed information goes to the logger, controlled by `logLevel`;
- no new debug configuration is added in the first version.

Debug output can include tool events, runtime events, provider errors, and explicit provider-returned reasoning metadata when available. Hidden chain-of-thought must not be exposed as a logged or sent artifact.

## Validation Expectations

The first version should prove:

- a provider plugin can register a chat model and core can resolve it;
- each `platform + selfId + channelId` gets an isolated runtime;
- non-self ordinary group messages are appended to that channel JSONL without triggering replies;
- direct and mentioned messages are sent to the runtime and all non-empty assistant text messages are sent back;
- active-turn append and join semantics are handled at runtime safe boundaries;
- `AGENTS.md` and `PERSONA.md` are read from the unified `basePath` and injected in the confirmed order;
- external Koishi plugins can register per-channel `AgentPlugin` factories through `ctx.yesimbot`;
- JSONL storage persists and reads channel history across restart;
- `yesimbot.reset` resets only the current channel;
- dispose interrupts and stops all known runtimes;
- failures follow the confirmed logging and generic reply behavior;
- configuration remains limited to `basePath`, `chatModel`, and `logLevel`.

## Explicit Non-Goals

The first version must not include:

- restoration of the old core extension system;
- legacy plugin migration;
- multimodal parsing;
- complex response-willingness models;
- a prompt preamble API;
- developer role support;
- model hot switching;
- fallback or retry models;
- per-channel model configuration;
- default compaction;
- long-term memory retrieval;
- old session data migration;
- direct runtime exposure through `ctx.yesimbot`;
- plugin hot reload for already-created runtimes;
- JSONL indexing, pagination, schema migration, or compression.
