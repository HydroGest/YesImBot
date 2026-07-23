# Unified Channel Storage Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace module-specific channel identifiers and roots with one Core-owned direct/shared Channel Key, channel-first storage layout, database-backed assignee admission, and online Runtime handover.

**Architecture:** `YesImBotService` owns a private channel storage manager and exposes a small set of direct methods. Runtime, Session, Asset, Workspace, and memos-client consume the same Key; Koishi Database remains the sole assignee authority, and RuntimeManager drains an old assignee generation before rebuilding it against the same persisted channel directory.

**Tech Stack:** TypeScript, Node.js `crypto` and `fs/promises`, Koishi 4 services/database, Satori `Universal.Channel.Type`, `@yesimbot/agent-runtime`, Vitest, Yarn 4, Turbo, OpenSpec.

## Global Constraints

- Use `yarn`, never npm or pnpm. Prefix shell commands with `rtk` when available.
- Keep `ChannelScope` flat: `{ platform, selfId, channelId, isDirect }`. Do not add a wrapper identity algebra.
- Shared Key input is `["yesimbot.channel",1,"shared",platform,null,channelId]`; direct Key input is `["yesimbot.channel",1,"direct",platform,selfId,channelId]`.
- Key encoding is SHA-256 first 16 bytes, lowercase unpadded RFC 4648 Base32, exactly 26 characters matching `^[a-z2-7]{25}[aeimquy4]$`.
- Treat identity strings as non-empty opaque values. Do not trim, case-fold, Unicode-normalize, parse, or remove leading zeroes.
- Koishi Database is required. Shared admission fails closed unless `(platform, channelId).assignee === selfId`; direct admission skips assignee lookup.
- Store local data only under `<basePath>/channels/<key>/`. Do not read, migrate, map, or delete legacy layouts.
- Core owns Manifest, Catalog, namespace registration, and path validation. Each module owns its namespace contents, caches, schema, and deletion.
- Core exposes no generic clear, purge, storage lifecycle, Alias, or independent Storage Service.
- Follow TDD for each task. Run the narrow test first, then the package check, before committing.
- Source of truth: `openspec/changes/unify-channel-storage-protocol/design.md` and the six delta specs under `openspec/changes/unify-channel-storage-protocol/specs/`.

---

## Task 1: Channel Scope And Key Protocol

**Files:**
- Modify: `core/src/channel/index.ts`
- Modify: `core/src/gateway/index.ts`
- Modify: `core/src/service.ts`
- Modify: `core/src/event/formatter.ts`
- Modify: `core/src/gateway/image.ts`
- Modify: `core/src/runtime/channel.ts`
- Modify: `core/src/runtime/manager.ts`
- Modify: `core/src/runtime/prompt.ts`
- Modify: `core/src/runtime/storage.ts`
- Modify: `core/src/shared/asset.ts`
- Modify: `core/src/will/index.ts`
- Modify: `core/tests/channel.test.ts`
- Modify: `core/tests/gateway.test.ts`
- Modify: `core/tests/service.test.ts`
- Modify: `core/tests/asset.test.ts`
- Modify: `core/tests/channel-runtime.test.ts`
- Modify: `core/tests/formatter.test.ts`
- Modify: `core/tests/gateway-delivery.test.ts`
- Modify: `core/tests/image-freeze.test.ts`
- Modify: `core/tests/jsonl-storage.test.ts`
- Modify: `core/tests/runtime-manager.test.ts`
- Modify: `platforms/onebot/tests/events.test.ts`
- Modify: `plugins/onebot-utils/src/index.ts`
- Modify: `plugins/onebot-utils/tests/onebot-utils.test.ts`
- Modify: `plugins/memos-client/src/index.ts`
- Modify: `plugins/memos-client/scripts/qq-memos-import.ts`
- Modify: `plugins/memos-client/tests/identity.test.ts`
- Modify: `plugins/memos-client/tests/plugin.test.ts`
- Modify: `plugins/memos-client/tests/qq-memos-import.test.ts`
- Modify: `plugins/memos-client/tests/tools.test.ts`
- Modify: `plugins/workspace/tests/plugin.test.ts`

**Interfaces:**
- Produces: `ChannelScope { platform: string; selfId: string; channelId: string; isDirect: boolean }`
- Produces: `channelKey(scope: ChannelScope): string`
- Produces: `sameChannel(left: ChannelScope, right: ChannelScope): boolean`
- Produces: `fromEvent(record): ChannelScope | null`
- Consumes: `Universal.Channel.Type.DIRECT` for EventRecord classification

- [ ] **Step 1: Replace channel tests with the approved conformance vectors**

Add these cases to `core/tests/channel.test.ts` before changing implementation:

```ts
import { describe, expect, it } from "vitest";
import { channelKey, sameChannel, type ChannelScope } from "../src/channel/index.js";

const shared = (selfId: string): ChannelScope => ({
  platform: "onebot",
  selfId,
  channelId: "123456",
  isDirect: false,
});

const direct = (selfId: string): ChannelScope => ({
  platform: "onebot",
  selfId,
  channelId: "123456",
  isDirect: true,
});

describe("channelKey", () => {
  it("matches the shared conformance vector and ignores selfId", () => {
    expect(channelKey(shared("10000"))).toBe("a5vnf2ijd75c2ibyo2s5czdir4");
    expect(channelKey(shared("20000"))).toBe("a5vnf2ijd75c2ibyo2s5czdir4");
    expect(sameChannel(shared("10000"), shared("20000"))).toBe(true);
  });

  it("matches direct conformance vectors and retains selfId", () => {
    expect(channelKey(direct("10000"))).toBe("ymdz53gzamgvzjzrtf6vesoal4");
    expect(channelKey(direct("20000"))).toBe("3fdpuhlm2tmzybzrlgxotmtmxq");
    expect(sameChannel(direct("10000"), direct("20000"))).toBe(false);
  });

  it("matches the Unicode vector without normalization", () => {
    expect(channelKey({
      platform: "测试",
      selfId: "机器人 01",
      channelId: "群/α",
      isDirect: false,
    })).toBe("jhmjjrbkhmceyookuqyolglf7m");
  });

  it.each(["platform", "selfId", "channelId"] as const)("rejects empty %s", (field) => {
    const scope = { ...direct("10000"), [field]: "" };
    expect(() => channelKey(scope)).toThrow(`ChannelScope.${field}`);
  });
});
```

- [ ] **Step 2: Run the channel test and confirm the old implementation fails**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel.test.ts
```

Expected: FAIL because `ChannelScope.isDirect` and the 26-character Key protocol do not exist.

- [ ] **Step 3: Implement exact scope validation and Base32 encoding**

Replace the identity logic in `core/src/channel/index.ts` with this structure. Keep legacy path exports only until Task 3 updates every consumer; do not use them in new code.

```ts
import { createHash } from "node:crypto";
import { Universal } from "koishi";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

export interface ChannelScope {
  readonly platform: string;
  readonly selfId: string;
  readonly channelId: string;
  readonly isDirect: boolean;
}

function assertScope(scope: ChannelScope): void {
  for (const field of ["platform", "selfId", "channelId"] as const) {
    if (typeof scope[field] !== "string" || scope[field].length === 0) {
      throw new TypeError(`ChannelScope.${field} must be a non-empty string`);
    }
  }
  if (typeof scope.isDirect !== "boolean") {
    throw new TypeError("ChannelScope.isDirect must be a boolean");
  }
}

function encodeBase32(bytes: Uint8Array): string {
  let buffer = 0;
  let bits = 0;
  let output = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32[(buffer >>> bits) & 31];
    }
  }
  if (bits > 0) output += BASE32[(buffer << (5 - bits)) & 31];
  return output;
}

export function channelKey(scope: ChannelScope): string {
  assertScope(scope);
  const canonical = scope.isDirect
    ? ["yesimbot.channel", 1, "direct", scope.platform, scope.selfId, scope.channelId]
    : ["yesimbot.channel", 1, "shared", scope.platform, null, scope.channelId];
  const digest = createHash("sha256").update(JSON.stringify(canonical), "utf8").digest();
  return encodeBase32(digest.subarray(0, 16));
}

