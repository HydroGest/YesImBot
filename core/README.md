# koishi-plugin-yesimbot

`koishi-plugin-yesimbot` composes the Koishi facade, model registry, live Session
Messenger, channel resources, and the per-channel runtime.

## Public API

`ctx.yesimbot` exposes exactly four domain entries:

- `model`
- `messenger.use()` / `messenger.post()`
- `agent.use()` / `agent.will()`
- `resource.get()` / `resource.use()`

It also exposes the lifecycle `stop()` inherited from the Koishi service.

Named channel plugins implement `setup(scope, bot)` and return an AgentPlugin
snapshot (or `null`). Will plugins implement `match(session)` and
`setup(scope)`, and are selected only while the live Session is available.
Resource readers implement `init(resources, uri, options)`; these are the only
initialization seams exposed to plugin implementations.

`ChannelScope` is the public current-channel context:

```ts
type ChannelScope = { type: "shared"; platform: string; channelId: string } | { type: "direct"; platform: string; selfId: string; channelId: string };
```

Core derives shared `[platform, channelId]` and direct
`[platform, selfId, channelId]` tuples only inside its storage and runtime
implementations. It does not expose a channel identity, tuple key, directory
helper, storage implementation, runtime owner, concrete stores, or delivery
adapter.

The package root exports `Config`, `ChannelScope`, message/event records,
`Translator`, resource contracts, Agent/WillPlugin/WillEngine contracts, model
contracts, and `YesImBotService`. Channel and runtime owners, concrete stores,
and delivery adapters remain private.

## Messenger and runtime

Messenger is the sole live Session ingress. It performs allowlist and shared
assignee admission, resolves one stable ChannelResources owner, invokes one
platform Translator or the built-in pass-through translator, and routes the
resulting Session-free record to the private Runtimes owner. Passive output uses
the originating `Session.send()`; active output uses the matching Bot through
`messenger.post()`.

Translator owns platform-specific image and file persistence while the Session
is live. Messenger owns passive `Session.send()` and active `Bot.sendMessage()`
delivery. A failed delivery calls the producing runtime's explicit `fail()` and
creates one same-channel `delivery.failed` event; it never re-enters `post()`.

Runtimes keeps one private `ChannelRuntime` per persistent tuple: shared
`[platform, channelId]`, direct `[platform, selfId, channelId]`. Shared Bot
changes stop and replace the transient runtime while preserving Channel,
Conversation, resources, and plugin-owned files. There is no public reset,
reload, RuntimeManager, or ChannelRuntime API.

Each ChannelRuntime owns its immutable scope, FIFO, Agent, Will snapshot,
Conversation storage, prompt, model input, output queue, and delivery feedback.
It holds no live Koishi Session. Model, prompt, tools, and AgentPlugin resources
are snapshots for the runtime lifetime and take effect on replacement.

## Model input

Core reads explicit `asset://`, `artifact://`, and registered resource URIs
through `ResourceReader.init()`. When a model supports image input and
`imageInput: true`, images explicitly read with `read` are projected into the
current model call; history is never re-requested from a platform API. Set
`imageInput: false` to disable projection.

## Prompt composition

Core composes its stable system prompt inline in Chinese from `runtime/prompt.ts`:
an identity-neutral constitution, optional `AGENTS.md` operator policy, exactly one
`<persona>` (user `PERSONA.md`, or the inline default persona when missing or
empty), then `<runtime_context>` from `ChannelScope` and the current Bot `selfId`.
On first start `YesImBotService.start()` atomically creates `PERSONA.md` under the
resolved `basePath` with the inline default content only when the file is absent;
user-authored and empty files are never touched. No package prompt resources are
published or loaded, and there is no constitution version constant.

`customInnerThought` (default `true`) controls whether the Core-owned
`<inner_thought>` protocol section is included in the constitution.
Provider-native reasoning parts are preserved by `@yesimbot/agent-runtime`
either way. Message element syntax documentation is injected as a separate
system message. `<message/>` is the sole explicit message boundary; Core never
splits blank-line prose.

## Storage and records

Each channel root is named `shared-<platform>-<channelId>` or
`direct-<platform>-<channelId>-<selfId>` with safely encoded segments. Its
`channel.json` Manifest is authoritative. `sessions/messages.jsonl`, `assets/`,
and plugin-selected child directories live below that root. Trusted plugins
obtain the root through `resource.get(scope)` and select their own child paths.

Records and Manifests are versionless. JSONL read-back parses each line with
`JSON.parse`, skips lines with invalid JSON syntax after logging a warning, and
returns all successfully parsed values without Core schema validation. Core does
not read, migrate, or provide compatibility aliases for prior layouts or
records.

## Configuration

`allowedChannels` is a deny-by-default Messenger boundary. Rules are ORed;
fields within one rule are ANDed. `platform` and `channelId` accept an exact
string or `*`. Omit `isDirect` to match both direct and shared channels.

```yaml
allowedChannels:
  - platform: onebot
    channelId: "123456"
  - platform: discord
    channelId: "dm-123"
    isDirect: true
```

Declare model image capability in the model override in `models.json`. When
`imageInput: true`, the runtime projects only images explicitly read by the
model through `read`. Set `imageInput: false` to disable model image input.
This setting does not impose a download policy on Translators.
