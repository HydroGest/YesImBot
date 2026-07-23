# Unified Channel Storage Protocol Brainstorm

## Background

Core, Session storage, Asset storage, Workspace, and memos-client currently derive channel identifiers or paths independently. Session data uses one opaque identifier, Workspace uses another truncated digest under a separately configured root, Asset data uses the Core path identifier, and memos-client derives its own channel hash. Users cannot reliably locate all data for one channel, and consumers must understand path-generation details that Core should own.

The design session set out to define one stable Channel Key protocol, a channel-first directory layout, a readable catalog, and a public Core API that hides path generation. The protocol must work across processes and operating systems, avoid raw identifiers in path names, and leave module-owned data formats under module control.

## Decision Chain

### Q1: What security property does the Key need?

The Key only needs to avoid exposing raw identifiers in file and directory names. It does not need to resist offline enumeration. The design therefore rejected HMAC and key management in favor of an unkeyed digest.

### Q2: Should Core normalize identifier strings?

No. `platform`, `selfId`, and `channelId` remain opaque, non-empty strings. Core does not trim, case-fold, normalize Unicode, parse numbers, or remove leading zeroes. Resolver and platform code must supply stable identifiers.

### Q3: Should the existing `channel_v2_<sha256-base64url>` identifier become the protocol?

No. Its 43-character digest and prefix are too long for routine filesystem use. The design selected the first 128 bits of SHA-256 encoded as unpadded, lowercase RFC 4648 Base32. The result is a 26-character key without a prefix.

### Q4: How can users find one channel among opaque directories?

Opaque keys cannot also be human-readable. Each channel directory therefore contains an authoritative `channel.json`, while `<basePath>/channels.json` provides a readable, rebuildable index. The catalog stores fixed identity fields and the latest non-empty channel name.

### Q5: Should data remain grouped by module or by channel?

The design selected channel-first storage:

```text
<basePath>/channels/<key>/
  channel.json
  sessions/messages.jsonl
  assets/
  workspace/
  <registered-namespace>/
```

All local channel data uses the Core `basePath`. Workspace no longer chooses an independent channel root. Once a user finds a key in `channels.json`, the user can inspect every local resource for that channel in one directory.

### Q6: How much filesystem behavior should Core own?

Core owns identity validation, Key generation, Manifest and Catalog maintenance, namespace registration, root creation, and safe path resolution. Each module owns the schema, I/O, limits, migration, caches, and deletion policy inside its namespace. Core does not wrap generic filesystem operations.

### Q7: Should storage be a separate Koishi Service?

No. Storage shares `basePath`, startup, reset, Runtime coordination, and consumers with `YesImBotService`. Public methods live directly on `ctx.yesimbot`; a separate `yesimbot.storage` service or nested facade would add a second lifecycle without an independent implementation.

### Q8: How are module directory names protected from collision?

Modules register one stable lowercase ASCII namespace. Core reserves `sessions` and `assets`; Workspace registers `workspace`. Duplicate registration and use of an unregistered namespace fail. Namespace registration manages names only and does not create a lifecycle or deletion framework.

### Q9: Should Core provide clear or purge operations for arbitrary module data?

No. Session and Asset implement their own reset behavior. Workspace and future modules own their data and caches. Core does not provide generic clear, purge, or lifecycle callbacks. Full channel directories remain until an administrator removes them while Core is stopped; Catalog rebuild then reflects the remaining Manifests.

### Q10: Must the Key include `selfId`?

The initial proposal used `platform + selfId + channelId` and considered persistent aliases for bot-account handover. Koishi already models a non-direct Channel by `(platform, channelId)` and stores the active bot in `channel.assignee`. Permanent alias state would duplicate this model and introduce Identity Key, Storage Key, alias chains, active ownership, and handover races.

The approved protocol uses a tagged identity:

```text
shared: ["yesimbot.channel",1,"shared",platform,null,channelId]
direct: ["yesimbot.channel",1,"direct",platform,selfId,channelId]
```

Shared channels follow Koishi assignment and survive bot-account changes without moving data. Direct conversations retain `selfId` isolation because Koishi does not assign private channels.

### Q11: How does Core determine direct versus shared identity?

`ChannelScope` gains a flat `isDirect` boolean. Gateway derives it from `session.isDirect`; persisted events use `event.channel.type === Channel.Type.DIRECT`. Resolver output must preserve the Session classification. Only an explicit `DIRECT` type selects the direct variant.

