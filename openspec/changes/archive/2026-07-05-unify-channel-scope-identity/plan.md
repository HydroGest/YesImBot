# Channel Scope Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace duplicated channel target and ID derivation logic with a core-owned `ChannelScope` and canonical `ChannelScopeId` used by runtime, sessions, workspace, and MemOS.

**Architecture:** Core owns channel-scope types, deterministic ID generation, metadata-backed reverse lookup, and path helpers. Core runtime storage, workspace isolation, and MemOS channel identity consume these helpers instead of constructing keys, hashes, or sanitized path segments locally. Existing experimental data formats are intentionally ignored.

**Tech Stack:** TypeScript, Koishi, Node.js `crypto`, Node.js `fs/promises`, Yarn 4, Vitest, OpenSpec `superpowers-bridge`.

## Global Constraints

- All shell commands in this repo must use `rtk`.
- Use Yarn commands, not npm or pnpm.
- Do not implement legacy path readers, aliases, migration tools, or compatibility tests.
- `ChannelScopeId` format is `ch_v1_<16-char-lowercase-base32-hash>`.
- `ChannelScope` contains only `platform`, `selfId`, and `channelId`.
- Pure ID helpers must not perform filesystem I/O.
- Metadata-backed reverse lookup uses local `scope.json`.

---

### Task 1: Core Channel Scope API

**Files:**
- Create: `core/src/channel.ts`
- Modify: `core/src/index.ts`
- Modify: `core/package.json`
- Test: `core/tests/channel-scope.test.ts`

**Interfaces:**
- Produces:
  - `interface ChannelScope { readonly platform: string; readonly selfId: string; readonly channelId: string }`
  - `type ChannelScopeId = \`ch_v1_${string}\``
  - `interface ChannelScopeRecord { readonly version: 1; readonly id: ChannelScopeId; readonly scope: ChannelScope; readonly createdAt: string }`
  - `normalizeChannelScope(input: ChannelScope): ChannelScope`
  - `createChannelScopeId(scope: ChannelScope): ChannelScopeId`
  - `createChannelScopePath(basePath: string, id: ChannelScopeId, ...segments: string[]): string`
  - `ensureChannelScopeRecord(basePath: string, scope: ChannelScope): Promise<ChannelScopeRecord>`
  - `readChannelScopeRecord(basePath: string, id: ChannelScopeId): Promise<ChannelScopeRecord | undefined>`
  - `resolveChannelScope(basePath: string, id: ChannelScopeId): Promise<ChannelScope | undefined>`

- [ ] **Step 1: Write failing channel scope tests**

Create `core/tests/channel-scope.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createChannelScopeId,
  createChannelScopePath,
  ensureChannelScopeRecord,
  normalizeChannelScope,
  readChannelScopeRecord,
  resolveChannelScope,
  type ChannelScope,
} from "../src/channel.js";

describe("channel scope identity", () => {
  const scope: ChannelScope = {
    platform: "onebot",
    selfId: "bot:1000",
    channelId: "group/2000",
  };

  it("normalizes valid channel scopes without rewriting ids", () => {
    expect(normalizeChannelScope(scope)).toEqual(scope);
  });

  it("rejects empty channel scope fields", () => {
    expect(() => normalizeChannelScope({ ...scope, platform: "" })).toThrow(/platform/);
    expect(() => normalizeChannelScope({ ...scope, selfId: "" })).toThrow(/selfId/);
    expect(() => normalizeChannelScope({ ...scope, channelId: "" })).toThrow(/channelId/);
  });

  it("creates stable compact path-safe ids", () => {
    const id = createChannelScopeId(scope);

    expect(id).toMatch(/^ch_v1_[a-z2-7]{16}$/);
    expect(createChannelScopeId(scope)).toBe(id);
    expect(createChannelScopeId({ ...scope, channelId: "group/2001" })).not.toBe(id);
    expect(id).not.toContain(scope.selfId);
    expect(id).not.toContain(scope.channelId);
  });

  it("creates canonical channel paths", () => {
    const id = createChannelScopeId(scope);

    expect(createChannelScopePath("/tmp/athena", id, "sessions", "messages.jsonl")).toBe(
      join("/tmp/athena", "channels", id, "sessions", "messages.jsonl"),
    );
  });

  it("persists and resolves channel scope metadata", async () => {
    const basePath = await mkdtemp(join(tmpdir(), "athena-channel-scope-"));
    try {
      const record = await ensureChannelScopeRecord(basePath, scope);
      const expectedPath = join(basePath, "channels", record.id, "scope.json");

      expect(record).toMatchObject({
        version: 1,
        id: createChannelScopeId(scope),
        scope,
      });
      expect(JSON.parse(await readFile(expectedPath, "utf8"))).toMatchObject(record);
      await expect(readChannelScopeRecord(basePath, record.id)).resolves.toMatchObject(record);
      await expect(resolveChannelScope(basePath, record.id)).resolves.toEqual(scope);
    } finally {
      await rm(basePath, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel-scope.test.ts
```