export function fromEvent(record: ChannelEvent): ChannelScope | null {
  if (!record.channel?.id) return null;
  return {
    platform: record.platform,
    selfId: record.selfId,
    channelId: record.channel.id,
    isDirect: record.channel.type === Universal.Channel.Type.DIRECT,
  };
}
```

- [ ] **Step 4: Add Session/EventRecord classification tests before changing Gateway**

In `core/tests/gateway.test.ts`, add direct and shared Session cases plus a Resolver mismatch case:

```ts
it("rejects a resolver that changes direct classification", async () => {
  const session = createSession({
    platform: "onebot",
    selfId: "10000",
    channelId: "user-1",
    isDirect: true,
  });
  resolver.resolve = vi.fn(async ({ base }) => ({
    ...base!,
    channel: { ...base!.channel, type: Universal.Channel.Type.TEXT },
    content: "mismatch",
  }));

  await gateway.handle(session);

  expect(runtime.route).not.toHaveBeenCalled();
  expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({
    code: "gateway.invalid_record",
  }));
});
```

- [ ] **Step 5: Thread `isDirect` through Session construction and all ChannelScope fixtures**

Update `scopeFromSession` in `core/src/gateway/index.ts`:

```ts
function scopeFromSession(session: Session): ChannelScope | null {
  if (!session.platform || !session.selfId || !session.channelId) return null;
  return {
    platform: session.platform,
    selfId: session.selfId,
    channelId: session.channelId,
    isDirect: session.isDirect,
  };
}
```

Extend `hasScope` to compare `record.channel.type === Universal.Channel.Type.DIRECT` with `scope.isDirect`. Update every `ChannelScope` constructor and fixture in the files listed above with the correct explicit boolean; use `false` for group/shared fixtures and `true` only for direct fixtures. In memos-client, derive the value from the existing `channelType` or `conversationType` without changing its hash algorithm yet. Do not add a defaulting helper that hides missing classification.

- [ ] **Step 6: Run identity and Gateway tests, then Core type checking**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel.test.ts tests/gateway.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
rtk yarn check-types
```

Expected: both test files PASS and full-workspace type checking reports no missing `isDirect` fields.

- [ ] **Step 7: Commit the identity protocol**

```bash
rtk git add \
  core/src/channel/index.ts \
  core/src/gateway/index.ts \
  core/src/service.ts \
  core/src/event/formatter.ts \
  core/src/gateway/image.ts \
  core/src/runtime/channel.ts \
  core/src/runtime/manager.ts \
  core/src/runtime/prompt.ts \
  core/src/runtime/storage.ts \
  core/src/shared/asset.ts \
  core/src/will/index.ts \
  core/tests/channel.test.ts \
  core/tests/gateway.test.ts \
  core/tests/service.test.ts \
  core/tests/asset.test.ts \
  core/tests/channel-runtime.test.ts \
  core/tests/formatter.test.ts \
  core/tests/gateway-delivery.test.ts \
  core/tests/image-freeze.test.ts \
  core/tests/jsonl-storage.test.ts \
  core/tests/runtime-manager.test.ts \
  platforms/onebot/tests/events.test.ts \
  plugins/onebot-utils/src/index.ts \
  plugins/onebot-utils/tests/onebot-utils.test.ts \
  plugins/memos-client/src/index.ts \
  plugins/memos-client/scripts/qq-memos-import.ts \
  plugins/memos-client/tests/identity.test.ts \
  plugins/memos-client/tests/plugin.test.ts \
  plugins/memos-client/tests/qq-memos-import.test.ts \
  plugins/memos-client/tests/tools.test.ts \
  plugins/workspace/tests/plugin.test.ts
rtk git commit -m "feat(core): define channel key protocol"
```

---

## Task 2: Core Channel Storage Manager

**Files:**
- Create: `core/src/storage/index.ts`
- Create: `core/tests/storage.test.ts`
- Modify: `core/src/index.ts`

**Interfaces:**
- Consumes: `channelKey(scope: ChannelScope): string` from Task 1
- Produces: `ChannelRecord { key; isDirect; platform; selfId: string | null; channelId; name? }`
- Produces: `ChannelFilter` with optional exact-match record fields
- Produces: `ChannelStorage.start(): Promise<void>`
- Produces: `ChannelStorage.register(namespace: string): () => void`
- Produces: `ChannelStorage.ensure(scope, namespace, ...segments): Promise<string>`
- Produces: `ChannelStorage.list(filter?): readonly ChannelRecord[]`
- Produces: internal `ChannelStorage.updateName(scope, name): Promise<void>` for Gateway metadata refresh

- [ ] **Step 1: Write failing tests for Manifest and Catalog creation**

Create `core/tests/storage.test.ts` with a temporary base path per test:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChannelScope } from "../src/channel/index.js";
import { ChannelStorage } from "../src/storage/index.js";

const shared: ChannelScope = {
  platform: "onebot",
  selfId: "10000",
  channelId: "123456",
  isDirect: false,
};

describe("ChannelStorage", () => {
  let basePath: string;
  let storage: ChannelStorage;

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), "yesimbot-storage-"));
    storage = new ChannelStorage(basePath);
    await storage.start();
  });

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true });
  });

  it("commits a channel Manifest before returning a namespace path", async () => {
    const dispose = storage.register("workspace");
    const path = await storage.ensure(shared, "workspace");
    expect(path).toBe(join(basePath, "channels", "a5vnf2ijd75c2ibyo2s5czdir4", "workspace"));

    const manifest = JSON.parse(await readFile(join(
      basePath,
      "channels",
      "a5vnf2ijd75c2ibyo2s5czdir4",
      "channel.json",
    ), "utf8"));
    expect(manifest).toEqual({
      formatVersion: 1,
      keyVersion: 1,
      key: "a5vnf2ijd75c2ibyo2s5czdir4",
      isDirect: false,
      platform: "onebot",
      selfId: null,
      channelId: "123456",
    });

    const catalog = JSON.parse(await readFile(join(basePath, "channels.json"), "utf8"));
    expect(catalog.channels).toEqual([manifest]);
    dispose();
  });
});
```

- [ ] **Step 2: Run the new test and confirm the module is missing**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/storage.test.ts
```

Expected: FAIL because `core/src/storage/index.ts` does not exist.

- [ ] **Step 3: Define persistent and public record shapes**

Start `core/src/storage/index.ts` with explicit, flat shapes:

```ts
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { channelKey, type ChannelScope } from "../channel/index.js";

const FORMAT_VERSION = 1;
const KEY_VERSION = 1;
const KEY_PATTERN = /^[a-z2-7]{25}[aeimquy4]$/;
const NAMESPACE_PATTERN = /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export interface ChannelRecord {
  readonly key: string;
  readonly isDirect: boolean;
  readonly platform: string;
  readonly selfId: string | null;
  readonly channelId: string;
  readonly name?: string;
}

export type ChannelFilter = Partial<ChannelRecord>;

interface ChannelManifest extends ChannelRecord {
  readonly formatVersion: 1;
  readonly keyVersion: 1;
}

interface ChannelCatalog {
  readonly formatVersion: 1;
  readonly channels: readonly ChannelRecord[];
}
```

Add `recordFor(scope, name?)`, `parseManifest(value)`, and `matchesFilter(record, filter)` as private module functions. `parseManifest` must reject unknown versions, non-canonical Keys, wrong nullability for `selfId`, unexpected direct/shared Key recomputation, and invalid optional names. It must ignore unknown optional JSON properties so additive metadata remains forward-compatible.

- [ ] **Step 4: Implement startup scanning and deterministic Catalog rebuild**

Add the class and startup path:

```ts
export class ChannelStorage {
  private readonly channelsPath: string;
  private readonly catalogPath: string;
  private readonly records = new Map<string, ChannelRecord>();
  private readonly namespaces = new Map<string, object>();
  private tail: Promise<void> = Promise.resolve();
  private startTask: Promise<void> | undefined;

  constructor(
    private readonly basePath: string,
    private readonly warn: (code: string, fields: Record<string, unknown>) => void = () => {},
  ) {
    this.channelsPath = join(basePath, "channels");
    this.catalogPath = join(basePath, "channels.json");
    this.namespaces.set("sessions", {});
    this.namespaces.set("assets", {});
  }

  start(): Promise<void> {
    if (!this.startTask) this.startTask = this.startInternal();
    return this.startTask;
  }

  private async startInternal(): Promise<void> {
    await mkdir(this.channelsPath, { recursive: true });
    const entries = await readdir(this.channelsPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !KEY_PATTERN.test(entry.name)) continue;
      try {
        const manifest = parseManifest(JSON.parse(await readFile(
          join(this.channelsPath, entry.name, "channel.json"),
          "utf8",
        )));
        if (manifest.key !== entry.name) throw new Error("Manifest Key does not match directory");
        this.records.set(manifest.key, manifest);
      } catch (cause) {
        this.warn("storage.manifest_invalid", { key: entry.name, cause });
      }
    }
    await this.writeCatalog();
  }
}
```

