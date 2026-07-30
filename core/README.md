# koishi-plugin-yesimbot

`koishi-plugin-yesimbot` composes the Koishi facade, model registry, Session
Gateway, channel storage, assets, and the per-channel runtime.

## Public API

`ctx.yesimbot` exposes:

- `model`
- `assets`, an `AssetService`; call `assets.createStore(scope)` to obtain an
  `AssetStore` with `put()`, `get()`, and `clear()` for that channel
- `registerResolver()` and `registerAgentPlugin()`
- `getStoragePath(scope)`
- `reset(scope)` and `stop()`

`ChannelScope` is the public current-channel context:

```ts
{
  platform: string;
  selfId: string;
  channelId: string;
  isDirect: boolean;
}
```

Core derives shared `[platform, channelId]` and direct
`[platform, selfId, channelId]` tuples only inside its storage and runtime
implementations. It does not expose a channel identity, tuple key, directory
helper, storage implementation, Gateway, RuntimeManager, or ChannelRuntime.

The package root exports `Config`, `ChannelScope`, input contracts and input
helpers, `SessionResolver`, `AssetService`, `AssetStore`, `AgentPluginFactory`,
and `YesImBotService`. The only supported code subpath is `./model`.

## Gateway and runtime

A platform registers one `SessionResolver` for its platform. Gateway derives a
`ChannelScope`, checks the allowlist, and for shared channels checks the Koishi
Channel assignee before it creates an asset store, invokes the Resolver, or
routes a record. Direct channels skip the assignee query. A platform without a
registered Resolver is not admitted; Core has no Satori fallback.

Gateway passes its channel-scoped `AssetStore` to the Resolver. The Resolver
owns any platform-specific image download and persistence, then returns a
Session-free message or event Draft. Gateway creates the canonical input record
and owns passive `Session.send()` delivery. A failed delivery reports one
same-channel `delivery.failed` event through the producing runtime.

`RuntimeManager` creates one `ChannelRuntime` for a persistent channel tuple.
When a shared channel is admitted for a different Bot, it stops the old runtime,
removes it from the cache, creates a runtime for the new Bot, and routes the
current record there. Core has no `reload()` operation. Model, image-input,
prompt, tool, and plugin changes apply when a runtime is replaced.

`ChannelRuntime` owns its channel FIFO, Agent, Will engine, JSONL storage,
prompt assembly, model input projection, output queue, and delivery feedback.
It holds no live Koishi Session.

## Prompt resources

`core/resources/constitution.md` and `core/resources/athena-persona.md` are
package resources. `runtime/prompt.ts` resolves the package root with
`createRequire(import.meta.url)` and the package name so both pkgroll ESM and
CJS entries locate those Markdown files. Constitution version is 3. The system
prompt orders constitution, optional `<agents>`, one `<persona>`, then runtime
context from `ChannelScope` and the current Bot `selfId`.

## Storage and records

Each channel root is named `shared-<platform>-<channelId>` or
`direct-<platform>-<channelId>-<selfId>` with safely encoded segments. Its
`channel.json` Manifest is authoritative. `sessions/messages.jsonl`, `assets/`,
and plugin-selected child directories live below that root. `getStoragePath()`
creates or validates the channel root and returns it; plugins select and create
their own child paths.

Records and Manifests are versionless. JSONL read-back parses each line with
`JSON.parse`, skips lines with invalid JSON syntax after logging a warning, and
returns all successfully parsed values without Core schema validation. Core does
not read, migrate, or provide compatibility aliases for prior layouts or
records.

## Configuration migration

`allowedChannels` is a deny-by-default Gateway boundary. Rules are ORed; fields
within one rule are ANDed. `platform` and `channelId` accept an exact string or
`*`. Omit `isDirect` to match both direct and shared channels.

```yaml
allowedChannels:
  - platform: onebot
    channelId: "123456"
  - platform: discord
    channelId: "dm-123"
    isDirect: true
```

Declare model image capability in the model override in `models.json`. The
runtime uses `imageInput` for its model-call budget; its default is four images,
5 MiB per image, and 10 MiB total. Set `imageInput: false` to disable model
image input. This setting does not impose a download policy on Resolvers.