### Q12: Who owns the shared-channel assignee?

Koishi Database is required infrastructure and must appear in Core injection. Koishi's Channel row keyed by `(platform, id)` is the only assignee source. YesImBot does not persist or configure assignee in its Manifest, Catalog, configuration, or commands.

Gateway queries Database before Resolver work, image freezing, persistence, or Runtime creation. Shared events proceed only when `channel.assignee === session.selfId`. Missing rows, empty assignees, query errors, non-assignee mentions, and non-assignee command-prefix messages fail closed. Direct events skip this check.

### Q13: What happens when Koishi changes assignee while Core is running?

RuntimeManager supports a two-phase graceful handover under the shared Channel Key. The first lifecycle phase rechecks Database, marks the old Runtime generation as draining, and releases the per-Key coordinator. Outside that coordinator, Core waits for the Agent turn, model stream, Gateway delivery leases, and delivery-failure completion lane. The second lifecycle phase verifies the generation, removes the old Runtime, rechecks Database, and creates a Runtime bound to the new Bot, Scope, Will, and plugins while preserving storage.

Handover admits at most five waiting events. Every waiting event retains its admitted `selfId` and rechecks Database before submission. Core does not interrupt a normal turn or impose a hidden timeout; a failed or stuck drain remains fail closed until stop or restart.

### Q14: How should memos-client consume the protocol?

memos-client uses the Core Channel Key as `channel_hash` and stops serializing or hashing Channel coordinates itself. Its `userId`, `conversationId`, `agentId`, author hashes, message hashes, and search policy remain plugin-owned because they represent MemOS concepts rather than local channel storage identity.

### Q15: Should existing layouts migrate?

No. The new protocol does not read, migrate, map, or delete current `channel_v2_*`, `workspace_v2_*`, historical `ch_v1_*`, or old JSONL data. New and old layouts may coexist. Future Manifest, Catalog, or internal path-format changes may use version-specific, idempotent startup migrations as long as Channel Key v1 does not change.

## Validated Encoding

Core serializes the tagged tuple with compact ECMAScript `JSON.stringify`, encodes it as UTF-8, hashes it with SHA-256, takes the first 16 bytes, and emits lowercase RFC 4648 Base32 without padding. Canonical keys match:

```text
^[a-z2-7]{25}[aeimquy4]$
```

The restricted final character enforces the two zero padding bits in a 128-bit Base32 encoding. Core treats an existing directory whose Manifest recomputes to a different identity as a collision or integrity error and never merges the data.

## Validated Test Vectors

```text
["yesimbot.channel",1,"shared","onebot",null,"123456"]
=> a5vnf2ijd75c2ibyo2s5czdir4

["yesimbot.channel",1,"direct","onebot","10000","123456"]
=> ymdz53gzamgvzjzrtf6vesoal4

["yesimbot.channel",1,"direct","onebot","20000","123456"]
=> 3fdpuhlm2tmzybzrlgxotmtmxq

["yesimbot.channel",1,"shared","测试",null,"群/α"]
=> jhmjjrbkhmceyookuqyolglf7m
```

Changing `selfId` does not change a shared key and does change a direct key. JSON tuple boundaries prevent delimiter collisions. Unicode normalization is not applied, so canonically equivalent but byte-distinct strings produce different keys.

## Rejected Alternatives

- HMAC and secret rotation: no confidentiality requirement justifies the operational cost.
- Full SHA-256/Base64URL with a visible prefix: path length and readability cost exceed the collision requirement.
- Raw IDs or channel names in paths: names change, collide, and leak identity.
- Module-first roots: users still need to locate the same channel in several trees.
- Per-channel choice of whether `selfId` participates: two identity protocols would create configuration-dependent path migration.
- Persistent storage aliases: Koishi assignee already models shared-channel bot ownership.
- Independent Storage Service: storage has no independent configuration, consumer set, or lifecycle.
- Generic purge and lifecycle hooks: modules own their data and caches.
- Legacy migration or dual reads: the project has already removed legacy message and path compatibility.

## Final Scope

The change modifies Channel identity, Core runtime and storage ownership, Gateway admission, Workspace path resolution, and memos-client channel hashing. It does not implement module-internal data migration, a general filesystem abstraction, storage deletion, assignee configuration, or legacy compatibility. The approved discussion left no protocol-level decision open.