Do not delete invalid names, missing Manifests, malformed JSON, unknown versions, temporary files not owned by the current process, or unregistered namespace directories. Report each skipped entry through the exact constructor callback `warn(code, fields)`.

- [ ] **Step 5: Implement atomic JSON and channel-directory commits**

Use same-parent temporary paths and one Manifest commit point:

```ts
async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

private async createChannel(manifest: ChannelManifest): Promise<void> {
  const destination = join(this.channelsPath, manifest.key);
  const temporary = join(this.channelsPath, `.${manifest.key}.${randomUUID()}.tmp`);
  try {
    await mkdir(temporary);
    await writeJsonAtomic(join(temporary, "channel.json"), manifest);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

private async writeCatalog(): Promise<void> {
  const channels = [...this.records.values()].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  await writeJsonAtomic(this.catalogPath, { formatVersion: FORMAT_VERSION, channels });
}
```

Serialize mutation methods through `this.tail`. If a Manifest commit succeeds but `writeCatalog` fails, retain the record and report `catalog.write_failed`; the next mutation or `start()` must retry from Manifests.

- [ ] **Step 6: Write failing namespace and path safety tests**

Add table-driven tests to `core/tests/storage.test.ts`:

```ts
it.each(["", "Workspace", "a/../b", "con", "name-"])(
  "rejects invalid namespace %j",
  (namespace) => expect(() => storage.register(namespace)).toThrow(),
);

it("rejects duplicate namespace registration without deleting data", () => {
  const dispose = storage.register("workspace");
  expect(() => storage.register("workspace")).toThrow("already registered");
  dispose();
  expect(() => storage.register("workspace")).not.toThrow();
});

it.each(["", ".", "..", "/absolute", "a/b", "a\\b", "a\0b", "con", "con.txt", "a:b"])(
  "rejects unsafe segment %j",
  async (segment) => {
    storage.register("workspace");
    await expect(storage.ensure(shared, "workspace", segment)).rejects.toThrow();
  },
);
```

- [ ] **Step 7: Implement registration, containment, ensure, list, and name refresh**

Implement these public methods:

```ts
register(namespace: string): () => void;
ensure(scope: ChannelScope, namespace: string, ...segments: string[]): Promise<string>;
list(filter?: ChannelFilter): readonly ChannelRecord[];
updateName(scope: ChannelScope, name: string | undefined): Promise<void>;
```

Required behavior:

```ts
private assertSegment(segment: string): void {
  const windowsStem = segment.split(".", 1)[0];
  if (
    !segment || segment === "." || segment === ".." || isAbsolute(segment) ||
    segment.includes("/") || segment.includes("\\") || segment.includes("\0") ||
    WINDOWS_RESERVED.test(windowsStem) || /[<>:"|?*]/.test(segment)
  ) throw new TypeError(`Invalid storage path segment: ${JSON.stringify(segment)}`);
}

private assertContained(root: string, path: string): void {
  const rel = relative(root, path);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) return;
  throw new Error("Resolved storage path escapes its namespace root");
}
```

`ensure` must verify an existing Manifest against the requested Scope before creating the registered namespace root. It must return an absolute path. `updateName` must ignore empty names and rewrite only when a non-empty value changes. `list` returns frozen copies sorted by Key and applies exact equality to every supplied filter field.

- [ ] **Step 8: Add recovery and collision tests**

Extend the `fs/promises` test imports with `mkdir`, `writeFile`, and `unlink`, then add these cases to `core/tests/storage.test.ts`:

```ts
it("rebuilds a missing Catalog from valid Manifests", async () => {
  storage.register("workspace");
  await storage.ensure(shared, "workspace");
  await unlink(join(basePath, "channels.json"));

  const restarted = new ChannelStorage(basePath);
  await restarted.start();

  const catalog = JSON.parse(await readFile(join(basePath, "channels.json"), "utf8"));
  expect(catalog.channels).toEqual([
    expect.objectContaining({ key: "a5vnf2ijd75c2ibyo2s5czdir4" }),
  ]);
});

it("preserves and excludes a malformed Manifest", async () => {
  const key = "a5vnf2ijd75c2ibyo2s5czdir4";
  const root = join(basePath, "channels", key);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "channel.json"), "{broken", "utf8");

  const restarted = new ChannelStorage(basePath);
  await restarted.start();

  expect(restarted.list()).toEqual([]);
  expect(await readFile(join(root, "channel.json"), "utf8")).toBe("{broken");
});

it("rejects an identity mismatch in an existing Key directory", async () => {
  storage.register("workspace");
  await storage.ensure(shared, "workspace");
  const path = join(
    basePath,
    "channels",
    "a5vnf2ijd75c2ibyo2s5czdir4",
    "channel.json",
  );
  const manifest = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, `${JSON.stringify({ ...manifest, channelId: "other" }, null, 2)}\n`);

  const restarted = new ChannelStorage(basePath);
  await restarted.start();
  restarted.register("workspace");
  await expect(restarted.ensure(shared, "workspace")).rejects.toThrow(/integrity|identity/i);
});

it("sorts Catalog records by ASCII Key", async () => {
  storage.register("workspace");
  await storage.ensure(shared, "workspace");
  await storage.ensure({ ...shared, selfId: "20000", isDirect: true }, "workspace");

  const catalog = JSON.parse(await readFile(join(basePath, "channels.json"), "utf8"));
  const keys = catalog.channels.map((record: { key: string }) => record.key);
  expect(keys).toEqual([...keys].sort());
});

it("preserves unknown namespace directories", async () => {
  storage.register("workspace");
  const workspace = await storage.ensure(shared, "workspace");
  const unknown = join(workspace, "..", "unknown-module");
  await mkdir(unknown);
  await writeFile(join(unknown, "keep.txt"), "keep", "utf8");

  const restarted = new ChannelStorage(basePath);
  await restarted.start();

  expect(await readFile(join(unknown, "keep.txt"), "utf8")).toBe("keep");
});

it("shares one startup scan across concurrent callers", async () => {
  const pending = new ChannelStorage(basePath);
  await Promise.all([pending.start(), pending.start(), pending.start()]);
  expect(pending.list()).toEqual([]);
});
```

Use real temporary directories and verify both returned records and on-disk bytes. Do not mock `fs/promises` for recovery tests.

- [ ] **Step 9: Run storage tests and Core type checking**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/storage.test.ts tests/channel.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

Expected: all tests PASS and the new storage types compile without public path-generation helpers.

- [ ] **Step 10: Commit the private storage manager**

```bash
rtk git add core/src/storage/index.ts core/src/index.ts core/tests/storage.test.ts
rtk git commit -m "feat(core): add channel storage manager"
```

---

## Task 3: YesImBotService And Core Storage Consumers

**Files:**
- Modify: `core/src/service.ts`
- Modify: `core/src/runtime/manager.ts`
- Modify: `core/src/runtime/channel.ts`
- Modify: `core/src/runtime/storage.ts`
- Modify: `core/src/shared/asset.ts`
- Modify: `core/src/channel/index.ts`
- Modify: `core/src/index.ts`
- Modify: `core/tests/service.test.ts`
- Modify: `core/tests/jsonl-storage.test.ts`
- Modify: `core/tests/asset.test.ts`
- Modify: `core/tests/runtime-manager.test.ts`
- Modify: `core/tests/channel-runtime.test.ts`

**Interfaces:**
- Consumes: `ChannelStorage` from Task 2
- Produces on `YesImBotService`: `channelKey`, `registerStorage`, `ensureStorage`, `listChannels`
- Changes `ChannelRuntimeOptions`: receives a prepared `AgentStorage` instead of constructing a path
- Changes `AssetStoreOptions`: receives `storage: ChannelStorage` instead of `basePath`

- [ ] **Step 1: Write failing facade and initialization tests**

Extend `core/tests/service.test.ts`:

```ts
it("exposes Core channel storage methods", async () => {
  await service.start();
  const dispose = service.registerStorage("workspace");
  const scope = { platform: "onebot", selfId: "10000", channelId: "123456", isDirect: false };

  expect(service.channelKey(scope)).toBe("a5vnf2ijd75c2ibyo2s5czdir4");
  await expect(service.ensureStorage(scope, "workspace")).resolves.toContain(
    "channels/a5vnf2ijd75c2ibyo2s5czdir4/workspace",
  );
  expect(service.listChannels()).toEqual([
    expect.objectContaining({ key: "a5vnf2ijd75c2ibyo2s5czdir4", selfId: null }),
  ]);
  dispose();
});
```

Also assert that Gateway does not route a Session until `service.start()` has completed storage initialization.

- [ ] **Step 2: Run the facade test and confirm methods are missing**

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/service.test.ts
```

Expected: FAIL because `YesImBotService` does not expose storage methods or initialize `ChannelStorage`.

- [ ] **Step 3: Own and delegate the storage manager from YesImBotService**

Use one private instance and direct methods in `core/src/service.ts`:

```ts
private readonly storage: ChannelStorage;

constructor(ctx: Context, config: Config) {
  super(ctx, "yesimbot", true);
  const basePath = resolveBasePath(config.basePath, ctx.baseDir);
  this.storage = new ChannelStorage(basePath, (code, fields) => {
    this.logger.warn({ code, ...fields });
  });
  this.asset = new AssetStore({
    storage: this.storage,
    maxFileBytes: IMAGE_BUDGET.maxBytesPerImage,
  });
  this.rt = new RuntimeManager({
    ctx,
    config,
    logger: this.logger,
    assets: this.asset,
    storage: this.storage,
    getAgentPluginFactories: () => [...this.plugins].map(({ factory }) => factory),
  });
  this.gate = new Gateway({
    ctx,
    assets: this.asset,
    runtime: this.rt,
    storage: this.storage,
    ready: () => this.storage.start(),
    logger: this.logger,
  });
}

override async start(): Promise<void> {
  await this.storage.start();
}

channelKey(scope: ChannelScope): string {
  return channelKey(scope);
}

registerStorage(namespace: string): () => void {
  return this.storage.register(namespace);
}

ensureStorage(scope: ChannelScope, namespace: string, ...segments: string[]): Promise<string> {
  return this.storage.ensure(scope, namespace, ...segments);
}

listChannels(filter?: ChannelFilter): readonly ChannelRecord[] {
  return this.storage.list(filter);
}
```

Re-export only `ChannelScope`, `ChannelRecord`, and `ChannelFilter` from `core/src/index.ts`. Keep `ChannelStorage` private to Core source.

Add `storage: ChannelStorage` and `ready: () => Promise<void>` to `GatewayOptions`. Await `ready()` as the first operation in `Gateway.route`, before Scope admission or Resolver work. Add a service test with a deferred `ready` Promise and assert that Database, Resolver, AssetStore, and Runtime are untouched until it resolves.

- [ ] **Step 4: Write failing JSONL and Asset path tests**

Update `core/tests/jsonl-storage.test.ts` and `core/tests/asset.test.ts` to assert exact paths:

```ts
expect(jsonlPath).toBe(join(
  basePath,
  "channels",
  "a5vnf2ijd75c2ibyo2s5czdir4",
  "sessions",
  "messages.jsonl",
));

expect(assetPath).toBe(join(
  basePath,
  "channels",
  "a5vnf2ijd75c2ibyo2s5czdir4",
  "assets",
  contentHash,
));
```

Add a reset assertion that `channel.json`, `channels.json`, and a manually created `workspace/keep.txt` survive while `messages.jsonl` and asset files disappear.

- [ ] **Step 5: Inject prepared AgentStorage into ChannelRuntime**

Keep `createJsonlStorage(filePath)` in `core/src/runtime/storage.ts`, but delete `createChannelStorage(basePath, scope)`. In `RuntimeManager.createRuntime`:

```ts
const storagePath = await this.opts.storage.ensure(
  scope,
  "sessions",
  "messages.jsonl",
);
const agentStorage = createJsonlStorage(storagePath);

return {
  generation,
  selfId: scope.selfId,
  runtime: new ChannelRuntime({
    ctx: this.opts.ctx,
    config: this.opts.config,
    logger: this.opts.logger,
    scope,
    bot,
    will,
    assets: this.opts.assets,
    model,
    agentPlugins: plugins,
    includeMessageId,
    storage: agentStorage,
  }),
};
```

Change `ChannelRuntimeOptions` to include `storage: AgentStorage`, and pass `opts.storage` directly to `createAgent`. Remove `resolveBasePath` and `createChannelStorage` from `core/src/runtime/channel.ts`.

- [ ] **Step 6: Resolve Asset paths through the storage manager**

Refactor `core/src/shared/asset.ts`:

```ts
export interface AssetStoreOptions {
  storage: ChannelStorage;
  maxFileBytes: number;
}

private async assetPath(scope: ChannelScope, hash?: string): Promise<string> {
  return hash
    ? this.storage.ensure(scope, "assets", hash)
    : this.storage.ensure(scope, "assets");
}
```

Await `assetPath` in `put`, `readByAssetId`, and `clear`. Preserve the existing content hash, temporary-file write, MIME checks, size checks, integrity validation, and `asset_<hash>` public ID.

- [ ] **Step 7: Keep reset narrow and remove legacy path helpers**

Update `RuntimeManager.clearPersisted` to resolve `sessions/messages.jsonl`, call `createJsonlStorage(path).clear()`, then call `assets.clear(scope)`. Keep independent cleanup attempts and error reporting. In `ChannelRuntime.reset`, continue clearing its injected Agent storage and AssetStore only.

After all Core consumers use `ChannelStorage`, delete `channelFileName` and `channelPath` from `core/src/channel/index.ts` and remove tests for `channel_v2_*` output. Do not leave compatibility wrappers.

- [ ] **Step 8: Run Core storage-consumer tests**

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run \
  tests/service.test.ts \
  tests/jsonl-storage.test.ts \
  tests/asset.test.ts \
  tests/runtime-manager.test.ts \
  tests/channel-runtime.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

Expected: all selected tests PASS; reset preserves non-Session namespaces; no source import references `channelFileName` or `channelPath`.

- [ ] **Step 9: Commit Core storage integration**

```bash
rtk git add \
  core/src/service.ts \
  core/src/runtime/manager.ts \
  core/src/runtime/channel.ts \
  core/src/runtime/storage.ts \
  core/src/shared/asset.ts \
  core/src/channel/index.ts \
  core/src/index.ts \
  core/tests/service.test.ts \
  core/tests/jsonl-storage.test.ts \
  core/tests/asset.test.ts \
  core/tests/runtime-manager.test.ts \
  core/tests/channel-runtime.test.ts
rtk git commit -m "refactor(core): unify channel storage paths"
```

---

## Task 4: Database-Backed Assignee Admission

**Files:**
- Create: `core/src/assignee.ts`
- Create: `core/tests/assignee.test.ts`
- Modify: `core/src/index.ts`
- Modify: `core/src/service.ts`
- Modify: `core/src/gateway/index.ts`
- Modify: `core/src/runtime/manager.ts`
- Modify: `core/tests/gateway.test.ts`
- Modify: `core/tests/service.test.ts`
- Modify: `core/tests/runtime-manager.test.ts`

**Interfaces:**
- Produces: `assertAssignee(ctx: Context, scope: ChannelScope): Promise<void>`
- Produces: `AssigneeAdmissionError` with stable `reason: "missing" | "empty" | "mismatch"`
- Consumes: Koishi `ctx.database.get("channel", { platform, id }, ["assignee"])`

- [ ] **Step 1: Write focused assignee resolver tests**

Create `core/tests/assignee.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { assertAssignee, AssigneeAdmissionError } from "../src/assignee.js";

const shared = { platform: "onebot", selfId: "10000", channelId: "123", isDirect: false };
const direct = { ...shared, isDirect: true };

it("accepts the database assignee", async () => {
  const ctx = { database: { get: vi.fn().mockResolvedValue([{ assignee: "10000" }]) } };
  await expect(assertAssignee(ctx as never, shared)).resolves.toBeUndefined();
  expect(ctx.database.get).toHaveBeenCalledWith(
    "channel",
    { platform: "onebot", id: "123" },
    ["assignee"],
  );
});

