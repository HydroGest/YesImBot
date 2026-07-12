## 1. Test Baseline

- [x] 1.1 Add tests that assert the workspace plugin registers `bash`, `readFile`, and `writeFile` as the default tools.
- [x] 1.2 Add tests that assert separate Koishi channel contexts receive isolated writable workspaces.
- [x] 1.3 Add tests that assert mount validation rejects duplicate, nested, relative, and `.`/`..` virtual mount paths.
- [x] 1.4 Add tests that assert the workspace system prompt includes cwd, channel scope, network state, timeout, persistence semantics, and configured mount categories.

## 2. Workspace Construction

- [x] 2.1 Refactor workspace creation so the registered agent plugin creates or retrieves a workspace per channel identity.
- [x] 2.2 Add stable host path derivation for channel-scoped workspace roots under the configured plugin root.
- [x] 2.3 Add strict virtual mount path normalization and conflict validation before filesystem construction.
- [x] 2.4 Add high-level mount handling for `persistPaths`, `readOnlyPaths`, and `overlayPaths` through `just-bash` filesystem implementations.

## 3. Bash Tool Integration

- [x] 3.1 Add a small adapter that lets `bash-tool` operate through the existing `Workspace` Bash instance and virtual filesystem.
- [x] 3.2 Replace default custom workspace tool registration with `bash-tool` backed `bash`, `readFile`, and `writeFile`.
- [x] 3.3 Decide and implement either explicit removal documentation or a compatibility alias layer for legacy custom tool names.

## 4. Prompt And Documentation

- [x] 4.1 Replace the current generic workspace prompt extension with channel-aware sandbox instructions.
- [x] 4.2 Document default tools, channel isolation, persist/read-only/overlay mount examples, network policy, timeout behavior, and security warnings.
- [x] 4.3 Document `@vercel/sandbox` as an advanced/future full-VM direction rather than default behavior.

## 5. Verification

- [x] 5.1 Run `rtk yarn workspace koishi-plugin-yesimbot-workspace exec vitest run`.
- [x] 5.2 Run `rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-workspace`.
- [x] 5.3 Run the narrowest additional workspace checks needed for any touched shared contracts.
