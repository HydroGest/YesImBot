# koishi-plugin-yesimbot

The core package provides YesImBot's Koishi services, canonical message
routing, model registry, channel runtime ownership, platform input, and
Koishi-first output delivery.

## Platform API

Import contracts from `koishi-plugin-yesimbot/platform`. Core exports the
`Platform.Message`, `Platform.MessageRecord`, `Platform.Event`,
`Platform.Scope`, `Platform.Adapter`, `Platform.RefineResult`, and
`Platform.ImagePrepareSink` contracts. Adapters register through
`ctx.yesimbot.platform.register()` and publish semantic events through
`ctx.yesimbot.platform.publish()`.

Core owns fixed message formatting, literal channel history, private
channel-local image assets, and Agent lifecycle routing. Platform adapters do
not render model messages, access stored assets, persist history, or deliver
outbound replies.

## Runtime and delivery

`ChannelRuntime` is an internal deep module with three operations: handle a
canonical message, reset one channel, and stop all owned runtimes. It hides
classification, per-channel FIFO submission, Agent cache and storage, stream
ownership, delivery calls, and lifecycle cleanup. `YesImBotService` is the
public Koishi facade and does not expose Agent handles or turn streams.

Core exports `DeliveryService` and the `Delivery` contracts from the package
root. The same service is available as `ctx.yesimbot.delivery`.

- `reply(session, fragments)` uses the original `Session.send()`.
- `send(source, scope, fragments)` resolves one matching Bot and uses
  `Bot.sendMessage()`.
- `subscribe(listener)` observes process-local started and terminal events.

Delivery preserves ordered fragments and every returned `string[]` message ID.
Receipts report `sent`, `partial`, or `failed`; listener and diagnostic failures
cannot interrupt the send operation. Core does not define a platform delivery
adapter or replace Koishi/Satori encoders.

## Channel Key

Core defines one deterministic 26-character lowercase Base32 Channel Key for
every `ChannelScope`. Shared channels derive identity from
`platform + channelId`; direct channels also include `selfId`.

```
ChannelScope = { platform, selfId, channelId, isDirect }
shared tuple  = ["yesimbot.channel", 1, "shared", platform, null, channelId]
direct tuple  = ["yesimbot.channel", 1, "direct", platform, selfId, channelId]
```

The Key is SHA-256 of the canonical UTF-8 JSON tuple, first 16 bytes, RFC 4648
lowercase Base32 (unpadded). Matches `^[a-z2-7]{25}[aeimquy4]$`.

Export: `YesImBotService.channelKey(scope)` or `channelKey` from package root.

## Storage layout

All Core-managed local resources for one channel live beneath one directory:

```
<basePath>/
  channels.json               — rebuildable Catalog (sorted by Key, UTF-8 JSON)
  channels/<26-char-key>/
    channel.json               — authoritative Manifest
    sessions/messages.jsonl    — Agent history (append-only JSONL)
    assets/                    — frozen image blobs by content hash
    workspace/                 — plugin workspace (registered namespace)
    <registered-namespace>/   — other module data
```

- `channel.json` is the only commit point. The Catalog is a derived index
  rebuilt at startup or on failure.
- `ChannelRecord` and `ChannelFilter` are public types exported from the
  package root.
- `YesImBotService.registerStorage(namespace)` registers a module namespace.
- `YesImBotService.ensureStorage(scope, namespace, ...segments)` returns a
  validated path beneath that namespace root.
- `YesImBotService.listChannels(filter?)` returns matching records from the
  in-memory Catalog.

## Shared-channel admission

Database (`"database"`) is a required injection. Before any session side effect
or Runtime creation, Core queries the Koishi Channel row by
`(platform, channelId)` and requires `assignee === session.selfId`. Missing
rows, empty assignees, query errors, and non-assignee events fail closed.
Direct events skip assignee lookup.

Online handover drains the old Runtime and creates a new one for the new
assignee without changing the Channel Key, JSONL, or workspace data.

## Legacy data

This release uses a new canonical Key format and channel-first directory layout.
Core does not read, migrate, map, rename, or delete legacy data
(`channel_v2_*`, `workspace_v2_*`, `ch_v1_*`, or old JSONL files). No legacy
path or hash helpers are exposed from the package root.