Expected: FAIL because `../src/channel.js` does not exist.

- [ ] **Step 3: Implement `core/src/channel.ts`**

Create `core/src/channel.ts`:

```ts
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CHANNEL_SCOPE_ID_PREFIX = "ch_v1_";
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export interface ChannelScope {
  readonly platform: string;
  readonly selfId: string;
  readonly channelId: string;
}

export type ChannelScopeId = `ch_v1_${string}`;

export interface ChannelScopeRecord {
  readonly version: 1;
  readonly id: ChannelScopeId;
  readonly scope: ChannelScope;
  readonly createdAt: string;
}

export function normalizeChannelScope(input: ChannelScope): ChannelScope {
  assertNonEmpty("platform", input.platform);
  assertNonEmpty("selfId", input.selfId);
  assertNonEmpty("channelId", input.channelId);

  return {
    platform: input.platform,
    selfId: input.selfId,
    channelId: input.channelId,
  };
}

export function createChannelScopeId(scope: ChannelScope): ChannelScopeId {
  const normalized = normalizeChannelScope(scope);
  const digest = createHash("sha256").update(serializeChannelScope(normalized)).digest();
  return `${CHANNEL_SCOPE_ID_PREFIX}${encodeBase32(digest.subarray(0, 10))}` as ChannelScopeId;
}

export function createChannelScopePath(
  basePath: string,
  id: ChannelScopeId,
  ...segments: string[]
): string {
  return join(basePath, "channels", id, ...segments);
}

export async function ensureChannelScopeRecord(
  basePath: string,
  scope: ChannelScope,
): Promise<ChannelScopeRecord> {
  const normalized = normalizeChannelScope(scope);
  const id = createChannelScopeId(normalized);
  const recordPath = createChannelScopePath(basePath, id, "scope.json");
  const existing = await readChannelScopeRecord(basePath, id);
  if (existing) {
    return existing;
  }

  const record: ChannelScopeRecord = {
    version: 1,
    id,
    scope: normalized,
    createdAt: new Date().toISOString(),
  };

  await mkdir(createChannelScopePath(basePath, id), { recursive: true });
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

export async function readChannelScopeRecord(
  basePath: string,
  id: ChannelScopeId,
): Promise<ChannelScopeRecord | undefined> {
  try {
    const content = await readFile(createChannelScopePath(basePath, id, "scope.json"), "utf8");
    const record = JSON.parse(content) as ChannelScopeRecord;
    if (record.version !== 1 || record.id !== id) {
      throw new Error(`Invalid channel scope record for ${id}`);
    }
    return {
      version: 1,
      id,
      scope: normalizeChannelScope(record.scope),
      createdAt: record.createdAt,
    };
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

export async function resolveChannelScope(
  basePath: string,
  id: ChannelScopeId,
): Promise<ChannelScope | undefined> {
  return (await readChannelScopeRecord(basePath, id))?.scope;
}

function assertNonEmpty(field: keyof ChannelScope, value: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Channel scope ${field} must not be empty`);
  }
}

function serializeChannelScope(scope: ChannelScope): string {
  return JSON.stringify([scope.platform, scope.selfId, scope.channelId]);
}

