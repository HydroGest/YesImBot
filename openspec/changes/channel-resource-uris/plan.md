# Channel Resource URIs Implementation Plan

> **For agentic workers:** Execute this plan sequentially in one agent session. Do not delegate tasks or introduce compatibility wrappers.

**Goal:** Replace implicit media injection and ad hoc plugin file access with scoped `asset://`, `artifact://`, `workspace://`, and Workspace-owned `skill://` resource flows.

**Architecture:** Core owns immutable platform assets, immutable tool artifacts, URI dispatch, the native `read` tool, model-media projection, and output materialization. Workspace owns both the channel sandbox and Skill catalog, so `skill://` resolution and `/skills/<name>` mounts share one plugin lifecycle. MCP converts supported inline images to tool-bound artifacts; no plugin sends provider media directly.

**Tech Stack:** TypeScript, Koishi, AI SDK v6, `@yesimbot/agent-runtime`, Node `fs/promises` and `crypto`, Vitest, Yarn 4, just-bash, gray-matter.

## Global Constraints

- Use Yarn 4 and repository commands through `rtk`; do not use npm or pnpm.
- Add no dependency for UUID generation. Generate UUID v7 with Node `crypto` and `Date.now()`.
- `asset://` is only for Translator-frozen platform input; tool media is only `artifact://`; Workspace files are mutable `workspace://` references.
- Core `read` is the only agent-facing URI reader. URI strings never become Bash paths.
- Image bytes reach a provider only after an explicit successful `read`, a frozen `models.json` image capability, and the configured image budget.
- Core `resourceReadTimeoutMs` defaults to 30,000 ms and cannot be disabled.
- Do not add a generic VFS, `file://` fallback, automatic MCP URL fetch, OCR/VLM fallback, alias, legacy reader, migration, or cross-channel sharing.
- Delete `plugins/skills/` completely. Do not preserve the package, plugin short name, `load_skill`, wrapper, alias, or no-Workspace Skill fallback.
- Keep generated output out of source decisions; update `yarn.lock` only through Yarn.
- Use focused tests after each task. Run package type checks and the final focused suite only after all implementation tasks are complete.

## File Map

| Area | Files | Responsibility |
|---|---|---|
| Core persistence | `core/src/asset.ts`, new `core/src/artifact.ts`, `core/src/runtime/manager.ts`, `core/src/index.ts` | Distinct asset/artifact storage, UUID v7, reset, public registration, channel-scoped writer injection |
| Core resource execution | new `core/src/runtime/read.ts`, `core/src/runtime/channel.ts`, `core/src/runtime/model-input.ts`, `core/src/config.ts`, `core/src/runtime/index.ts` | URI parsing/dispatch, native `read`, deadlines, explicit model projection, fixed prompt, Runtime snapshots |
| Core delivery | new `core/src/runtime/output.ts`, `core/src/runtime/channel.ts`, `core/src/delivery.ts`, `core/src/index.ts` | Resolve resource-backed `img`/`file` sources before passive and active delivery |
| Platform/MCP | `core/src/gateway/onebot.ts`, `plugins/mcp-client/src/index.ts` | Asset ID adaptation, tool-bound artifact materialization, MCP prompt |
| Workspace Skills | `plugins/workspace/src/index.ts`, `types.ts`, `workspace.ts`, `mounts.ts`, `prompt.ts`, new `skills.ts`, `package.json` | Workspace-owned Skill catalog, URI schemes, mounts, prompts |
| Package cleanup | delete `plugins/skills/`, `yarn.lock`, `docs/setup-koishi.md` | Clean cutover to the Workspace-owned Skill capability |
| Tests | existing Core/plugin tests plus new focused resource tests | Observable storage, URI, media, output, catalog, mount, and prompt contracts |

---

## Task 1: Establish Core asset and artifact persistence

**Files:**
- Modify: `core/src/asset.ts`
- Create: `core/src/artifact.ts`
- Modify: `core/src/index.ts`
- Modify: `core/src/runtime/manager.ts`
- Modify: `core/src/runtime/index.ts`
- Modify: `core/tests/asset.test.ts`
- Create: `core/tests/artifact.test.ts`
- Modify: `core/tests/runtime-manager.test.ts`