it.each([
  [[], "missing"],
  [[{ assignee: "" }], "empty"],
  [[{ assignee: "20000" }], "mismatch"],
] as const)("rejects invalid assignment %#", async (rows, reason) => {
  const ctx = { database: { get: vi.fn().mockResolvedValue(rows) } };
  await expect(assertAssignee(ctx as never, shared)).rejects.toMatchObject({ reason });
});

it("does not query Database for direct scopes", async () => {
  const ctx = { database: { get: vi.fn() } };
  await assertAssignee(ctx as never, direct);
  expect(ctx.database.get).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the assignee test and confirm the module is missing**

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/assignee.test.ts
```

Expected: FAIL because `core/src/assignee.ts` does not exist.

- [ ] **Step 3: Implement one fail-closed assignee helper**

```ts
import type { Context } from "koishi";
import type { ChannelScope } from "./channel/index.js";

export class AssigneeAdmissionError extends Error {
  constructor(
    readonly reason: "missing" | "empty" | "mismatch",
    readonly scope: ChannelScope,
  ) {
    super(`Shared channel assignee admission failed: ${reason}`);
  }
}

export async function assertAssignee(ctx: Context, scope: ChannelScope): Promise<void> {
  if (scope.isDirect) return;
  const [channel] = await ctx.database.get(
    "channel",
    { platform: scope.platform, id: scope.channelId },
    ["assignee"],
  );
  if (!channel) throw new AssigneeAdmissionError("missing", scope);
  if (!channel.assignee) throw new AssigneeAdmissionError("empty", scope);
  if (channel.assignee !== scope.selfId) throw new AssigneeAdmissionError("mismatch", scope);
}
```

Do not catch Database transport errors in this helper. Gateway and RuntimeManager must log them as admission failures and skip side effects.

- [ ] **Step 4: Require Database at plugin and service boundaries**

In `core/src/index.ts` and `core/src/service.ts`:

```ts
export const inject = ["database"];

export class YesImBotService extends Service<Config> {
  static readonly inject = ["yesimbot.model", "database"];
}
```

Update service tests to install or mock Database. No configuration fallback is permitted.

- [ ] **Step 5: Add failing Gateway pre-resolution tests**

In `core/tests/gateway.test.ts`, assert all four shared failures skip Resolver, AssetStore, and Runtime:

```ts
it.each([
  [[], "missing"],
  [[{ assignee: "" }], "empty"],
  [[{ assignee: "other" }], "mismatch"],
])("rejects shared admission before resolver %#", async (rows) => {
  database.get.mockResolvedValue(rows);
  await gateway.handle(sharedSession);
  expect(resolver.resolve).not.toHaveBeenCalled();
  expect(assets.put).not.toHaveBeenCalled();
  expect(runtime.route).not.toHaveBeenCalled();
});
```

Add a Session marked `atSelf` and a command-prefix message for the non-assignee; both must remain rejected by the YesImBot Gateway. Add a direct Session case that routes without a database query.

- [ ] **Step 6: Gate Gateway before Resolver and metadata writes**

At the start of `Gateway.route`:

```ts
const scope = scopeFromSession(session);
if (!scope) return;
try {
  await assertAssignee(this.opts.ctx, scope);
} catch (cause) {
  this.warn("gateway.assignee_rejected", cause, session.platform);
  return;
}

// Only now call resolve(session), image freezing, storage metadata update, and runtime.route.
```

After Resolver validation succeeds, call the storage manager's internal name refresh with the non-empty `record.channel.name` before Runtime submission. Keep the EventRecord Session-free.

- [ ] **Step 7: Revalidate at Runtime submission and reset**

In `RuntimeManager.route`, call `assertAssignee(this.opts.ctx, scope)` inside the per-Key lifecycle path immediately before Runtime lookup or submission. In `YesImBotService.reset`, call the same helper before `rt.reset(scope)` so non-assignee state-changing commands fail closed.

Do not apply this admission helper to the Task 5 internal delivery completion lane; it belongs to an already admitted Runtime generation.

- [ ] **Step 8: Run assignee, Gateway, service, and Runtime tests**

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run \
  tests/assignee.test.ts \
  tests/gateway.test.ts \
  tests/service.test.ts \
  tests/runtime-manager.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

Expected: all selected tests PASS; every shared route queries Database before Resolver work; direct routes do not query it.

- [ ] **Step 9: Commit database admission**

```bash
rtk git add \
  core/src/index.ts \
  core/src/assignee.ts \
  core/src/service.ts \
  core/src/gateway/index.ts \
  core/src/runtime/manager.ts \
  core/tests/assignee.test.ts \
  core/tests/gateway.test.ts \
  core/tests/service.test.ts \
  core/tests/runtime-manager.test.ts
rtk git commit -m "feat(core): enforce channel assignee admission"
```

---

## Task 5: Runtime Delivery Ownership And Graceful Drain

**Files:**
- Modify: `core/src/runtime/channel.ts`
- Modify: `core/src/runtime/manager.ts`
- Modify: `core/src/gateway/index.ts`
- Modify: `core/tests/channel-runtime.test.ts`
- Modify: `core/tests/gateway-delivery.test.ts`

**Interfaces:**
- Produces on `ChannelRuntime`: `beginDrain()`, `acquireDeliveryLease()`, `handleInternal(record)`, `drainAndStop()`
- Produces: a run-result delivery binding with `fail(record)` and idempotent `release()`

- [ ] **Step 1: Write ChannelRuntime delivery-lease tests**

In `core/tests/channel-runtime.test.ts`, use deferred Promises to prove drain ordering:

```ts
it("waits for delivery release before graceful stop", async () => {
  const runtime = createRuntime();
  const release = runtime.acquireDeliveryLease();
  const stop = runtime.drainAndStop();

  await Promise.resolve();
  expect(agent.stop).not.toHaveBeenCalled();
  expect(agent.interrupt).not.toHaveBeenCalled();

  release();
  await stop;
  expect(agent.wait).toHaveBeenCalled();
  expect(agent.stop).toHaveBeenCalled();
  expect(agent.interrupt).not.toHaveBeenCalled();
});

it("accepts internal completion while rejecting new platform events", async () => {
  runtime.beginDrain();
  await expect(runtime.handle(messageRecord)).rejects.toThrow("draining");
  await expect(runtime.handleInternal(deliveryFailureRecord)).resolves.toMatchObject({
    kind: "wait",
  });
});
```

- [ ] **Step 2: Run ChannelRuntime tests and confirm drain methods are missing**

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel-runtime.test.ts
```

Expected: FAIL because delivery leases and graceful drain do not exist.

- [ ] **Step 3: Add drain state and idempotent delivery leases**

Add these fields and methods to `ChannelRuntime`:

```ts
private draining = false;
private deliveryLeases = 0;
private deliveryWaiters = new Set<() => void>();
private drainTask: Promise<void> | undefined;

beginDrain(): void {
  if (this.stopped) throw new Error("Channel runtime is stopped");
  this.draining = true;
}

acquireDeliveryLease(): () => void {
  if (this.stopped) throw new Error("Channel runtime is stopped");
  this.deliveryLeases += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    this.deliveryLeases -= 1;
    if (this.deliveryLeases === 0) {
      for (const resolve of this.deliveryWaiters) resolve();
      this.deliveryWaiters.clear();
    }
  };
}

private waitForDeliveries(): Promise<void> {
  if (this.deliveryLeases === 0) return Promise.resolve();
  return new Promise((resolve) => this.deliveryWaiters.add(resolve));
}
```

Refactor event handling into one private `handleRecord(record, internal)` method. `handle()` rejects while `draining`; `handleInternal()` permits an already admitted generation's completion work until `stopped` becomes true. Both must use the same ChannelRuntime FIFO and Event/Will ordering.

- [ ] **Step 4: Implement graceful drain without interrupt**

```ts
drainAndStop(): Promise<void> {
  if (this.drainTask) return this.drainTask;
  this.beginDrain();
  this.drainTask = (async () => {
    await this.waitForDeliveries();
    await this.agent.wait();
    await Promise.allSettled([...this.streams]);
    this.stopped = true;
    await this.agent.stop();
    await this.opts.will.stop?.();
  })();
  return this.drainTask;
}
```

Keep existing `stop()` and `reset()` interrupt semantics for explicit shutdown/reset. If `drainAndStop` fails, retain `draining = true`; do not reopen the Runtime.

- [ ] **Step 5: Write Gateway tests for delivery ownership**

In `core/tests/gateway-delivery.test.ts`, change the Runtime run-result mock to include a delivery binding and verify its lifecycle:

```ts
it("releases the delivery lease after output iteration", async () => {
  const release = vi.fn();
  runtime.route.mockResolvedValue({
    kind: "run",
    eventId: "evt-1",
    turnId: "turn-1",
    output: outputs([{ turnId: "turn-1", messageId: "msg-1", content: "ok" }]),
    delivery: { fail: vi.fn(), release },
  });

  await gateway.handle(session);

  expect(session.send).toHaveBeenCalledWith("ok");
  expect(release).toHaveBeenCalledOnce();
});

it("persists send failure through the bound old generation", async () => {
  session.send.mockRejectedValue(new Error("offline"));
  await gateway.handle(session);
  expect(delivery.fail).toHaveBeenCalledWith(expect.objectContaining({
    type: "delivery.failed",
    delivery: expect.objectContaining({ messageId: "msg-1" }),
  }));
  expect(runtime.route).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 6: Bind each run result to its Runtime generation**

In `RuntimeManager.route`, after `runtime.handle(record)` returns `kind: "run"`, acquire a lease and return:

```ts
const result = await runtime.handle(record);
if (result.kind !== "run") return result;
const release = runtime.acquireDeliveryLease();
return {
  ...result,
  delivery: {
    fail: (failure: EventRecord<"delivery.failed">) => runtime.handleInternal(failure),
    release,
  },
};
```

In Gateway, construct the same sanitized `delivery.failed` EventRecord as today, call `result.delivery.fail(failure)`, and invoke `result.delivery.release()` in a `finally` block around the complete output loop. Do not call `RuntimeManager.route` for this completion event.

- [ ] **Step 7: Run delivery ownership tests and commit**

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run \
  tests/channel-runtime.test.ts \
  tests/gateway-delivery.test.ts \
  tests/gateway.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
rtk git add core/src/runtime/channel.ts core/src/runtime/manager.ts core/src/gateway/index.ts core/tests/channel-runtime.test.ts core/tests/gateway-delivery.test.ts core/tests/gateway.test.ts
rtk git commit -m "feat(core): track runtime delivery ownership"
```

Expected: all selected tests PASS; each Gateway run holds one lease; delivery failure remains bound to the old Runtime generation; graceful drain does not interrupt a normal turn.

---

## Task 6: Two-Phase RuntimeManager Handover

**Files:**
- Modify: `core/src/runtime/manager.ts`
- Modify: `core/tests/runtime-manager.test.ts`

**Interfaces:**
- Consumes: `beginDrain()` and `drainAndStop()` from Task 5
- Consumes: `assertAssignee` from Task 4 before replacement creation
- Changes `RuntimeEntry`: `{ generation; selfId; state; runtime }`

- [ ] **Step 1: Write failing RuntimeManager handover tests**

Add controlled Runtime doubles in `core/tests/runtime-manager.test.ts`:

```ts
it("drains the old assignee outside the lifecycle coordinator", async () => {
  database.get.mockResolvedValueOnce([{ assignee: "old" }]);
  await manager.route(sharedRecord({ selfId: "old" }));

  database.get.mockResolvedValue([{ assignee: "new" }]);
  const pending = manager.route(sharedRecord({ selfId: "new" }));
  await vi.waitFor(() => expect(oldRuntime.beginDrain).toHaveBeenCalled());

  // Reset must be able to enter the coordinator while old drain is pending.
  const reset = manager.reset(sharedScope({ selfId: "new" }));
  expect(oldRuntime.drainAndStop).toHaveBeenCalled();
  oldDrain.resolve();

  await pending;
  await reset;
  expect(createRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ selfId: "new" }));
});
```

Add separate tests for: assignee changes again before phase two, old drain rejection, six simultaneous waiting events, direct scopes using distinct Keys, and five waiters sharing one handover Promise.

Add explicit reset and stop coordination tests:

```ts
it("waits for handover outside the coordinator before reset cleanup", async () => {
  database.get.mockResolvedValue([{ assignee: "new" }]);
  const route = manager.route(sharedRecord({ selfId: "new" }));
  await vi.waitFor(() => expect(oldRuntime.beginDrain).toHaveBeenCalled());
  const reset = manager.reset(sharedScope({ selfId: "new" }));

  expect(oldRuntime.reset).not.toHaveBeenCalled();
  oldDrain.resolve();
  await route;
  await reset;
  expect(newRuntime.reset).toHaveBeenCalledOnce();
});

it("explicit global stop interrupts a draining Runtime without replacement", async () => {
  database.get.mockResolvedValue([{ assignee: "new" }]);
  const route = manager.route(sharedRecord({ selfId: "new" }));
  await vi.waitFor(() => expect(oldRuntime.beginDrain).toHaveBeenCalled());

  const stop = manager.stop();
  oldDrain.reject(new Error("stopped"));
  await stop;

  await expect(route).rejects.toThrow(/stopped|handover/i);
  expect(oldRuntime.stop).toHaveBeenCalled();
  expect(createRuntime).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Implement RuntimeEntry state and handover coordination**

Use explicit mutable state rather than inferring from Promises:

```ts
interface RuntimeEntry {
  readonly generation: number;
  readonly selfId: string;
  state: "active" | "draining" | "failed";
  readonly runtime: ChannelRuntime;
}

private readonly handovers = new Map<string, Promise<void>>();
private readonly handoverWaiters = new Map<string, number>();
```

Implement `awaitHandover(key, entry)` in two phases:

```ts
private async awaitHandover(key: string, entry: RuntimeEntry): Promise<void> {
  const waiting = this.handoverWaiters.get(key) ?? 0;
  if (waiting >= 5) throw new Error("Channel handover queue is full");
  this.handoverWaiters.set(key, waiting + 1);
  try {
    let task = this.handovers.get(key);
    if (!task) {
      task = this.runHandover(key, entry);
      this.handovers.set(key, task);
      void task.finally(() => {
        if (this.handovers.get(key) === task) this.handovers.delete(key);
      });
    }
    await task;
  } finally {
    const remaining = (this.handoverWaiters.get(key) ?? 1) - 1;
    if (remaining === 0) this.handoverWaiters.delete(key);
    else this.handoverWaiters.set(key, remaining);
  }
}
```

`runHandover` must:

1. Enter `enqueueLifecycle`, verify `this.runtimes.get(key) === entry`, set `state = "draining"`, and call `runtime.beginDrain()`.
2. Release `enqueueLifecycle`, then await `runtime.drainAndStop()`.
3. On failure, enter `enqueueLifecycle`, set the unchanged Entry to `failed`, and rethrow.
4. On success, enter `enqueueLifecycle`, verify the same Entry, and delete it.

Do not create the replacement in `runHandover`. Waiting callers return to `getOrCreate`, re-run `assertAssignee`, and use the existing `creating` deduplication to construct exactly one replacement.

Refactor `reset` so it snapshots any active handover inside `enqueueLifecycle`, releases the coordinator, awaits that Promise, and retries from the beginning. It MUST NOT call `runtime.reset()` while the Entry is draining. If an Entry is `failed`, explicit reset MAY interrupt that Runtime and clear Session/Asset data as the recovery path.

Refactor global stop so it sets `stopped` first, interrupt-stops every Runtime including draining entries, waits tracked handover tasks to settle, clears Runtime/creating/handover maps, and prevents phase two from creating any replacement after shutdown begins.

- [ ] **Step 3: Reject failed entries and recheck assignment on every retry**

In `getOrCreate(scope)`:

```ts
const existing = this.runtimes.get(key);
if (existing?.state === "failed") throw new Error("Channel handover failed; restart required");
if (existing?.generation === this.gen && existing.selfId === scope.selfId) {
  return existing.runtime;
}
if (existing && existing.selfId !== scope.selfId) {
  await this.awaitHandover(key, existing);
  await assertAssignee(this.opts.ctx, scope);
  return this.getOrCreate(scope);
}
```

Inside the lifecycle operation that creates a replacement, call `assertAssignee` again immediately before `createRuntime`. Preserve current Will-generation replacement behavior for the same `selfId`.

- [ ] **Step 4: Run all handover and delivery tests**

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run \
  tests/channel-runtime.test.ts \
  tests/runtime-manager.test.ts \
  tests/gateway-delivery.test.ts \
  tests/gateway.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
```

Expected: all selected tests PASS; delivery completion does not re-enter assignee admission; drain does not hold the lifecycle coordinator; the sixth waiting event is rejected.

- [ ] **Step 5: Commit online handover**

```bash
rtk git add core/src/runtime/manager.ts core/tests/runtime-manager.test.ts
rtk git commit -m "feat(core): hand over channel assignees online"
```

---

## Task 7: Workspace Namespace Integration

**Files:**
- Modify: `plugins/workspace/src/index.ts`
- Modify: `plugins/workspace/tests/plugin.test.ts`

**Interfaces:**
- Consumes: `ctx.yesimbot.registerStorage("workspace")`
- Consumes: `ctx.yesimbot.ensureStorage(channel, "workspace")`
- Consumes: `ctx.yesimbot.channelKey(channel)` for the in-memory cache
- Removes: `WorkspacePluginConfig.root` and `workspaceDirectoryId`

- [ ] **Step 1: Write failing plugin tests for Core-resolved roots**

Update the YesImBot mock in `plugins/workspace/tests/plugin.test.ts` and add:

```ts
it("registers workspace storage and uses the Core path", async () => {
  const disposeStorage = vi.fn();
  yesimbot.registerStorage.mockReturnValue(disposeStorage);
  yesimbot.channelKey.mockReturnValue("a5vnf2ijd75c2ibyo2s5czdir4");
  yesimbot.ensureStorage.mockResolvedValue(
    "/data/yesimbot/channels/a5vnf2ijd75c2ibyo2s5czdir4/workspace",
  );

  await plugin.start();
  const agent = await registeredFactory({ channel: sharedScope, bot } as never);
  await agent.tools!({} as never);

  expect(yesimbot.registerStorage).toHaveBeenCalledWith("workspace");
  expect(yesimbot.ensureStorage).toHaveBeenCalledWith(sharedScope, "workspace");
  expect(workspaceConfig.root).toBe(
    "/data/yesimbot/channels/a5vnf2ijd75c2ibyo2s5czdir4/workspace",
  );

  await plugin.stop();
  expect(disposeStorage).toHaveBeenCalledOnce();
});
```

Add a second test that requests scopes `{ selfId: "old", isDirect: false }` and `{ selfId: "new", isDirect: false }`, returns the same Key, and asserts one cached Workspace. Add direct scopes with different Keys and assert two Workspaces.

- [ ] **Step 2: Run the Workspace plugin test and confirm legacy root behavior fails**

```bash
rtk yarn workspace koishi-plugin-yesimbot-workspace exec vitest run tests/plugin.test.ts
```

Expected: FAIL because the plugin still requires `config.root` and computes `workspace_v2_*` locally.

- [ ] **Step 3: Remove the plugin-owned channel root configuration**

Change `WorkspacePluginConfig` and Config schema in `plugins/workspace/src/index.ts`:

```ts
export interface WorkspacePluginConfig {
  cwd: string;
  persistPaths?: Record<string, string>;
  readOnlyPaths?: Record<string, string>;
  overlayPaths?: Record<string, string>;
  timeoutMs?: number;
  enableNetwork?: boolean;
  enablePython?: boolean;
  enableJavascript?: boolean;
}
```

Delete the `root` schema field, `rootPath` state, startup `mkdir(rootPath)`, `workspaceDirectoryId`, and `node:crypto`/`join` imports used only by legacy path generation. Keep host mount path resolution and validation unchanged.

- [ ] **Step 4: Register and dispose the workspace namespace**

Add one registration disposer:

```ts
private disposeStorage?: () => void;

public async start(): Promise<void> {
  this.disposeAgentPlugin?.();
  this.disposeStorage?.();
  this.disposeStorage = this.ctx.yesimbot.registerStorage("workspace");
  // Validate configured host mounts, then register the Agent plugin.
}

public async stop(): Promise<void> {
  this.disposeAgentPlugin?.();
  this.disposeStorage?.();
  this.disposeAgentPlugin = undefined;
  this.disposeStorage = undefined;
  this.workspaces.clear();
  this.normalizedMounts = undefined;
}
```

If startup fails after namespace registration, invoke and clear `disposeStorage` before rethrowing so hot reload does not leave a stale registration.

- [ ] **Step 5: Resolve and cache by the Core Key**

Replace `getOrCreateWorkspace` path logic:

```ts
private async getOrCreateWorkspace(channel: ChannelScope): Promise<Workspace> {
  const key = this.ctx.yesimbot.channelKey(channel);
  const existing = this.workspaces.get(key);
  if (existing) return existing;
  if (!this.normalizedMounts) throw new Error("Workspace plugin has not been started");

  const workspaceRoot = await this.ctx.yesimbot.ensureStorage(channel, "workspace");
  const workspace = new Workspace(this.createWorkspaceConfig(workspaceRoot));
  await workspace.init();
  this.workspaces.set(key, workspace);
  return workspace;
}
```

Do not add Workspace deletion or handover callbacks. Shared assignee handover reuses the cache because the Core Key stays stable.

- [ ] **Step 6: Run all Workspace tests and package type checking**

```bash
rtk yarn workspace koishi-plugin-yesimbot-workspace exec vitest run tests/plugin.test.ts tests/workspace.test.ts tests/mounts.test.ts tests/bash-tool.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-workspace
```

Expected: all Workspace tests PASS; no source contains `workspace_v2_`, `workspaceDirectoryId`, or the removed `root` config field.

- [ ] **Step 7: Commit Workspace integration**

```bash
rtk git add plugins/workspace/src/index.ts plugins/workspace/tests/plugin.test.ts
rtk git commit -m "refactor(workspace): use core channel storage"
```

---

## Task 8: MemOS Channel Hash Integration

**Files:**
- Modify: `plugins/memos-client/src/types.ts`
- Modify: `plugins/memos-client/src/identity.ts`
- Modify: `plugins/memos-client/src/index.ts`
- Modify: `plugins/memos-client/scripts/qq-memos-import.ts`
- Modify: `plugins/memos-client/tests/identity.test.ts`
- Modify: `plugins/memos-client/tests/plugin.test.ts`
- Modify: `plugins/memos-client/tests/qq-memos-import.test.ts`
- Modify: `plugins/memos-client/tests/tools.test.ts`

**Interfaces:**
- Adds to `MemosIdentityInput` and `MemosImportChunkIdentityInput`: `channelHash: string`
- Consumes at runtime: `ctx.yesimbot.channelKey(channelScope)`
- Consumes in offline import: exported Core `channelKey(channelScope)`
- Preserves: MemOS `userId`, `conversationId`, `agentId`, author/message hashes, filters, and raw-info policy

- [ ] **Step 1: Replace identity test expectations with Core vectors**

In `plugins/memos-client/tests/identity.test.ts`, pass an explicit Core hash and verify no other identity changes:

```ts
const groupInput = {
  channelScope: {
    platform: "onebot",
    selfId: "10000",
    channelId: "123456",
    isDirect: false,
  },
  channelHash: "a5vnf2ijd75c2ibyo2s5czdir4",
  channelType: "group" as const,
  authorId: "user-1",
  turnId: "turn-1",
};

it("uses the caller-provided Core Channel Key as channel_hash", () => {
  const identity = deriveMemosIdentity(groupInput);
  expect(identity.info.channel_hash).toBe("a5vnf2ijd75c2ibyo2s5czdir4");
  expect(identity.agentId).toMatch(/^yb_agent_/);
  expect(identity.userId).toMatch(/^yb_subject_/);
  expect(identity.conversationId).toMatch(/^yb_conv_/);
});
```

Add two shared inputs with different `selfId` and the same `channelHash`; `channel_hash` must match while `agentId` differs. Add direct inputs with the two approved direct vectors.

- [ ] **Step 2: Run identity tests and confirm the new input is ignored**

```bash
rtk yarn workspace koishi-plugin-yesimbot-memos-client exec vitest run tests/identity.test.ts
```

Expected: FAIL because identity code still computes `memos-channel-v2` locally.

- [ ] **Step 3: Make Core Channel Key an explicit identity input**

Add `channelHash: string` to both input interfaces in `plugins/memos-client/src/types.ts`. In `plugins/memos-client/src/identity.ts`, delete `deriveChannelHash`, add canonical validation, and replace its two call sites:

```ts
const CHANNEL_KEY_PATTERN = /^[a-z2-7]{25}[aeimquy4]$/;

function readChannelHash(input: { readonly channelHash: string }): string {
  if (!CHANNEL_KEY_PATTERN.test(input.channelHash)) {
    throw new TypeError("channelHash must be a canonical Core Channel Key");
  }
  return input.channelHash;
}

// In deriveMemosIdentity:
const channelScopeId = readChannelHash(input);

// In deriveMemosImportChunkIdentity:
const channelScopeId = readChannelHash(input);
```

Validate `channelHash` against the public canonical Key pattern before sending it to MemOS. Do not derive it from raw fields inside memos-client.

- [ ] **Step 4: Pass the service Key from the runtime plugin**

Inside the existing `resolveIdentity` callback in `plugins/memos-client/src/index.ts`, construct the effective target Scope and pass its Core Key:

```ts
const channelType = target?.channelType ?? latestChannelType;
const channelScope = {
  platform: channelContext.channel.platform,
  selfId: channelContext.channel.selfId,
  channelId: target?.channelId ?? channelContext.channel.channelId,
  isDirect: channelType === "private",
};
const identity = deriveMemosIdentity({
  channelScope,
  channelHash: this.ctx.yesimbot.channelKey(channelScope),
  channelType,
  authorId: latestAuthorId,
  messageId: latestMessageId,
  turnId,
  memoryScope: this.config.memoryScope,
  includeRawIdentityInfo: this.config.includeRawIdentityInfo,
});
```

Compute the Key inside `resolveIdentity` because the debug channel-memory tool can override both `channelId` and `channelType`. Do not cache the outer channel's Key for a target override.

- [ ] **Step 5: Pass the exported Core Key from offline QQ import**

In `plugins/memos-client/scripts/qq-memos-import.ts`, import `channelKey` from `koishi-plugin-yesimbot` and construct a complete Scope:

```ts
const channelScope = {
  platform: PLATFORM,
  selfId: config.botSelfId,
  channelId: chunk.channelId,
  isDirect: chunk.conversationType === "private",
};

const identity = deriveMemosImportChunkIdentity({
  channelScope,
  channelHash: channelKey(channelScope),
  channelType: chunk.conversationType,
  chunkStartIso,
  chunkEndIso,
  firstMessageId,
  lastMessageId,
  chunkIndex,
  includeRawIdentityInfo,
});
```

Keep import chunk boundaries, overlap, subject identity, agent identity, and request payload behavior unchanged.

- [ ] **Step 6: Update plugin/import mocks and run package tests**

Update test YesImBot mocks with `channelKey`, and update all `ChannelScope` fixtures with `isDirect`. Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot-memos-client exec vitest run \
  tests/identity.test.ts \
  tests/plugin.test.ts \
  tests/qq-memos-import.test.ts \
  tests/tools.test.ts
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-memos-client
```

Expected: all selected tests PASS; `rg "memos-channel-v2|deriveChannelHash" plugins/memos-client` returns no source matches.

- [ ] **Step 7: Commit MemOS integration**

```bash
rtk git add \
  plugins/memos-client/src/types.ts \
  plugins/memos-client/src/identity.ts \
  plugins/memos-client/src/index.ts \
  plugins/memos-client/scripts/qq-memos-import.ts \
  plugins/memos-client/tests/identity.test.ts \
  plugins/memos-client/tests/plugin.test.ts \
  plugins/memos-client/tests/qq-memos-import.test.ts \
  plugins/memos-client/tests/tools.test.ts
rtk git commit -m "refactor(memos): use core channel key"
```

---

## Task 9: Documentation, Cross-Module Verification, And Cleanup

**Files:**
- Modify: `AGENTS.md`
- Modify: `core/README.md`
- Modify: `plugins/workspace/README.md`
- Modify: `plugins/memos-client/README.md`
- Modify: `docs/athena-development-log.md`
- Verify: `openspec/changes/unify-channel-storage-protocol/design.md`
- Verify: `openspec/changes/unify-channel-storage-protocol/specs/**/*.md`

**Interfaces:**
- Consumes: all public methods, file layouts, error behavior, and commands completed in Tasks 1-7
- Produces: operator and contributor documentation that matches the shipped protocol

- [ ] **Step 1: Update Core and contributor architecture documentation**

Document these exact contracts in `core/README.md` and `AGENTS.md`:

```text
ChannelScope = { platform, selfId, channelId, isDirect }
shared identity = platform + channelId
direct identity = platform + selfId + channelId
storage root = <basePath>/channels/<26-char-key>/
Manifest = channel.json
Catalog = <basePath>/channels.json
Session = sessions/messages.jsonl
Asset = assets/<content-hash>
Workspace = workspace/
```

State that Database is required, Koishi owns assignee, shared admission fails closed, online handover drains the old Runtime, and no legacy layout is read or migrated. Remove references to `channel_v2_*`, `workspace_v2_*`, `ChannelScopeId`, plugin-owned Channel roots, and public purge/lifecycle behavior.

- [ ] **Step 2: Update consumer documentation**

In `plugins/workspace/README.md`, remove the plugin `root` option and explain that the default persistent mount resolves through the Core `workspace` namespace. Preserve documentation for `persistPaths`, `readOnlyPaths`, `overlayPaths`, `cwd`, timeout, and network policy.

In `plugins/memos-client/README.md`, state that `channel_hash` is the Core Channel Key, shared channels retain it across assignee changes, direct channels retain bot isolation, and MemOS `user_id`, `conversation_id`, and `agent_id` remain plugin-owned.

Add one architecture evolution entry to `docs/athena-development-log.md` because this change alters persistent identity, filesystem ownership, and online Runtime handover. Do not record test process, OpenSpec mechanics, or commit history.

- [ ] **Step 3: Run targeted package test suites**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run \
  tests/channel.test.ts \
  tests/storage.test.ts \
  tests/assignee.test.ts \
  tests/gateway.test.ts \
  tests/gateway-delivery.test.ts \
  tests/runtime-manager.test.ts \
  tests/channel-runtime.test.ts \
  tests/jsonl-storage.test.ts \
  tests/asset.test.ts \
  tests/service.test.ts

rtk yarn workspace koishi-plugin-yesimbot-workspace exec vitest run
rtk yarn workspace koishi-plugin-yesimbot-memos-client exec vitest run
```

Expected: every selected Core test and both complete plugin suites PASS.

- [ ] **Step 4: Run static legacy and ownership scans**

Run:

```bash
rtk proxy rg -n "channel_v2_|workspace_v2_|ch_v1_|ChannelScopeId|deriveChannelHash|memos-channel-v2" \
  core/src plugins/workspace/src plugins/memos-client/src

rtk proxy rg -n "join\(.*channels|resolve\(.*channels|createHash\(.*channel" \
  plugins core/src/runtime core/src/shared
```

Expected: no source match for legacy identifiers or plugin-local Channel hashing. Any `channels` path join must exist only inside the private Core storage manager. Historical OpenSpec archives are excluded from this cleanup.

- [ ] **Step 5: Run package type checks and builds**

```bash
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-workspace
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-memos-client
rtk yarn turbo run build --filter=koishi-plugin-yesimbot
rtk yarn turbo run build --filter=koishi-plugin-yesimbot-workspace
rtk yarn turbo run build --filter=koishi-plugin-yesimbot-memos-client
```

Expected: all six commands exit successfully.

- [ ] **Step 6: Run the full repository pipeline in CI order**

```bash
rtk yarn lint
rtk yarn fmt:check
rtk yarn check-types
rtk yarn build
rtk yarn test
```

Expected: every command exits successfully. If an environment-only failure occurs, capture the exact command and error; do not mark this step complete until the failure is understood and either fixed or explicitly accepted by the maintainer.

- [ ] **Step 7: Validate OpenSpec and inspect the final diff**

```bash
rtk openspec validate "unify-channel-storage-protocol" --strict --json
rtk git diff --check
rtk git status --short
rtk git diff --stat
```

Expected: OpenSpec reports `valid: true` with no issues, `git diff --check` emits no output, and status contains only files required by this change.

- [ ] **Step 8: Commit documentation and final cleanup**

```bash
rtk git add AGENTS.md core/README.md plugins/workspace/README.md plugins/memos-client/README.md docs/athena-development-log.md
rtk git commit -m "docs: describe unified channel storage"
```

If verification required source or test corrections after the previous task commits, create one focused follow-up commit with only those corrections. Do not amend earlier commits.
