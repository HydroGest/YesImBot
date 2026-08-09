## 1. Restore the Sandbox baseline

- [x] 1.1 Remove the unapproved Git tool, `enableGit` registration, Git tests, `host-exec` assertions, and Host temporary-mount helpers without reverting unrelated WIP.
- [x] 1.2 Confirm Sandbox exposes only `bash`, `readFile`, and `writeFile` and retains its existing just-bash options and default behavior.

## 2. Define mode-specific configuration and mounts

- [x] 2.1 Add the `bash.mode` discriminated configuration with Sandbox default and separate Sandbox/Host fields using the project Schema conventions.
- [x] 2.2 Replace the three Sandbox mount maps with normalized `source`/`target`/`mode` declarations, preserving workspace and skill reservations.
- [x] 2.3 Add Host channel rules, Host roots, and required `uid/gid` identity validation with deny-by-default admission.

## 3. Unify the Bash tool backend

- [x] 3.1 Refactor Workspace bash construction to use the existing `bash-tool` Sandbox contract for both modes.
- [x] 3.2 Add the smallest structured cwd/signal dependency seam if the installed bash-tool destination wrapper cannot safely represent Host paths.
- [x] 3.3 Add backend parity tests for schemas, tool names, results, abort behavior, and output truncation.

## 4. Implement Host execution and policy

- [x] 4.1 Implement the real Bash runner with configured cwd, complete environment inheritance, closed stdin, piped output, exit status, timeout, and bounded buffering.
- [x] 4.2 Implement low-privilege uid/gid spawning, process-group termination, global single-slot concurrency, queue cancellation, and plugin-stop cleanup.
- [x] 4.3 Implement Host root canonicalization and direct `readFile`/`writeFile` path enforcement with symlink, traversal, and file-size checks.
- [x] 4.4 Implement just-bash AST traversal, ordinary-command allow classification, risk tags, parser-unsupported approval classification, and exact request fingerprints.

## 5. Add approval and audit flow

- [x] 5.1 Implement the in-memory approval broker with 60-second expiry, exact fingerprint binding, repeated same-fingerprint approval, cancellation, and stop invalidation.
- [x] 5.2 Register `yesimbot.workspace.approvals`, `approve`, and `reject` commands with `yesimbot.workspace.*` authority level 5 enforcement.
- [x] 5.3 Notify the originating channel through `ChannelPluginContext.bot` using redacted summaries and expose minimal lifecycle audit records without raw command or secret data.
- [x] 5.4 Wire `beforeToolCall` to await the broker and release the original tool call or block it without an Agent approval tool.

## 6. Prompt and focused verification

- [ ] 6.1 Replace the Host prompt with the approved operational instructions for real cwd, sensitive paths, risky calls, approval waiting, and rejection handling.
- [ ] 6.2 Add focused mount, Host policy, approval, plugin admission, prompt, runner, timeout, process-group, output-limit, and Sandbox regression tests.
- [ ] 6.3 Verify Host mode fails closed when identity, cwd, roots, or process cleanup guarantees are unavailable.
- [ ] 6.4 Run the narrow Workspace checks and record any platform-specific limitations before implementation is considered complete.