**Interfaces:**
- Produces `AssetStore.put(bytes): Promise<string>`; callers construct `<img id="…"/>` themselves.
- Produces `ArtifactStore.forTool(toolName).put(bytes, { mediaType, filename }): Promise<string>` returning `artifact://<tool-name>/<uuid-v7>`.
- Produces `ChannelPluginContext.artifacts`, bound to the Runtime's `ChannelScope`.
- `RuntimeManager.clear(scope)` removes `sessions/`, `assets/`, and `artifacts/`, but not `workspace/`.

- [ ] **Step 1: Change the existing asset contract tests to expect canonical IDs.**

  Replace the image-element expectation in `core/tests/asset.test.ts` with the digest string and retain byte-copy, prefix, ambiguity, shared-channel, and scoped-clear assertions:

  ```ts
  expect(await store.put(source)).toBe(PNG_ID);
  await expect(store.get(PNG_ID)).resolves.toEqual(PNG_BYTES);
  ```

  Run:

  ```bash
  rtk npx vitest run core/tests/asset.test.ts
  ```

  Expected: FAIL because `AssetStore.put()` still returns `h("img", { id })`.

- [ ] **Step 2: Add artifact persistence tests before implementation.**

  Create `core/tests/artifact.test.ts` with assertions for:

  ```ts
  const uri = await artifacts.forTool("mcp_screenshot").put(PNG_BYTES, {
    filename: "screen.png",
    mediaType: "image/png",
  });

  expect(uri).toMatch(/^artifact:\/\/mcp_screenshot\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(await artifacts.open(uri)).toEqual({
    bytes: PNG_BYTES,
    mediaType: "image/png",
    filename: "screen.png",
  });
  ```

  Add cases that reject a foreign-tool path, malformed UUID, metadata/data mismatch, and incomplete temporary directories.

- [ ] **Step 3: Implement the smallest separate stores.**

  In `core/src/asset.ts`, make `put()` atomically write the SHA-256-derived file and return the full ID. Create `core/src/artifact.ts` with:

  ```ts
  export interface ArtifactOpenResult {
    readonly bytes: Uint8Array;
    readonly mediaType?: string;
    readonly filename?: string;
  }

  export interface ArtifactWriter {
    put(bytes: Uint8Array, metadata: { mediaType?: string; filename?: string }): Promise<string>;
  }
  ```

  Store each artifact at `artifacts/<tool-name>/<uuid-v7>/data` plus `metadata.json`, writing a sibling temporary directory and renaming it only after both files are complete. Implement UUID v7 from 48-bit `Date.now()` milliseconds and `randomBytes(16)`, then set the version and variant bits before formatting lowercase canonical text.

- [ ] **Step 4: Bind artifact storage to Runtime lifecycle.**

  Construct the artifact service beside `AssetService` in `core/src/index.ts`; pass it into `RuntimeManager`; create a scoped store in `createRuntime()`; add it to `ChannelPluginContext`; clear it in `RuntimeManager.clear()` after session and asset cleanup. Export only the types needed by trusted channel plugins, not a global arbitrary-scope facade.

- [ ] **Step 5: Run storage and reset tests.**

  ```bash
  rtk npx vitest run core/tests/asset.test.ts core/tests/artifact.test.ts core/tests/runtime-manager.test.ts
  ```

  Expected: PASS. Confirm reset removes `artifacts/` but preserves `workspace/`.

## Task 2: Add Runtime-snapshotted URI registrations and Core reader infrastructure

**Files:**
- Modify: `core/src/config.ts`
- Modify: `core/src/index.ts`
- Modify: `core/src/runtime/manager.ts`
- Modify: `core/src/runtime/index.ts`
- Create: `core/src/runtime/read.ts`
- Modify: `core/src/runtime/channel.ts`
- Create: `core/tests/resource-read.test.ts`
- Modify: `core/tests/runtime-manager.test.ts`

**Interfaces:**
- Produces the public method:

  ```ts
  registerResourceScheme(
    scheme: string,
    prompt: string,
    open: ResourceSchemeOpenHandler,
  ): () => void;
  ```

- `ResourceSchemeOpenHandler` receives `(scope, uri, { signal, maxBytes })` and returns `{ bytes, mediaType?, filename? }`.
- Produces a Runtime-local resolver that owns `asset://` and `artifact://`, snapshots registered `skill://` / `workspace://` openers, and builds the native `read` tool.

