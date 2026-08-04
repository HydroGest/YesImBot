## 1. Core storage and Runtime capabilities

- [ ] 1.1 Refactor AssetStore to return canonical IDs and add channel-scoped UUID-v7 ArtifactStore writers with reset cleanup.
- [ ] 1.2 Add `resourceReadTimeoutMs`, the scoped `registerResourceScheme()` registry, and Runtime snapshot/disposal behavior.
- [ ] 1.3 Inject artifact writers and ResourceScheme snapshots into ChannelRuntime and ChannelPluginContext without creating a global arbitrary-scope artifact API.

## 2. Core URI reader and explicit media projection

- [ ] 2.1 Implement strict built-in `asset://` and `artifact://` resolution plus registered scheme dispatch, deadlines, bounded result normalization, and fixed read-tool guidance.
- [ ] 2.2 Replace automatic image-history projection with explicit `read` result projection through `prepareStep` under frozen model capability and image budgets.
- [ ] 2.3 Cover URI validation, timeout, artifact identity preservation, read result persistence, capability gating, and media budgets with focused Core tests.

## 3. Platform, MCP, and output resource flows

- [ ] 3.1 Adapt OneBot image persistence to the AssetStore ID contract while preserving safe input behavior.
- [ ] 3.2 Convert MCP inline image outputs to tool-bound artifacts, preserve remote tool descriptions, and add the one-time artifact guidance prompt.
- [ ] 3.3 Add one Core output-preparation path for passive replies and active `sendMessage`, resolving supported asset, artifact, and workspace image/file sources before delivery.
- [ ] 3.4 Cover MCP artifact output, source-resolution failures, and passive/active output preparation with targeted tests.

## 4. Workspace-owned Skill and URI integrations

- [ ] 4.1 Move Skill discovery, validation, types, URI prompt rendering, and `skill://` containment into Workspace with `skillPaths` configuration; remove `load_skill`.
- [ ] 4.2 Build `/skills/<name>/` read-only mounts from the Workspace-owned catalog and register both `skill://` and `workspace://` handlers from the same Runtime snapshot.
- [ ] 4.3 Update Workspace guidance for internal POSIX paths versus external mutable URIs, remove the standalone Skills package and its Yarn workspace entry, and migrate setup documentation to Workspace configuration.
- [ ] 4.4 Exhaustively update or remove Skills tests, package/docs/config/lock references, then cover catalog containment, URI handlers, mounts, prompts, and package removal with focused Workspace tests.

## 5. Final integration verification

- [ ] 5.1 Run affected package type checks and focused Core, agent-runtime, MCP, and Workspace test files; repair only failures caused by this change.
- [ ] 5.2 Run `rtk openspec validate channel-resource-uris --strict` and confirm no implementation artifact reintroduces automatic media projection, Base64 history, host-path prompt leaks, URI-aware Bash behavior, or a standalone Skills package.