function encodeBase32(bytes: Uint8Array): string {
  let output = "";
  let value = 0;
  let bits = 0;

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
```

- [ ] **Step 4: Export the public API**

Modify `core/src/index.ts` to export channel types and helpers:

```ts
export {
  createChannelScopeId,
  createChannelScopePath,
  ensureChannelScopeRecord,
  normalizeChannelScope,
  readChannelScopeRecord,
  resolveChannelScope,
} from "./channel.js";
export type { ChannelScope, ChannelScopeId, ChannelScopeRecord } from "./channel.js";
```

Modify `core/package.json` `exports` to add:

```json
"./channel": {
  "types": "./dist/channel.d.ts",
  "require": "./dist/channel.cjs",
  "default": "./dist/channel.js"
}
```

- [ ] **Step 5: Run core channel tests**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel-scope.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
rtk git add core/src/channel.ts core/src/index.ts core/package.json core/tests/channel-scope.test.ts
rtk git commit -m "feat(core): add channel scope identity helpers"
```

---

### Task 2: Core Runtime Integration

**Files:**
- Modify: `core/src/shared/types.ts`
- Modify: `core/src/runtime/key.ts`
- Modify: `core/src/runtime/message.ts`
- Modify: `core/src/service.ts`
- Modify: `core/tests/runtime-key.test.ts`
- Modify: `core/tests/reset.test.ts`
- Modify: `core/tests/message-flow.test.ts`

**Interfaces:**
- Consumes: Task 1 `ChannelScope`, `ChannelScopeId`, `createChannelScopeId`, `createChannelScopePath`, `ensureChannelScopeRecord`.
- Produces:
  - `createChannelRuntimeKey(scope: ChannelScope): ChannelScopeId`
  - `createChannelSessionPath(basePath: string, scope: ChannelScope): string`
  - channel context using `ChannelScope & { readonly type: "private" | "group" }`

- [ ] **Step 1: Update runtime key tests first**

Modify `core/tests/runtime-key.test.ts` so the expected runtime key and session path use canonical scope IDs:

```ts
import { isAbsolute, join } from "node:path";

import { describe, expect, it } from "vitest";

import { createChannelScopeId, type ChannelScope } from "../src/channel.js";
import { createChannelRuntimeKey, createChannelSessionPath, resolveBasePath } from "../src/runtime/key.js";

describe("runtime key helpers", () => {
  const scope: ChannelScope = {
    platform: "discord",
    selfId: "bot:1",
    channelId: "group/alpha",
  };

  it("resolves relative basePath against ctx.baseDir", () => {
    expect(resolveBasePath("data/yesimbot-core", "/tmp/athena")).toBe(
      join("/tmp/athena", "data/yesimbot-core"),
    );
  });

  it("keeps absolute basePath unchanged", () => {
    const basePath = isAbsolute("/var/lib/athena") ? "/var/lib/athena" : "C:\\athena\\data";
    expect(resolveBasePath(basePath, "/tmp/athena")).toBe(basePath);
  });

  it("builds runtime keys from canonical channel scope ids", () => {
    expect(createChannelRuntimeKey(scope)).toBe(createChannelScopeId(scope));
  });

  it("creates jsonl session paths under canonical channel directories", () => {
    const id = createChannelScopeId(scope);
    expect(createChannelSessionPath("/tmp/athena", scope)).toBe(
      join("/tmp/athena", "channels", id, "sessions", "messages.jsonl"),
    );
  });
});
```

- [ ] **Step 2: Run the targeted failing test**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/runtime-key.test.ts
```

Expected: FAIL because runtime key helpers still use raw string and sanitized filenames.

- [ ] **Step 3: Update shared types**

Modify `core/src/shared/types.ts`:

```ts
import type { Bot } from "koishi";

import type { ChannelScope } from "../channel.js";

export type { ChannelScope, ChannelScopeId, ChannelScopeRecord } from "../channel.js";

export interface ChannelAgentContext {
  readonly channel: ChannelScope & {
    readonly type: "private" | "group";
  };
  readonly platform: {
    readonly name: string;
    readonly unsafeBot?: Bot;
  };
}
```

Do not keep a `ChannelRuntimeTarget` alias; legacy naming is intentionally removed.

- [ ] **Step 4: Update runtime key helpers**

Modify `core/src/runtime/key.ts`:

```ts
import { isAbsolute, resolve } from "node:path";

import {
  createChannelScopeId,
  createChannelScopePath,
  type ChannelScope,
  type ChannelScopeId,
} from "../channel.js";

export function resolveBasePath(basePath: string, ctxBaseDir: string): string {
  return isAbsolute(basePath) ? basePath : resolve(ctxBaseDir, basePath);
}

export function createChannelRuntimeKey(scope: ChannelScope): ChannelScopeId {
  return createChannelScopeId(scope);
}

export function createChannelSessionPath(basePath: string, scope: ChannelScope): string {
  return createChannelScopePath(basePath, createChannelScopeId(scope), "sessions", "messages.jsonl");
}
```

- [ ] **Step 5: Update message scope extraction**

Modify `core/src/runtime/message.ts` imports and function names:

```ts
import type { ChannelScope } from "../channel.js";
```

Replace `getChannelRuntimeTarget` with:

```ts
export function getChannelScope(session: Session): ChannelScope {
  return {
    platform: session.platform,
    selfId: session.selfId,
    channelId: session.channelId!,
  };
}
```

Update local callers in the same file only if references exist.

- [ ] **Step 6: Update service runtime/cache/storage flow**

Modify `core/src/service.ts`:

```ts
import { ensureChannelScopeRecord, type ChannelScope } from "./channel.js";
```

Use `ChannelScope` in `CachedRuntime`, `resetChannel`, `createStorage`, and runtime creation:

```ts
interface CachedRuntime {
  key: string;
  scope: ChannelScope;
  runtime: Agent;
  storage: AgentStorage<AgentEntry>;
}
```

Make storage creation asynchronous so metadata can be ensured before JSONL use:

```ts
private async createStorage(scope: ChannelScope): Promise<AgentStorage<AgentEntry>> {
  const basePath = resolveBasePath(this.config.basePath, this.ctx.baseDir);
  await ensureChannelScopeRecord(basePath, scope);
  return createJsonlStorage(createChannelSessionPath(basePath, scope));
}
```

Update `resetChannel()`:

```ts
async resetChannel(scope: ChannelScope): Promise<void> {
  const key = createChannelRuntimeKey(scope);
  const cached = this.runtimes.get(key);
  const storage = cached?.storage ?? (await this.createStorage(scope));

  this.activeTurns.delete(key);

  if (cached) {
    cached.runtime.interrupt("reset");
    cached.runtime.stop();
  }

  await storage.clear();
  this.runtimes.delete(key);
}
```

Change `getChannelAgent(session)` to `async getChannelAgent(session): Promise<CachedRuntime>` and await it from `handleSession()`.

- [ ] **Step 7: Rename tests and imports**

Replace test imports and helper references:

```ts
// Before
getChannelRuntimeTarget
ChannelRuntimeTarget

// After
getChannelScope
ChannelScope
```

Update expected session path in reset tests from `sessions/discord-bot-room.jsonl` to:

```ts
join(basePath, "channels", createChannelScopeId(scope), "sessions", "messages.jsonl")
```

- [ ] **Step 8: Run core runtime tests**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/runtime-key.test.ts tests/message-flow.test.ts tests/reset.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

```bash
rtk git add core/src/shared/types.ts core/src/runtime/key.ts core/src/runtime/message.ts core/src/service.ts core/tests/runtime-key.test.ts core/tests/message-flow.test.ts core/tests/reset.test.ts
rtk git commit -m "refactor(core): use channel scope ids for runtimes and sessions"
```

---

### Task 3: Workspace Plugin Integration

**Files:**
- Modify: `plugins/workspace/src/mounts.ts`
- Modify: `plugins/workspace/src/index.ts`
- Modify: `plugins/workspace/tests/mounts.test.ts`
- Modify: `plugins/workspace/tests/plugin.test.ts`
- Modify: `plugins/workspace/README.md`

**Interfaces:**
- Consumes: Task 1 `ChannelScope`, `createChannelScopeId`.
- Produces: workspace roots based on `channels/<ChannelScopeId>/workspace`.

- [ ] **Step 1: Rewrite workspace mount tests**

Modify `plugins/workspace/tests/mounts.test.ts` to remove `createChannelWorkspaceId` assertions. Keep mount validation tests only. The import should become:

```ts
import { assertValidMountConfig, normalizeVirtualMountPath } from "../src/mounts";
```

Delete the `"creates stable readable channel workspace ids"` test because channel ID generation is no longer owned by this plugin.

- [ ] **Step 2: Run the workspace mounts test**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot-workspace exec vitest run tests/mounts.test.ts
```

Expected: PASS after import cleanup; no channel ID generation remains in this file.

- [ ] **Step 3: Remove plugin-local channel identity helpers**

Modify `plugins/workspace/src/mounts.ts`:

```ts
import { posix } from "node:path";

export const DEFAULT_WORKSPACE_MOUNT = "/home/workspace";
```

Remove:

```ts
import { createHash } from "node:crypto";
export interface WorkspaceChannelTarget { ... }
function sanitizeSegment(value: string): string { ... }
export function createChannelWorkspaceId(...) { ... }
```

- [ ] **Step 4: Use core channel scope ID in workspace lifecycle**

Modify `plugins/workspace/src/index.ts` imports:

```ts
import { createChannelScopeId, type ChannelScope } from "koishi-plugin-yesimbot/channel";
import { assertValidMountConfig } from "./mounts";
```

Update `getOrCreateWorkspace` signature:

```ts
private async getOrCreateWorkspace(channel: ChannelScope): Promise<Workspace> {
  const channelKey = createChannelScopeId(channel);
  const existing = this.workspaces.get(channelKey);
  if (existing) {
    return existing;
  }

  if (!this.rootPath || !this.normalizedMounts) {
    throw new Error("Workspace plugin has not been started");
  }

  const workspaceRoot = join(this.rootPath, "channels", channelKey, "workspace");

  await mkdir(workspaceRoot, { recursive: true });

  const workspace = new Workspace(this.createWorkspaceConfig(workspaceRoot));
  await workspace.init();
  this.workspaces.set(channelKey, workspace);
  return workspace;
}
```

- [ ] **Step 5: Update workspace plugin tests**

In `plugins/workspace/tests/plugin.test.ts`, update any expected root paths to include:

```ts
join(root, "channels", createChannelScopeId(channel), "workspace")
```

Import `createChannelScopeId` from `koishi-plugin-yesimbot/channel` in the test file when path assertions need it.

- [ ] **Step 6: Update workspace README wording**

Modify `plugins/workspace/README.md`:

```md
The default writable workspace is channel-isolated. Core derives a canonical
`ChannelScopeId` from `platform`, `selfId`, and `channelId`; the workspace
plugin uses that ID as the channel directory segment and does not expose raw
platform IDs in workspace paths.
```

Replace statements that promise `platform:selfId:channelId` as the directory identity with `ChannelScopeId`.

- [ ] **Step 7: Run workspace tests**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot-workspace exec vitest run tests/mounts.test.ts tests/plugin.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
rtk git add plugins/workspace/src/mounts.ts plugins/workspace/src/index.ts plugins/workspace/tests/mounts.test.ts plugins/workspace/tests/plugin.test.ts plugins/workspace/README.md
rtk git commit -m "refactor(workspace): use core channel scope ids"
```

---

### Task 4: MemOS Identity Integration

**Files:**
- Modify: `plugins/memos-client/src/identity.ts`
- Modify: `plugins/memos-client/src/types.ts`
- Modify: `plugins/memos-client/src/index.ts`
- Modify: `plugins/memos-client/tests/identity.test.ts`
- Modify: `plugins/memos-client/tests/plugin.test.ts`

**Interfaces:**
- Consumes: Task 1 `ChannelScope`, `ChannelScopeId`, `createChannelScopeId`.
- Produces: MemOS channel identity based on core channel scope identity while keeping author, agent, message, and memory-scope rules local.

- [ ] **Step 1: Update MemOS identity tests**

Modify `plugins/memos-client/tests/identity.test.ts` to expect channel hashes with the core ID format:

```ts
expect(identity.info.channel_hash).toMatch(/^ch_v1_[a-z2-7]{16}$/);
expect(identity.userId).toMatch(/^yb_ch_ch_v1_[a-z2-7]{16}$/);
expect(identity.conversationId).toMatch(/^yb_conv_ch_v1_[a-z2-7]{16}$/);
```

Keep author and message hash tests as short base64url values unless this task changes only channel identity.

- [ ] **Step 2: Run the failing MemOS identity test**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot-memos-client exec vitest run tests/identity.test.ts
```

Expected: FAIL because channel identity still uses plugin-local `shortHash()`.

- [ ] **Step 3: Update MemOS identity input type**

Modify `plugins/memos-client/src/types.ts`:

```ts
import type { ChannelScope } from "koishi-plugin-yesimbot/channel";
```

Change `MemosIdentityInput` to carry a scope:

```ts
export interface MemosIdentityInput {
  channelScope: ChannelScope;
  channelType: MemosChannelType;
  authorId: string;
  messageId?: string;
  turnId: string;
  memoryScope?: MemosMemoryScope;
  includeRawIdentityInfo?: boolean;
}
```

- [ ] **Step 4: Use core channel scope ID in identity derivation**

Modify `plugins/memos-client/src/identity.ts`:

```ts
import { createChannelScopeId } from "koishi-plugin-yesimbot/channel";
```

Inside `deriveMemosIdentity()`:

```ts
const channelScopeId = createChannelScopeId(input.channelScope);
const authorHash = shortHash(`v1|user|${input.channelScope.platform}|${input.authorId}`);
const agentHash = shortHash(`v1|agent|${input.channelScope.platform}|${input.channelScope.selfId}`);
const messageHash = input.messageId
  ? shortHash(`v1|message|${input.channelScope.platform}|${input.messageId}`)
  : undefined;
```

Update returned identity:

```ts
return {
  userId: memoryScope === "channel" ? `yb_ch_${channelScopeId}` : `yb_u_${authorHash}`,
  conversationId: `yb_conv_${channelScopeId}`,
  agentId: `yb_agent_${agentHash}`,
  info,
};
```

Set metadata:

```ts
const info: MemosIdentityInfo = {
  scene: isGroup ? "group_chat" : "private_chat",
  platform: input.channelScope.platform,
  channel_type: input.channelType,
  channel_hash: channelScopeId,
  author_hash: authorHash,
  turn_id: input.turnId,
  memory_scope: memoryScope,
  ...(messageHash ? { message_hash: messageHash } : {}),
};
```

Raw opt-in metadata should read from `input.channelScope.channelId` and `input.channelScope.selfId`.

- [ ] **Step 5: Update plugin call sites**

Modify `plugins/memos-client/src/index.ts` identity construction:

```ts
deriveMemosIdentity({
  channelScope: {
    platform: channelContext.channel.platform,
    selfId: channelContext.channel.selfId,
    channelId: channelContext.channel.channelId,
  },
  channelType: channelContext.channel.type as MemosChannelType,
  authorId: latestAuthorId,
  messageId: latestMessageId,
  turnId,
  memoryScope: this.config.memoryScope,
  includeRawIdentityInfo: this.config.includeRawIdentityInfo,
});
```

- [ ] **Step 6: Run MemOS tests**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot-memos-client exec vitest run tests/identity.test.ts tests/plugin.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
rtk git add plugins/memos-client/src/identity.ts plugins/memos-client/src/types.ts plugins/memos-client/src/index.ts plugins/memos-client/tests/identity.test.ts plugins/memos-client/tests/plugin.test.ts
rtk git commit -m "refactor(memos): use channel scope ids for channel memory"
```

---

### Task 5: Final Verification and OpenSpec Check

**Files:**
- Modify: `openspec/changes/unify-channel-scope-identity/tasks.md`
- Review: `openspec/changes/unify-channel-scope-identity/specs/**/*.md`
- Review: `openspec/changes/unify-channel-scope-identity/design.md`

**Interfaces:**
- Consumes: Tasks 1-4 implementation.
- Produces: verified implementation ready for OpenSpec apply review.

- [ ] **Step 1: Run package-scoped type checks**

Run:

```bash
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-workspace
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-memos-client
```

Expected: all commands exit 0.

- [ ] **Step 2: Run package-scoped tests**

Run:

```bash
rtk yarn turbo run test --filter=koishi-plugin-yesimbot
rtk yarn turbo run test --filter=koishi-plugin-yesimbot-workspace
rtk yarn turbo run test --filter=koishi-plugin-yesimbot-memos-client
```

Expected: all commands exit 0.

- [ ] **Step 3: Run OpenSpec validation**

Run:

```bash
rtk openspec validate unify-channel-scope-identity --strict
```

Expected: validation succeeds.

- [ ] **Step 4: Mark implementation tasks complete**

After implementation and verification pass, update `openspec/changes/unify-channel-scope-identity/tasks.md` by changing every completed task checkbox from `- [ ]` to `- [x]`.

- [ ] **Step 5: Commit final verification updates**

```bash
rtk git add openspec/changes/unify-channel-scope-identity/tasks.md
rtk git commit -m "chore(openspec): complete channel scope identity tasks"
```

## Self-Review

- Spec coverage: Tasks 1 and 2 cover `channel-scope-identity` and `core-runtime-integration`; Task 3 covers `workspace-sandbox-tools`; Task 4 covers `memos-cloud-memory`; Task 5 covers validation.
- Placeholder scan: This plan contains concrete files, commands, interfaces, and code snippets for every implementation task.
- Type consistency: `ChannelScope`, `ChannelScopeId`, `ChannelScopeRecord`, and helper names are consistent with the design and specs.
