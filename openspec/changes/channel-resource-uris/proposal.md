## Why

YesImBot stores platform channel images but automatically adds them to model input, while MCP can persist Base64 media in tool history. Workspace currently lacks external file references, and the separate Skills plugin duplicates a second lifecycle for Skill discovery and execution. The change gives Core one channel-scoped URI protocol with separate platform assets and immutable tool artifacts, plus a Workspace-owned Skill catalog and explicit media consumption without a virtual filesystem.

## What Changes

**Channel resource references**
- From: Assets use bare image IDs, tool media can enter provider history directly, Workspace files have only sandbox paths, and Skill auxiliary files have no agent-facing reference.
- To: Core defines scoped `asset://`, `artifact://`, `skill://`, and `workspace://` references with one native `read` tool. `asset` and `artifact` are Core-reserved; `ctx.yesimbot.registerResourceScheme(scheme, prompt, open)` lets trusted integrations register their asynchronous URI opener and read-tool prompt fragment. Core snapshots and binds those registrations per Runtime.
**Model media consumption**
- From: Core automatically projects persisted inbound images to FileParts for image-capable calls.
- To: Core projects media only after the model explicitly calls `read` for a supported URI. Persisted tool results retain compact references and metadata, never Base64 media.

**Workspace export boundary**
- From: `readFile` and `bash` operate only inside the Workspace virtual filesystem.
- To: `workspace:///relative/path` exposes the current file under the channel default `workspace/` root to approved external consumers, while direct tools continue to use virtual POSIX paths.

**Workspace-owned Skills and MCP guidance**
- From: an independent Skills plugin exposes `load_skill` and host paths, Workspace does not distinguish sandbox paths from external references, and MCP maps media directly to provider output or JSON text.
- To: Workspace owns `skillPaths`, discovery, `skill://`, `/skills/<name>` read-only mounts, and the Skill prompt; the independent Skills package is removed with no wrapper or no-Workspace fallback. Workspace relies on Core `read` instead of registering `load_skill`; MCP contributes one artifact-reference notice while preserving remote tool descriptions.

**Outbound resource references**
- From: assistant output and active sending pass image/file `src` values through unchanged.
- To: Core resolves approved `asset://`, `artifact://`, and `workspace://` output sources before platform delivery and materializes only a platform-supported representation.

**Core tool guidance**
- From: Core tool descriptions do not establish URI consumption or outbound resource-source rules.
- To: Core `read` owns the fixed URI decision rules, and `sendMessage` states the permitted `asset://`, `artifact://`, and `workspace://` image/file sources.

## Capabilities

### New Capabilities

- `channel-resource-uris`: scoped URI grammar, Core scheme registration, stable read-tool prompt composition, explicit media projection, read deadlines, and resource error semantics.
- `skill-resource-access`: Workspace-owned `skill://` containment, Skill discovery, prompt, and read-only `/skills` mounts.

### Modified Capabilities

- `channel-storage-protocol`: AssetStore keeps immutable platform input bytes while a channel-plugin artifact writer creates immutable UUID-v7 tool outputs under `artifacts/`.
- `platform-message-ingestion`: resolvers persist accepted inbound images as asset references without leaving source URLs in model-visible input.
- `model-input-media-budgeting`: image files are projected only from explicit `read` results under frozen model capability and call budgets.
- `workspace-sandbox-tools`: Workspace owns Skill discovery and only its default channel root through `workspace://`; sandbox paths and URI references have distinct roles.
- `mcp-client`: supported inline media becomes compact artifact references; MCP does not inject Base64 media or stringify opaque media blocks into model input.
- `message-delivery`: passive and active output paths prepare recognized resource sources before platform delivery.

## Impact

- Core: `asset.ts`, channel-scoped artifact storage, Runtime model-input and output preparation, native `read` and `sendMessage` guidance, `registerResourceScheme()`, `resourceReadTimeoutMs` configuration, channel-plugin construction, and Gateway delivery integration.
- Plugins: Workspace, MCP client, and potentially OneBot OCR consume the shared URI reader. Workspace replaces the independent Skills package and removes `load_skill`; Agent tools use channel-bound artifact writers for media outputs.
- Storage: existing asset IDs and byte layout remain readable; new artifacts live under each channel `artifacts/<tool-name>/<uuid-v7>/`; `workspace://` refers to the existing plugin-owned `workspace/` child and remains mutable across reset.
- Providers: only the Core explicit-read projection can create temporary image parts. No provider or model API changes are required.
