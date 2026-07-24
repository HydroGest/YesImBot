# koishi-plugin-yesimbot

The core package provides YesImBot's Koishi facade, Session Gateway, model
registry, canonical EventRecord routing, channel storage, and Runtime ownership.

## Public API

Platform plugins register one `SessionResolver` per Koishi platform through
`ctx.yesimbot.registerResolver()`. The resolver receives the live Session only
inside Gateway handling and returns a Session-free `EventRecord`.

The public facade exposes:

- `model`
- `registerResolver()`, `registerWill()`, and `registerAgentPlugin()`
- `channelKey()`, `registerStorage()`, `ensureStorage()`, and `listChannels()`
- `reload(scope)`, `reset()`, and `stop()`

The package root exports `ChannelScope`, `channelKey`, Event contracts,
`SessionResolver`, `ChannelFilter`, `ChannelRecord`, and Will contracts. Gateway,
RuntimeManager, ChannelRuntime, ChannelStorage, AssetStore, and assignee helpers
remain internal. The only supported code subpath is `./model`.

## Gateway and runtime

Gateway owns the live Session, Resolver invocation, bounded image freezing, and
passive `Session.send()`. A failed passive delivery appends one same-channel
`delivery.failed` Event and does not stop later outputs.

RuntimeManager owns one Runtime entry per Channel Key and coordinates reload,
reset, global stop, Will generations, and shared-channel assignee handover.
ChannelRuntime owns one channel FIFO, Agent, Will, JSONL storage, model stream,
delivery leases, and delivery-failure completion lane. Runtime modules and
persisted data never retain a Koishi Session.

`reload(scope)` drains an active runtime for that channel, preserves persisted
channel data, and recreates the runtime lazily on the next accepted event.

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
