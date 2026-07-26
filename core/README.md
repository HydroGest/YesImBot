# koishi-plugin-yesimbot

The core package provides YesImBot's Koishi facade, Session Gateway, model
registry, split input routing, channel storage, and Runtime ownership.

## Public API

Platform plugins register one `SessionResolver` per Koishi platform through
`ctx.yesimbot.registerResolver()`. The resolver receives the live Session only
inside Gateway handling and returns a Session-free `InputRecord`. Ordinary
messages become `yesimbot.message`; non-message inputs become `yesimbot.event`.

The public facade exposes:

- `model`
- `registerResolver()` and `registerAgentPlugin()`
- `channelIdentity()`, `registerStorage()`, and `ensureStorage()`
- `reload(scope)`, `reset()`, and `stop()`

The package root exports `ChannelScope`, `channelIdentity`, Input contracts,
`SessionResolver`, and `AgentPluginFactory`. Gateway, RuntimeManager,
ChannelRuntime, ChannelStorage, AssetStore, and assignee helpers remain internal.
The only supported code subpath is `./model`.

## Gateway and runtime

`gateway/index.ts` owns the live Session, Resolver invocation, bounded image
freezing, and passive `Session.send()`. A failed passive delivery appends one
same-channel `delivery.failed` Event and does not stop later outputs.

`runtime/index.ts` contains RuntimeManager and ChannelRuntime. RuntimeManager owns
one Runtime entry per `channelIdentity` and coordinates reload, reset, global
stop, and shared-channel assignee revalidation. ChannelRuntime owns one channel
FIFO, Agent, WillEngine, JSONL storage, model stream, delivery leases, and
delivery-failure completion lane. Runtime modules and persisted data never retain
a Koishi Session.

`reload(scope)` drains an active runtime for that channel, preserves persisted
channel data, and recreates the runtime lazily on the next accepted event. It also
refreshes Gateway image freezing and AssetStore persistence with the current
unified multimedia policy.

## Configuration migration

### Channel allowlist

`allowedChannels` is a breaking, deny-by-default Gateway boundary. Rules are
ORed; fields in one rule are ANDed. `platform` and `channelId` accept exact
strings or `*`. Omitting `isDirect` matches both direct and shared channels;
use an explicit boolean when the rule must select one kind of channel.

An omitted `allowedChannels` value and `allowedChannels: []` both admit no
external Sessions. Add at least one rule before upgrading. These examples are
independent rules for common scopes:

```yaml
# One exact channel, directness is intentionally unrestricted.
allowedChannels:
  - platform: onebot
    channelId: "123456"

# One platform wildcard for a specific channel.
allowedChannels:
  - platform: "*"
    channelId: "123456"

# One channel wildcard for a specific platform.
allowedChannels:
  - platform: discord
    channelId: "*"

# Direct-only and shared-only rules.
allowedChannels:
  - platform: discord
    channelId: "dm-123"
    isDirect: true
  - platform: onebot
    channelId: "group-456"
    isDirect: false

# Explicit allow-all for every external platform and channel scope.
allowedChannels:
  - platform: "*"
    channelId: "*"
```

The final rule admits all external channel scopes. It does not affect
internal completion events produced by an already admitted Runtime.

### Model image input and multimedia

Providers are modality-agnostic. Image capability belongs to the per-model
override in `models.json`, not to provider configuration. Declare it like this:

```json
{
  "chat": {
    "provider:model": {
      "modalities": {
        "input": ["image"]
      }
    }
  }
}
```

The authority-4 command writes the same model override and refreshes the model
registry:

```text
yesimbot.model.add-input-modality provider:model image
```

The command accepts a full model ID or alias and is idempotent. A model can
receive image files only when both `multimedia.enabled` and its explicit
`modalities.input` capability allow them. An absent or unknown image
capability degrades to unchanged text. The provider does not supply this
capability.

The unified multimedia policy governs Gateway image freezing, AssetStore writes,
and model-call selection. The defaults are enabled, 4 images per call, 5 MiB per
image, 10 MiB total per call, and `current-first` selection:

```yaml
multimedia:
  enabled: true
  image:
    selection: current-first
    maxCount: 4
    maxBytesPerImage: 5242880
    maxTotalBytes: 10485760
```

Selection is scoped to each model call and does not rewrite persisted history.
`current-first` visits the current request batch first, then transformed
history in FIFO order; when the batch is empty it falls back to historical
FIFO. `fifo` visits Events in model-boundary order. `lifo` visits Events from
newest to oldest. Both strategies preserve source-reference order inside each
Event. Generated file parts remain call-scoped.

ChannelRuntimes snapshot model capability, multimedia policy, and WillEngine
when they start. `reload(scope)` refreshes Gateway and AssetStore with the same
current multimedia policy, while the reloaded channel lazily creates its next
runtime snapshot. `yesimbot.model.add-input-modality` therefore needs an explicit
non-destructive reload for an active channel:

```ts
await ctx.yesimbot.reload({
  platform: "onebot",
  selfId: "bot-1",
  channelId: "123456",
  isDirect: false,
});
```

Reload preserves history, assets, and workspace. The default WillEngine is
`routing`; `willingness` is opt-in. To roll back the temporary willingness
engine, select routing and reload the affected channels:

```yaml
will:
  engine: routing
```

To roll back multimedia input without changing model metadata, disable it and
reload the affected channels:

```yaml
multimedia:
  enabled: false
```

Both rollback switches leave persisted message content unchanged.

## Channel identity

Core defines one deterministic 26-character lowercase Base32 `channelIdentity` for
every `ChannelScope`. Shared channels derive identity from
`platform + channelId`; direct channels also include `selfId`.

```
ChannelScope = { platform, selfId, channelId, isDirect }
shared tuple  = ["yesimbot.channel", 1, "shared", platform, null, channelId]
direct tuple  = ["yesimbot.channel", 1, "direct", platform, selfId, channelId]
```

The identity is SHA-256 of the canonical UTF-8 JSON tuple, first 16 bytes, RFC 4648
lowercase Base32 (unpadded). Matches `^[a-z2-7]{25}[aeimquy4]$`.

Export: `YesImBotService.channelIdentity(scope)` or `channelIdentity` from package root.

The identity is a logical ID, not a filesystem path. Ordinary inputs persist as
`yesimbot.message` with `elements`, frozen `text`, and `messageId`; `elements`
is the sole structured message field. Non-message inputs persist as
`yesimbot.event` with `eventType` and frozen `text`.

## Storage layout

All Core-managed local resources for one channel live beneath one directory:

```
<basePath>/
  channels/v1-shared-<platform>-<channelId>/
  channels/v1-direct-<platform>-<channelId>-<selfId>/
    channel.json               — authoritative Manifest
    sessions/messages.jsonl    — Agent history (append-only JSONL)
    assets/                    — frozen image blobs by content hash
    workspace/                 — plugin workspace (registered namespace)
    <registered-namespace>/   — other module data
```

- `channel.json` is the only authority and commit point. Startup scans valid
  Manifests into the in-memory index; Core never creates `channels.json`.
- `YesImBotService.registerStorage(namespace)` registers a module namespace.
- `YesImBotService.ensureStorage(scope, namespace, ...segments)` returns a
  validated path beneath that namespace root.

## Shared-channel admission

Database (`"database"`) is a required injection. Before any session side effect
or Runtime creation, Core queries the Koishi Channel row by
`(platform, channelId)` and requires `assignee === session.selfId`. Missing
rows, empty assignees, query errors, and non-assignee events fail closed.
Direct events skip assignee lookup.

After a shared assignee change, the old Runtime is drained via explicit
`reload(scope)`. The next admitted event lazily creates a new Runtime for the
current assignee without changing the channel identity, JSONL, or workspace data.

## Legacy data

This release is a clean break. Core preserves but does not read, migrate, map,
rename, or delete old hash directories, old JSONL payloads, old Manifests, or
`channels.json`. No legacy fallback or compatibility alias exists.
