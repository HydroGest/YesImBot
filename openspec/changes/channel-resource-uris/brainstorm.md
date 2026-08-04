<!--
Raw capture of the collaborative brainstorming discussion for this change.
The later design artifact should reorganize this material rather than copy it.
-->

# Channel resource URIs — brainstorming record

## Context

YesImBot currently has a Core-owned, channel-scoped `AssetService` and `AssetStore`, but it only persists image bytes and returns an `<img id="…"/>` Satori element. OneBot persists inbound images; generic platform translation can preserve untrusted source URLs. Core projects persisted images directly to `FilePart` during model input. MCP currently maps inline image blocks to AI SDK `image-data` Base64 and stringifies other non-text content, so media can enter JSONL and provider context without a channel resource lifecycle.

Workspace provides an isolated `just-bash` virtual POSIX filesystem rooted at a channel-local `workspace/` directory and exposes `readFile` and `bash`. The separate Skills plugin discovers Skill directories and exposes `SKILL.md` through `load_skill`; this change folds that catalog into Workspace so auxiliary files and scripts share one validated root and mount lifecycle.

The change must create a coherent resource-reference design without creating a generic virtual filesystem, a parallel Resource type system, a tool per media type, automatic provider media injection, or a migration/dual-read path.

## Decisions

### 1. Keep `AssetStore` for platform input; add tool artifacts without a Resource service

Core continues to own channel-scoped platform-input bytes, content IDs, access scope, lifecycle, and model media policy through the existing `AssetStore` direction. The design adds a distinct tool-artifact store, but must not add a generic Resource wrapper service, a virtual filesystem, a factory layer, or duplicated storage rules.

Asset content is immutable and content-addressed. It represents only media frozen by a platform Translator. Its externally visible reference syntax is:

```text
asset://<32-char-lowercase-hex-id>
```

The reference is scoped implicitly to the current channel runtime. It does not contain a platform, Bot identity, host path, source URL, credentials, query, or fragment. The opaque ID is a non-secret reference rather than an access capability; paths, temporary URLs, source metadata, and raw bytes must never be exposed to the model.

### 2. User images and tool artifacts are explicit reads, not automatic FileParts

Inbound images become assets, and MCP or other Agent-tool media becomes artifacts. Both are represented in history by compact references and safe metadata. Core must not automatically attach either category to every historical or current model call.

A Core-native `read` tool is the explicit action that asks to consume a URI. For `read(asset://…)` or `read(artifact://…)`, Core uses the Runtime's frozen model capability and budgets. A model that declares image input may receive a temporary image part for that tool-result step; a model without image input receives bounded metadata and an explicit unsupported result. The persisted tool result remains small and must not contain Base64 or raw provider media data.

The existing `prepareStep` hook is the intended final, per-call projection seam. Read results never materialize a second artifact.

### 3. One stable `read` tool dispatches registered URI schemes

Core owns one stable `read` tool. Plugins do not override it. This is required both because the current tool merger rejects duplicate names and because capability, scope, budget, timeout, and error enforcement must remain Core-owned.

Core exposes one narrow extension point:

```ts
registerResourceScheme(scheme, prompt, open)
```

`asset` and `artifact` are Core-reserved, non-overridable schemes. Workspace registers both `skill` and `workspace` from one validated channel snapshot. A duplicate registration fails; disposal affects only Runtimes created later. Core snapshots registered entries when it creates a Runtime, internally binds each asynchronous `open` handler to that Runtime's scope, and collects the static scheme prompts into the fixed `read` tool description.

The public `open` handler accepts the current `ChannelScope`, parsed URI, a Core-owned `AbortSignal`, and an input byte cap. It asynchronously returns only `{ bytes, mediaType?, filename? }`. `mediaType` is a hint and `filename` is a display basename, not a path. Core validates image bytes, text decoding, budgets, JSONL representation, model projection, output materialization, and the configurable `resourceReadTimeoutMs` deadline (30,000 ms by default).

`asset` and `artifact` are the only reserved schemes. The same registration path may support future trusted schemes; each registered handler owns its scheme-specific URI form while Core retains the common scope and consumption rules.

The tool dispatches URI schemes:

```text
asset://…       Core-owned platform input asset
artifact://…    Core-owned immutable Agent-tool artifact
skill://…       Workspace-provided read-only Skill content
workspace://…   Workspace-provided channel workspace content
```

A scheme is a reference protocol, not an assumption that every consumer automatically understands it. Invalid syntax, a missing handler, timeout, missing files, and out-of-scope values produce explicit errors rather than host-path or URL fallback.

### 4. URLs are not Bash paths

The project adopts stable URLs as agent-facing references, but does not make Bash execute `skill://…` or `workspace://…` strings. Doing so would require a generic VFS and shell-wide URL rewriting across commands, redirections, globbing, sourcing, and execution.

Workspace continues to operate only on its virtual POSIX filesystem and owns the Skill catalog. Each configured Skill root is exposed as a read-only mount such as:

```text
/skills/<skill-name>/
```

Bash can read or run supported scripts through those mount paths. When Workspace is disabled, Skill discovery, `skill://`, and the Skill prompt are unavailable. Workspace is a just-bash sandbox, so executable support is limited to its supported shell syntax, built-ins, and explicitly enabled runtimes; arbitrary host commands are not implied.

