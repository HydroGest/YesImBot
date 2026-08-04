## Context

Core already owns channel storage and immutable asset bytes, but AssetStore still couples persistence to `<img>` presentation. Runtime projects persisted images automatically on each image-capable model call. MCP tool conversion can place Base64 image data and opaque JSON structures in persisted tool messages. Workspace owns a channel-local writable filesystem, yet no Core consumer can safely refer to a file it produced. A separate Skills plugin owns validated Skill roots but cannot coordinate its mounts with Workspace without another public cross-plugin seam.

The design adds one URI protocol at the Core boundary. It retains the existing AssetStore and Workspace filesystem rather than introducing a generic resource service or URL-aware virtual filesystem. Workspace absorbs the Skill catalog so a single optional plugin owns discovery, URI reads, prompt text, and `/skills` mount lifetime.

## Goals / Non-Goals

**Goals:**

- Give platform assets, immutable tool artifacts, Skill files, and default Workspace files stable channel-scoped URI references.
- Make Core `read` the only agent-facing resource consumer and keep provider media projection under frozen Runtime policy.
- Let Workspace products be consumed by Core tools and outbound delivery without exposing host paths or arbitrary sandbox mounts.
- Keep Agent-tool media compact in history by persisting it as immutable artifacts instead of provider media data.
- Let Workspace own Skill discovery, `skill://` reads, and read-only `/skills` execution mounts; delete the independent Skills package.

**Non-Goals:**

- A generic virtual filesystem, URL-aware shell, generic `file://`, or a new Resource type hierarchy.
- Automatic image attachment during ingress, history replay, or MCP tool conversion.
- OCR fallback, VLM routing, transcription, document parsing, video processing, automatic URL downloads, or a tool per media type.
- Cross-channel access, reference counting, TTL cleanup, legacy layout migration, aliases, or dual reads.

## Decisions

### D1: Core owns one URI reader and snapshots registered schemes

- **Choice:** Core exposes one native `read` tool and the narrow facade method `registerResourceScheme(scheme, prompt, open)`. `asset://` and `artifact://` remain Core-reserved schemes. Workspace registers both `skill://` and `workspace://` from its own snapshot; duplicate scheme registration fails. Core snapshots registrations while creating a ChannelRuntime, binds every registered opener to that Runtime's scope internally, and does not change active Runtimes when a registration is disposed.
- **Reason:** The existing Runtime already freezes models, tools, and AgentPlugins. The Core-owned registry preserves that lifecycle while avoiding a public factory abstraction. A static registration prompt gives the native `read` tool an accurate, stable description of the schemes available to the Runtime.
- **Alternatives considered:** A bare global handler would read mutable plugin state on every call and could not reliably describe active schemes when Core creates the tool. Separate `read_image`, `read_file`, and `read_skill` tools would grow the tool surface with resource types. A plugin override of `read` would let a plugin bypass Core media policy.

The public `open` handler is asynchronous. It receives the current `ChannelScope`, a parsed URI, and Core-owned `{ signal, maxBytes }` limits; it returns only `{ bytes, mediaType?, filename? }`. `mediaType` is a non-authoritative hint and `filename` is a display basename, never a host path. Core owns MIME validation, strict UTF-8 decoding, text truncation, image budgets, JSONL representation, model projection, and output materialization. Core renders the fixed read-tool description with `asset` and `artifact` descriptions first, then inserts active registration prompts in stable scheme-name order.

### D2: URI syntax carries no scope authority

- **Choice:** The initial forms are:

  ```text
  asset://<32-char-lowercase-hex-id>
  artifact://<tool-name>/<uuid-v7>
  skill://<skill-name>/<relative-path>
  workspace:///<relative-path>
  ```

  Core accepts `asset` and `artifact` as reserved schemes and accepts another scheme only when an active trusted registration provides it. The registration owns that scheme's path grammar; Core retains channel scope and common URI safety checks.
- **Reason:** Channel scope already identifies the storage authority. Encoding platform names, channel IDs, Bot identities, host paths, or source URLs into references would leak data and create alternative access routes.
- **Alternatives considered:** `file://` would expose host paths. A generic `resource://` would duplicate established storage vocabulary and hide lifetime differences.

URI parsing rejects authority where the selected scheme does not define one, user information, ports, queries, fragments, empty paths, dot segments, encoded traversal, invalid percent encodings, and paths outside the registered root. Missing handlers and unavailable resources return explicit errors without fallback.

### D3: AssetStore owns platform input bytes; ArtifactStore owns tool outputs