- [ ] **Step 1: Write registration and deadline tests.**

  In `core/tests/resource-read.test.ts`, cover all of the following before implementation:

  ```ts
  expect(() => service.registerResourceScheme("asset", "x", open)).toThrow();
  expect(() => service.registerResourceScheme("skill", "x", openTwice)).toThrow();
  expect(await read("workspace:///../secret")).toMatchObject({ error: "invalid_resource_uri" });
  expect(await read("skill://csv/SKILL.md")).toMatchObject({ error: "resource_unavailable" });
  ```

  Register a delayed opener, configure `resourceReadTimeoutMs: 1`, and assert the result is a timeout with no persisted bytes or FilePart.

- [ ] **Step 2: Add configuration and registration snapshots.**

  Add `resourceReadTimeoutMs: number` to `Config` and its Schema with `.min(1).default(30_000)`. In `YesImBotService`, maintain registered scheme entries; reject `asset` and `artifact`; reject duplicate active plugin registrations; return a disposer. In `RuntimeManager.createRuntime()`, copy the registration set before invoking channel plugins, so disposal changes only future Runtimes.

- [ ] **Step 3: Implement `core/src/runtime/read.ts`.**

  Keep URI parsing, built-in opening, registered opener invocation, bounded text decoding, and prompt assembly in one Runtime-private module. Use one result shape:

  ```ts
  type OpenedResource = {
    readonly bytes: Uint8Array;
    readonly mediaType?: string;
    readonly filename?: string;
  };
  ```

  Parse only canonical full asset IDs, canonical UUID-v7 artifact paths, and registered schemes. Reject authority, query, fragment, empty path, traversal, and unknown schemes before calling an opener. Construct a deadline `AbortController` that combines the turn signal with `resourceReadTimeoutMs`.

- [ ] **Step 4: Add the native `read` tool and fixed guidance.**

  Build one `AgentTool` in `ChannelRuntime` from the Runtime-local reader. Its persisted output must be compact logical data, such as:

  ```ts
  {
    uri: "artifact://mcp_screenshot/<uuid>",
    filename: "screen.png",
    mediaType: "image/png",
    text: "[image artifact]",
  }
  ```

  Render the fixed Core guidance first (`asset`, `artifact`, `workspace`, `skill`, no URI-to-Bash, explicit image reads), then registered prompts in stable scheme order. Do not expose bytes, paths, URLs, or provider content in the persisted output.

- [ ] **Step 5: Run reader tests.**

  ```bash
  rtk npx vitest run core/tests/resource-read.test.ts core/tests/runtime-manager.test.ts
  ```

  Expected: PASS for registration collisions, Runtime snapshots, URI rejection, timeout, bounded text, and built-in artifact lookup.

## Task 3: Replace automatic image history projection with explicit read projection

**Files:**
- Modify: `core/src/runtime/model-input.ts`
- Modify: `core/src/runtime/read.ts`
- Modify: `core/src/runtime/channel.ts`
- Modify: `core/tests/model-input.test.ts`
- Extend: `core/tests/resource-read.test.ts`

**Interfaces:**
- `createModelInputPlugin()` continues to format canonical event/message text but no longer reads images from history.
- The Core read plugin owns `prepareStep()` and attaches only the current explicit image-read FilePart.
- A text-only model receives safe image metadata; an image-capable model receives a temporary `FilePart` only after `read`.