### 5. `workspace://` is necessary, but only for the default channel workspace root

`workspace://` is the external-consumption reference for files created by the sandbox. It is distinct from Workspace's existing `readFile`:

- `readFile("/home/workspace/…")` and `bash` are internal sandbox operations over virtual POSIX paths.
- `workspace:///relative/path` is a stable, channel-scoped reference that Core readers, OCR/analysis capabilities, outbound delivery, and other external tools can consume.

Canonical syntax is:

```text
workspace:///<relative-path>
```

For example:

```text
workspace:///images/chart.png
workspace:///exports/report.csv
```

It maps only to the current channel's default `{channel-root}/workspace/` directory. It must not access `/skills`, operator mounts, `readOnlyPaths`, overlays, system paths, or arbitrary host files. The URI must reject authority, user info, ports, queries, fragments, empty paths, `.`/`..`, encoded traversal, and symlink escape.

### 6. `workspace://` is a live mutable reference

A workspace URI resolves the file's current content at consumption time. It is not an immutable snapshot. This matches the existing lifecycle: Core reset deletes sessions, assets, and artifacts but preserves the channel workspace.

When a caller needs a durable, immutable attachment or historical result, it must explicitly materialize the workspace file as a tool artifact and use `artifact://…` instead. This distinction must be visible in the design and tool results.

### 7. Workspace consumers use the same URI resolver

Core `read`, image-capable analysis, OCR integrations, and outbound reply preparation must resolve `workspace://` through the Workspace-owned resolver rather than converting it to exposed host paths. Core uses the same consumer path for `artifact://` without re-materializing it.

`<img src="workspace:///…"/>`, `<file src="workspace:///…"/>`, `<img src="artifact://…"/>`, and `<file src="artifact://…"/>` are outbound references intended for Core output preparation. Core resolves the bytes under the current channel scope, applies MIME and delivery limits, and materializes the format actually accepted by the selected platform adapter. Models never receive internal `file:` paths or data URLs.

OneBot image delivery has an evidence-backed path through data URLs, which its adapter converts to `base64://` payloads. Generic file delivery and other platform adapters must not be promised until their native materialization paths are verified.

Both passive assistant output and the active `sendMessage` tool must share this output-preparation path; the latter currently bypasses parsed reply segments.

### 8. Workspace owns the Skill catalog without a loader tool

Workspace discovers configured Skill directories, validates and owns each read-only Skill root, and exposes `skill://<skill-name>/<relative-path>` with containment checks. It does not turn Skill text or scripts into assets or artifacts.

Workspace does not register `load_skill`. Its prompt lists every visible Skill with `skill://<name>/SKILL.md`; when a task matches, the Agent uses Core `read` to load that file and any referenced Skill file. It never receives the Skill root's host path. Deleting Workspace deletes this entire Skill surface; the independent `plugins/skills/` package is removed with no compatibility wrapper.

### 9. MCP media becomes artifact references

MCP inline image data is validated and persisted as a tool artifact, then returned as compact metadata and `artifact://<tool-name>/<uuid-v7>`. The model chooses to call `read` if it needs the media. Arbitrary MCP URLs are not fetched automatically. Files, audio, and video are not granted automatic model input or parsing in the initial scope.

### 10. Tool artifacts are immutable, direct-addressed snapshots

Core stores each tool artifact below `{channel-root}/artifacts/<tool-name>/<uuid-v7>/` with fixed `data` and `metadata.json` entries. The metadata records only a safe filename, media-type hint, and byte length. A channel plugin obtains a current-channel writer from `ChannelPluginContext.artifacts.forTool(toolName)`; its `put()` generates a UUID v7, writes a temporary sibling directory, atomically renames it into place, and returns `artifact://<tool-name>/<uuid-v7>`. A tool artifact is reset with sessions and assets. It is not deduplicated by content, does not expose another tool namespace through its captured writer, and is never recreated by `read`.

UUID v7 is generated by a private Core helper from `Date.now()` and `node:crypto` random bytes. No external package is required.

### 11. Tool prompt contract follows the consumer boundary

Core owns the fixed `read` description: use an exact URI only when its content is needed; `asset` is immutable platform input, `artifact` is immutable tool output, `workspace` is mutable current workspace content, and `skill` is read-only Skill content. URI strings never go to Bash. Images are read only when visually relevant; an explicit read never creates another artifact.

Workspace lists matching `skill://` locations and directs only file reads through Core `read`; it directs sandbox operations through `/home/workspace` and `/skills` POSIX paths while reserving `workspace://` for external read or output; MCP contributes one Runtime-level notice that non-text media results are artifact references and must be explicitly read if needed. Core `sendMessage` states that `img` and `file` sources may use `asset://`, `artifact://`, or `workspace://` and that Core resolves them before delivery.

### 12. Non-goals for the initial change

- No automatic image attachment on user ingress or history replay.
- No generic VFS or URL-aware shell implementation.
- No automatic OCR, external VLM fallback, transcription, PDF parsing, video frame extraction, or file-content analysis.
- No per-media-type read tools.
- No asset or artifact reference counting, TTL, garbage collector, cross-channel sharing, migration, legacy-data support, aliases, or dual reads.

- No independently installable Skills plugin, wrapper, alias, or no-Workspace `skill://` fallback.