- **Choice:** AssetStore stores immutable channel-scoped bytes frozen by a platform Translator and returns the canonical 32-character ID. Tool media is never stored as an asset. `ChannelPluginContext.artifacts.forTool(toolName)` returns a current-channel writer whose `put(bytes, { mediaType, filename })` creates an immutable tool artifact and returns its URI. Translators and tools construct their own compact references or Satori elements.
- **Reason:** Platform input and a tool result have different provenance, directory layout, identity, and reset semantics. Returning `h("img", { id })` makes AssetStore presentation-specific; storing tool outputs in assets erases their producing-tool provenance.
- **Alternatives considered:** A generic Resource service would duplicate scope and lifecycle rules. Content-addressing artifacts would collapse distinct tool results with different filename or media metadata.

Asset IDs remain SHA-256-derived and scoped to the current channel tuple. Existing byte layout and `<img id>` records remain readable through the same canonical format; the change does not add a legacy reader.

An artifact writer creates `{channel-root}/artifacts/<tool-name>/<uuid-v7>/data` and `metadata.json` by atomically renaming a complete sibling temporary directory. `metadata.json` contains only `filename`, `mediaType`, and `byteLength`. UUID v7 uses a private Core implementation based on `Date.now()` and `node:crypto` random bytes; no third-party dependency is added. UUID v7 identifiers are canonical lowercase strings and naturally order artifact directories by creation time. Artifact data is immutable, scoped to the current channel, and is cleared with sessions and assets on reset.

### D4: Media reaches the model only after an explicit read

- **Choice:** Inbound asset images and tool artifact images remain textual metadata until the model calls `read`. Core evaluates the Runtime's frozen `models.json` input modalities and `imageInput` budget at that tool-result step. Only an explicitly image-capable model receives an ephemeral image part.
- **Reason:** User media can be large, irrelevant, or unsupported. Explicit reads make the consumption decision visible to the agent and prevent repeated attachment during history replay.
- **Alternatives considered:** Automatic FilePart projection spends context on every image and fails to distinguish relevance from availability.

The persisted `read` result contains the URI, media metadata, and a bounded textual outcome. `prepareStep` adds any temporary image part to the current provider request after persistence has already retained the compact result. Missing modality metadata means image input is unsupported. `imageInput: false` disables image projection even after a read.

Core limits textual reads to 30,000 characters and applies the existing image count and byte budgets to each model-call projection. A read of unsupported binary content returns metadata rather than raw bytes or Base64. The top-level `resourceReadTimeoutMs` configuration defaults to 30,000 ms and has a minimum of 1 ms. Core combines the turn cancellation signal with that deadline for every `read` opener; timeout returns an explicit failure and cannot produce a provider part or partial persisted result.

### D5: Workspace has two address spaces with different purposes

- **Choice:** Workspace keeps virtual POSIX paths for internal `readFile` and `bash` use. `workspace:///relative/path` provides a separate external-consumption reference that maps only to the current channel root's `workspace/` child.
- **Reason:** Workspace tools need ordinary shell and filesystem semantics. Core delivery, Core read, and external tools need a stable reference that does not disclose host paths or expose arbitrary mounts.
- **Alternatives considered:** Letting `workspace://` address the whole sandbox would expose `/skills`, operator read-only mounts, overlays, system paths, and future mounts.

`workspace://` resolves live content at use time. It is mutable and survives Core reset because Workspace data already survives reset. A caller that needs an immutable historical attachment explicitly materializes the file through its artifact writer and uses `artifact://`.

### D6: Workspace owns Skill URI reads and execution mounts

- **Choice:** Workspace accepts `skillPaths`, discovers and validates the Skill catalog, registers `skill` through `registerResourceScheme()`, resolves `skill://<name>/<relative-path>` below a validated root, lists visible Skills at `skill://<name>/SKILL.md`, and mounts those roots read-only at `/skills/<name>/`. Workspace does not register `load_skill`. The independent `plugins/skills/` package is deleted without a wrapper, alias, or no-Workspace `skill://` fallback.
- **Reason:** Workspace already owns the runtime-specific virtual filesystem, so it can create `/skills` mounts from the same catalog that validates URI reads. This removes the otherwise necessary mount-contribution registry and keeps one lifecycle, prompt, scope, and cleanup boundary.
- **Alternatives considered:** A cross-plugin mount registry adds a public coordination abstraction only to reconnect two packages. Keeping `load_skill` duplicates Core `read`. Copying Skill files into Workspace creates stale copies. Executing `skill://` requires a URL-aware virtual filesystem and shell rewriting.

Workspace remains responsible for Skill discovery, root validation, containment, read-only policy, and a system prompt that lists `skill://<name>/SKILL.md` locations. When Workspace is absent, no Skill prompt, Skill reader, or Skill execution surface exists.