- [ ] **Step 1: Rewrite the model-input tests around explicit reads.**

  Replace automatic history-selection expectations with tests proving that a message containing `<img id="…"/>` produces safe text containing `asset://<id>` and no `FilePart`. Add a successful explicit read case that asserts exactly one temporary file part for the next model step.

  ```ts
  expect(userMessage.content).toContain(`asset://${PNG_ID}`);
  expect(asParts(userMessage.content).filter(isFilePart)).toHaveLength(0);
  expect(asParts(preparedReadStep).filter(isFilePart)).toHaveLength(1);
  ```

- [ ] **Step 2: Reduce `model-input.ts` to safe textual projection.**

  Remove `selectInputFiles()`, history scanning, and `appendFiles()`. Render persisted image elements as safe discoverable descriptions with canonical asset references; do not render `src`, data URLs, or arbitrary media attributes. Preserve message headers and event formatting.

- [ ] **Step 3: Implement `prepareStep()` projection in the reader plugin.**

  Identify only the native `read` tool's compact persisted result shape; do not scan arbitrary text for URI-looking substrings. In `RuntimeManager.createRuntime()`, snapshot `resolved.entry.modalities.input` and pass an `imageCapable` boolean into `ChannelRuntime` and the reader plugin. On the immediately following model step, open image bytes through the same Runtime resolver, detect JPEG/PNG/GIF/WebP magic bytes, require both `imageCapable` and `imageInput`, and append the file part. Retain the original compact tool result when open, MIME, budget, or timeout fails.

- [ ] **Step 4: Add exact failure assertions.**

  Test missing `modalities.input: ["image"]`, `imageInput: false`, unsupported magic bytes, a byte-limit excess, and an artifact read failure. Each must leave a readable compact result, create no FilePart, and continue the turn.

- [ ] **Step 5: Run model projection tests.**

  ```bash
  rtk npx vitest run core/tests/model-input.test.ts core/tests/resource-read.test.ts
  ```

  Expected: PASS; no test may expect automatic image attachment from history.

## Task 4: Prepare URI-backed output exactly once before delivery

**Files:**
- Create: `core/src/runtime/output.ts`
- Modify: `core/src/runtime/channel.ts`
- Modify: `core/src/index.ts`
- Modify: `core/tests/gateway-delivery.test.ts`
- Create: `core/tests/resource-output.test.ts`

**Interfaces:**
- Produces `prepareOutputSegments(segments, resolver, signal)` for current-runtime output.
- Applies only to `img` and `file` `src` values using `asset://`, `artifact://`, or `workspace://`.
- Both assistant stream output and active `sendMessage` flow through the same preparer.

- [ ] **Step 1: Add output-preparation tests first.**

  Cover a passive assistant output containing:

  ```xml
  <img src="workspace:///images/chart.png"/>
  ```

  and an active send containing:

  ```xml
  <img src="artifact://mcp_screenshot/019d3b7e-1bd0-7e4f-9c5d-5bf3fd41f1d4"/>
  ```

  Assert the delivery callback receives no internal URI. Add a missing artifact case asserting the one media element is omitted while sibling text remains.

- [ ] **Step 2: Implement output preparation.**

  Traverse structured Koishi Elements recursively. Leave unrecognized elements untouched. For a recognized source, open through the Runtime resolver, validate type and delivery limits, then replace it with the platform-neutral materialization accepted by the current delivery path. Keep host paths and data URLs internal to this helper.

- [ ] **Step 3: Route passive and active paths through it.**

  In `ChannelRuntime.consumeStream()`, parse assistant content, await `prepareOutputSegments()`, then push prepared segments. In the native `sendMessage` tool, parse the supplied content with `parseReply()`, prepare every segment, and send those segments; update its description to mention only `asset://`, `artifact://`, and `workspace://` sources.

- [ ] **Step 4: Keep delivery failures at the existing boundary.**

  Do not add a second DeliveryService. Keep `deliverOutput()` responsible for `Session.send()`/Bot send failures and `delivery.failed` events. Resource resolution failure should be a safe pre-delivery omission plus diagnostic, not a failed whole segment.

- [ ] **Step 5: Run output tests.**

  ```bash
  rtk npx vitest run core/tests/resource-output.test.ts core/tests/gateway-delivery.test.ts
  ```

  Expected: PASS for passive output, active send, sibling preservation, and existing delivery-failure feedback.

## Task 5: Adapt platform input and MCP tool artifacts

**Files:**
- Modify: `core/src/gateway/onebot.ts`
- Modify: `core/tests/gateway.test.ts`
- Modify: `plugins/mcp-client/src/index.ts`
- Modify: `plugins/mcp-client/tests/tools-refresh.test.ts`
- Create: `plugins/mcp-client/tests/media-artifacts.test.ts`

**Interfaces:**
- OneBot creates `h("img", { id })` after `AssetStore.put()` returns the ID.
- Each MCP tool closes over `context.artifacts.forTool(tool.name)` from its channel plugin factory.
- Supported inline MCP images persist to artifact URIs; MCP emits one Runtime prompt without changing server tool descriptions.

- [ ] **Step 1: Update OneBot tests for the AssetStore ID contract.**

  Adjust mocks so `store.put()` resolves an ID string and assert the Translator emits `<img id="…"/>`; retain sibling and source-load failure behavior.

