## ADDED Requirements

### Requirement: Host mode selection
Workspace SHALL support a discriminated `bash.mode` configuration with `sandbox` and `host` branches, and SHALL use `sandbox` when the mode is absent.

#### Scenario: Default mode remains sandbox
- **WHEN** Workspace is configured without a Host mode
- **THEN** the plugin SHALL create the existing just-bash virtual filesystem and SHALL expose only the Sandbox tool set

#### Scenario: Host mode is explicitly selected
- **WHEN** `bash.mode` is `host`
- **THEN** the plugin SHALL use Host admission and SHALL not initialize a Workspace virtual filesystem for that channel

### Requirement: Host channel admission
Host execution SHALL require an allow-only rule matching the channel `platform`, `channelId`, optional `type`, and optional `selfId`.

#### Scenario: Channel matches an allow rule
- **WHEN** a complete Host allow rule matches the Runtime ChannelScope
- **THEN** Host tools SHALL be eligible for registration and execution

#### Scenario: Channel does not match
- **WHEN** the Host allowlist is missing, empty, invalid, or has no complete match
- **THEN** the plugin SHALL not register Host tools and SHALL block any Host tool call

#### Scenario: Sandbox is used on an unlisted channel
- **WHEN** `bash.mode` is `sandbox` and the channel is not in the Host allowlist
- **THEN** the existing Sandbox behavior SHALL remain unaffected

### Requirement: Host backend reuses the bash-tool contract
Host execution SHALL be implemented as a backend of the existing bash-tool Sandbox contract and SHALL expose `bash`, `readFile`, and `writeFile` with the existing schemas and result protocol.

#### Scenario: Host tools are assembled
- **WHEN** an allowed Host Runtime initializes its tools
- **THEN** the tool names and input/output contracts SHALL be the same as the Sandbox tools

#### Scenario: Host tool assembly avoids virtual filesystem initialization
- **WHEN** Host tools are assembled
- **THEN** the plugin SHALL not create `Workspace`, `MountableFs`, just-bash execution state, virtual mounts, or `hostTmpRoot`

### Requirement: Real Host process execution
Host Bash SHALL run as a non-interactive real `/bin/bash` process in the channel's real `getStoragePath(scope)/workspace` directory.

#### Scenario: Command execution
- **WHEN** a Host Bash call is allowed
- **THEN** the runner SHALL execute the original command with closed stdin, piped stdout/stderr, the real channel workspace cwd, and the configured full environment

#### Scenario: Exit and timeout results
- **WHEN** the Host process exits, times out, or is aborted
- **THEN** the backend SHALL preserve the exit result protocol, enforce the existing output limit, and report timeout/cancellation without exposing process internals

### Requirement: Host process identity and cleanup
Host execution SHALL require a configured existing low-privilege `uid/gid` identity and SHALL clean up the complete process group on abort, timeout, plugin stop, or Runtime cancellation.

#### Scenario: Missing or unusable identity
- **WHEN** the configured identity cannot be used
- **THEN** Host execution SHALL be unavailable and SHALL not fall back to the Koishi process identity

#### Scenario: Process cancellation
- **WHEN** a Host process is cancelled or times out
- **THEN** the runner SHALL terminate its process group, escalate after a bounded grace period, and release the global Host execution slot

### Requirement: Host root policy
Host direct file tools SHALL enforce explicit Host root modes independently of Sandbox mounts.

#### Scenario: Read within a Host root
- **WHEN** `readFile` targets an existing regular file under an implicit workspace root or declared `ro/rw` Host root
- **THEN** the read SHALL be eligible for execution subject to the risk approval policy and file-size limit

#### Scenario: Write outside a writable root
- **WHEN** `writeFile` targets a path outside a declared `rw` root or through traversal/final symlink
- **THEN** the operation SHALL be blocked before any host file is opened

### Requirement: AST-based Host risk classification
Host policy SHALL use the public just-bash parser AST when available and SHALL classify ordinary bounded read-only commands as allow and risky or uncertain commands as requiring explicit approval.

#### Scenario: Ordinary command
- **WHEN** a command is syntactically parsed, bounded, read-only, non-networked, and has no risky expansion or process behavior
- **THEN** `beforeToolCall` SHALL allow the original tool call

#### Scenario: Risky command
- **WHEN** the AST identifies writes, deletion, overwrite, network, interpreters, scripts, background work, complex expansion, or other risk tags
- **THEN** `beforeToolCall` SHALL pause the original call and request explicit approval before execution

#### Scenario: Unsupported host syntax
- **WHEN** just-bash cannot parse a command that may be valid host Bash
- **THEN** policy SHALL mark it `parser-unsupported` and SHALL request explicit approval rather than directly allowing it

### Requirement: Explicit approval without an Agent approval tool
A risky Host call SHALL be intercepted by `beforeToolCall`, reported through an internal approval broker, and either release the original call or block it.

#### Scenario: Approval request is created
- **WHEN** `beforeToolCall` classifies a call as risky
- **THEN** the broker SHALL create an in-memory request bound to Scope, tool, cwd, policy revision, and command fingerprint, and SHALL not start Bash

#### Scenario: Administrator approves
- **WHEN** an authority-5 administrator approves the matching request within its 60-second lifetime
- **THEN** the broker SHALL release the original unchanged tool call

#### Scenario: Approval is rejected or expires
- **WHEN** an administrator rejects the request, the request expires, the Runtime is cancelled, or the plugin stops
- **THEN** the original tool call SHALL be blocked and SHALL not be rewritten for an automatic retry

### Requirement: Host approval notification and authority
The broker SHALL notify the originating channel and SHALL expose authority-5 Koishi approval commands under `yesimbot.workspace.*`; it SHALL not expose an approval Agent tool.

#### Scenario: User is notified
- **WHEN** a risky call becomes pending
- **THEN** the broker SHALL send a redacted request ID, risk summary, expiry, and administrator instructions through the ChannelPluginContext bot without retaining the originating Session

#### Scenario: Unauthorized approval attempt
- **WHEN** a user below authority level 5 invokes an approval command
- **THEN** the command SHALL be rejected and the pending request SHALL remain unchanged

### Requirement: Host audit records
Host approval and execution outcomes SHALL be auditable without logging raw commands, secret values, or file contents.

#### Scenario: Approval lifecycle is recorded
- **WHEN** a request is created, approved, rejected, expired, cancelled, or executed
- **THEN** the Workspace logger SHALL record request ID, Scope, tool, fingerprint, risk tags, policy revision, actor for approval actions, duration, exit/signal, and truncation/cancellation flags without raw command text or output