### D7: MCP returns artifact references, not provider media

- **Choice:** MCP recognizes supported inline image blocks, validates and stores their bytes through its channel-bound artifact writer, and returns compact artifact metadata plus `artifact://<tool-name>/<uuid-v7>`. It does not fetch arbitrary MCP URLs in the initial scope.
- **Reason:** A tool output needs provenance, filename/media metadata, compact history, and the same Core read policy without being mistaken for platform input.
- **Alternatives considered:** Direct `image-data` output persists Base64 in tool history. Storing MCP output as an asset loses tool provenance. `JSON.stringify` of opaque blocks gives the model unbounded, unactionable structures.

Files, audio, video, resource links, and unknown content blocks return bounded safe descriptions unless a later change defines a concrete reader and consumption policy.

### D8: Output preparation resolves supported URIs before delivery

- **Choice:** Core prepares both passive reply segments and active `sendMessage` content before platform delivery. It resolves `asset://`, `artifact://`, and `workspace://` only in supported `img` and `file` source positions, then materializes a representation accepted by the selected platform.
- **Reason:** Model output must never send an internal URI, host path, or temporary platform URL to an adapter. Active sending currently bypasses parsed assistant segments and needs the same preparation boundary.
- **Alternatives considered:** Passing internal URIs unchanged assumes every Koishi adapter understands the scheme.

Core validates media type, scope, and delivery limits before materialization. OneBot image delivery can use a data URL because its adapter converts that form to a base64 payload. Other adapter and generic-file materialization paths require their own verified support. A failed URI resolution removes only the unavailable media reference, preserves sibling content, and records a safe diagnostic without the source path or bytes.

### D9: Error and trust boundaries remain narrow

- **Choice:** URI handlers operate only for active channel-runtime scope. They report invalid, unavailable, unsupported, and budget-exceeded outcomes without revealing whether a matching ID exists in another channel.
- **Reason:** An asset ID must not become a cross-channel probe. Runtime plugins are trusted in-process extensions, not a security sandbox, so the API minimizes accidental access rather than claiming protection from malicious Node code.
- **Alternatives considered:** Capability-bearing URLs would make accidental logs and model output authorization-sensitive.

### D10: Tool prompts name the correct resource surface

- **Choice:** Core owns the fixed `read` description and `sendMessage` resource-source guidance. The `read` description tells the Agent to use an exact URI only when its contents are needed; it distinguishes immutable platform `asset://`, immutable tool `artifact://`, mutable `workspace://`, and read-only `skill://`; it prohibits passing a URI to Bash; and it states that image bytes appear only after an explicit, relevant read. `sendMessage` states that `img` and `file` source attributes may use `asset://`, `artifact://`, or `workspace://`, which Core resolves before delivery.
- **Reason:** The Core owns URI consumption, media projection, and delivery. A single fixed rule prevents each plugin from inventing conflicting instructions.
- **Plugin additions:** Workspace adds both Skill discovery / `skill://` guidance and the distinction between internal `/home/workspace` or `/skills` POSIX paths and external mutable `workspace://`. MCP adds one Runtime-level notice that media results are immutable `artifact://` references and must be explicitly read when needed. MCP preserves every remote tool's original description rather than repeating this notice in each tool definition.
- **Reason:** Workspace owns the entire Skill and filesystem surface without duplicating the Core rules; MCP preserves remote tool semantics.

## Risks / Trade-offs

- `workspace://` refers to current content. A later Bash write can change what a prior URI resolves to. Callers that need snapshots must explicitly create a tool artifact.
- A Skill script can run only where just-bash supports its required shell behavior and enabled runtime. The mount does not grant host execution.
- Core output preparation cannot promise file delivery on every platform until the platform adapter accepts an internal materialization form.
- The design intentionally removes an independently installable Skills plugin. Deployments that need Skills must enable Workspace.

## Migration Plan

1. Preserve the current channel `assets/` directory and 32-character content IDs.
2. Continue reading existing `<img id>` elements through the canonical AssetStore path; render safe metadata rather than automatically attaching images.
3. Generate `artifact://` for new Agent-tool media and `workspace://` for new exported workspace references. Do not rewrite old JSONL.
4. Keep the existing plugin-owned `workspace/` directory. `workspace://` maps to that existing root without a layout migration.
5. Do not read v3 asset layouts, `asset_` identifiers, aliases, or fallback paths.

## Open Questions

No implementation-blocking product decisions remain. Platform-specific materialization support determines which adapters can advertise file delivery; unsupported platforms return a safe delivery error until an adapter-specific capability is added.