- [ ] **Step 2: Refactor MCP tool creation to be channel-scoped.**

  Keep connected MCP clients and remote schemas global, but construct `AgentTool` objects inside `registerChannelPlugin((context) => …)` so each tool captures its own `ArtifactWriter`. Preserve the current sorted remote tool ordering and refresh disposal behavior.

- [ ] **Step 3: Normalize MCP media before `toModelOutput()`.**

  Decode only supported inline image blocks within Core image limits, call the tool-bound writer, and return compact text/JSON metadata with the artifact URI. For all unsupported non-text blocks, return bounded safe descriptions rather than `JSON.stringify(block)`. Do not fetch remote URLs.

- [ ] **Step 4: Add the MCP prompt once.**

  Return an `appendSystemPrompt` block from the MCP channel plugin that explains artifact references and explicit `read`. Leave every `tool.description` exactly as supplied by the MCP server.

- [ ] **Step 5: Run platform and MCP tests.**

  ```bash
  rtk npx vitest run core/tests/gateway.test.ts plugins/mcp-client/tests/tools-refresh.test.ts plugins/mcp-client/tests/media-artifacts.test.ts
  ```

  Expected: PASS for ID construction, artifact persistence, no Base64/history media, no opaque JSON fallback, one MCP prompt, and untouched remote descriptions.

## Task 6: Move the entire Skill catalog into Workspace

**Files:**
- Create: `plugins/workspace/src/skills.ts`
- Modify: `plugins/workspace/src/index.ts`
- Modify: `plugins/workspace/src/types.ts`
- Modify: `plugins/workspace/src/workspace.ts`
- Modify: `plugins/workspace/src/prompt.ts`
- Modify: `plugins/workspace/package.json`
- Modify: `plugins/workspace/tests/plugin.test.ts`
- Create: `plugins/workspace/tests/skills.test.ts`
- Delete: `plugins/skills/`
- Modify: `yarn.lock`
- Modify: `docs/setup-koishi.md`

**Interfaces:**
- `WorkspacePluginConfig.skillPaths: string[]` replaces the removed Skills plugin configuration.
- Workspace registers both `skill` and `workspace` URI openers through `registerResourceScheme()`.
- Workspace prompt lists `skill://<name>/SKILL.md`, exposes no `load_skill`, and names `/skills/<name>/…` as execution-only virtual paths.

- [ ] **Step 1: Port Skill discovery tests before deleting the package.**

  Move the current discovery, collision, frontmatter, XML escaping, hidden-Skill, and prompt tests into `plugins/workspace/tests/skills.test.ts`. Change expected locations from host paths to:

  ```ts
  expect(prompt).toContain("skill://test-skill/SKILL.md");
  expect(prompt).not.toContain("/path/to/skill.md");
  ```

  Add a test proving the Workspace tool set has no `load_skill`.

- [ ] **Step 2: Move discovery into Workspace.**

  Port the `gray-matter` discovery logic into `plugins/workspace/src/skills.ts`; keep one catalog shape containing `name`, `description`, validated root, `SKILL.md` path, and `disableModelInvocation`. Add `skillPaths` to `WorkspacePluginConfig` and Schema, resolve paths at startup, and add `gray-matter` to Workspace dependencies before deleting the old package.

- [ ] **Step 3: Build mounts from the same catalog.**

  Extend the Workspace filesystem setup so the catalog contributes read-only `OverlayFs` mounts at `/skills/<name>`. Merge these internally with configured read-only mounts only after validating duplicate and nested paths; user-configured mounts cannot replace `/skills`.

- [ ] **Step 4: Register both Workspace schemes and prompt surfaces.**

  In the Workspace plugin lifecycle, register `workspace` and `skill` with Core. `workspace` opens only `{channel-root}/workspace`; `skill` opens only a catalog root after containment validation. Update `formatWorkspacePrompt()` to distinguish `/home/workspace` and `/skills` internal paths from `workspace://` external references, and include visible Skill URI locations. Do not register `load_skill` or expose host paths.

- [ ] **Step 5: Remove the standalone package cleanly.**

  Delete `plugins/skills/`, remove its `yarn.lock` workspace entry through:

  ```bash
  rtk yarn install --mode=update-lockfile
  ```

  Update `docs/setup-koishi.md` and `scripts/setup-koishi.mjs` output expectations so only `yesimbot-workspace` appears. Search the full workspace, docs, specs, configuration, CI, scripts, and references for `yesimbot-skills`, `plugins/skills`, `load_skill`, and old host-path Skill instructions; remove or migrate every live-source reference. Do not alter ignored `dist/` output manually.

- [ ] **Step 6: Run Workspace and cleanup tests.**

  ```bash
  rtk npx vitest run plugins/workspace/tests/skills.test.ts plugins/workspace/tests/plugin.test.ts plugins/workspace/tests/mounts.test.ts plugins/workspace/tests/bash-tool.test.ts
  rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-workspace
  ```

  Expected: PASS for catalog containment, prompt URIs, no loader tool, `/skills` read-only mounts, `workspace://` isolation, and removed package references.

## Task 7: Run integrated verification and review clean cutover

**Files:**
- Modify only files whose focused tests reveal a defect in this change.
- Verify: `openspec/changes/channel-resource-uris/tasks.md`, `openspec/changes/channel-resource-uris/plan.md`

**Interfaces:**
- Consumes all previous tasks.
- Produces verified implementation evidence without a compatibility layer.

- [ ] **Step 1: Run Core and runtime type checks.**

  ```bash
  rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
  rtk npx tsc --noEmit -p packages/agent-runtime/tsconfig.json
  ```

- [ ] **Step 2: Run the focused behavioral suite.**

  ```bash
  rtk npx vitest run core/tests/asset.test.ts core/tests/artifact.test.ts core/tests/resource-read.test.ts core/tests/resource-output.test.ts core/tests/model-input.test.ts core/tests/runtime-manager.test.ts core/tests/gateway.test.ts core/tests/gateway-delivery.test.ts
  rtk npx vitest run plugins/mcp-client/tests/tools-refresh.test.ts plugins/mcp-client/tests/media-artifacts.test.ts
  rtk npx vitest run plugins/workspace/tests/skills.test.ts plugins/workspace/tests/plugin.test.ts plugins/workspace/tests/mounts.test.ts plugins/workspace/tests/bash-tool.test.ts
  ```

- [ ] **Step 3: Run the changed path smoke checks.**

  Use the existing test harness to exercise these end-to-end paths in one channel scope:

  ```text
  OneBot image → asset URI text → explicit read → one temporary FilePart
  MCP inline image → artifact URI → explicit read → same artifact URI persists
  Workspace output file → workspace URI → prepared img/file source before delivery
  Workspace Skill → skill URI read and /skills mount; no load_skill tool
  ```

  Confirm no history record contains Base64 media, a host path, a platform URL, or a second artifact created by `read`.

- [ ] **Step 4: Validate source cleanup.**

  Use the repository search tool with this exact scope and pattern:

  ```text
  path: .
  gitignore: false
  pattern: koishi-plugin-yesimbot-skills|yesimbot-skills|plugins/skills|load_skill
  ```

  Expected: no live-source result in source, docs, specs, configuration, CI, scripts, or references; ignored generated `dist/` content is not source of truth.

- [ ] **Step 5: Validate the OpenSpec change.**

  ```bash
  rtk openspec validate channel-resource-uris --strict
  ```

  Expected: valid. Re-read the delta specs and verify the implementation contains no automatic history projection, Base64 tool history, URI-aware Bash behavior, standalone Skills package, migration, alias, or fallback reader.

## Spec Coverage Review

- Channel asset IDs, artifact UUID v7 layout, atomic metadata, and reset cleanup: Tasks 1 and 7.
- URI grammar, registrations, prompt ordering, timeout, bounds, and artifact identity: Tasks 2, 3, and 7.
- Explicit capability-gated image projection and no automatic history attachment: Task 3.
- OneBot storage contract, MCP artifacts, and remote tool descriptions: Task 5.
- Passive and active resource-source preparation: Task 4.
- Workspace-only Skill catalog, no loader, read-only mounts, and no-Workspace absence: Task 6.
- Package, lockfile, setup documentation, tests, and OpenSpec validation: Tasks 6 and 7.

## Plan Self-Review

- Every changed public or cross-plugin contract is introduced before its consumers.
- Each task has a focused test cycle; no task depends on an unspecified helper or a compatibility shim.
- The plan contains no external UUID dependency, generic VFS, or unapproved fallback behavior.
- The plan is intentionally sequential: one agent can implement and verify each task before moving to the next.
