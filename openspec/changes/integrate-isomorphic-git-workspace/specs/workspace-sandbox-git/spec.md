## ADDED Requirements

### Requirement: Sandboxed Git command surface
Workspace SHALL expose a `git` custom command through the existing `bash` tool and SHALL execute it only against the current virtual workspace filesystem.

#### Scenario: Local Git command is invoked
- **WHEN** an Agent invokes `bash` with a supported command such as `git init`, `git status`, `git add`, `git commit`, `git log`, `git diff`, `git branch`, `git checkout`, or `git config`
- **THEN** Workspace SHALL dispatch the operation through isomorphic-git
- **AND** the operation SHALL use the current virtual working directory and `MountableFs`
- **AND** Workspace SHALL not invoke a host `git` executable or `child_process`

#### Scenario: Unsupported Git command is invoked
- **WHEN** an Agent invokes an unsupported Git subcommand or option
- **THEN** the custom command SHALL return a non-zero result with a concise unsupported-command error
- **AND** it SHALL not rewrite the request into another command

### Requirement: Git filesystem operations preserve mount semantics
Git SHALL read and write repository metadata and working-tree files through the same virtual filesystem used by the Workspace Bash tools.

#### Scenario: Repository is created in the default workspace
- **WHEN** `git init` or `git clone` targets `/home/workspace/repository`
- **THEN** the working tree and `.git` directory SHALL be created below the default channel workspace mount
- **AND** they SHALL follow that mount's existing persistence lifecycle

#### Scenario: Repository is created in an explicit writable mount
- **WHEN** a Git write targets a path below an `rw` mount
- **THEN** the working tree and `.git` data SHALL be written to that mount
- **AND** the mount's host-backed persistence behavior SHALL be preserved

#### Scenario: Repository write targets a read-only or overlay mount
- **WHEN** Git attempts to write below a `ro` mount
- **THEN** the operation SHALL fail before modifying the mount
- **WHEN** Git attempts to write below an `overlay` mount
- **THEN** the operation SHALL remain in the virtual upper layer
- **AND** it SHALL not write back to the overlay's host source

#### Scenario: Git targets an unmounted path
- **WHEN** Git attempts to read or write a path not represented by an available virtual mount
- **THEN** the virtual filesystem boundary SHALL decide the result
- **AND** Git SHALL not bypass that boundary through a host filesystem call

### Requirement: Remote Git obeys network admission
Remote Git operations SHALL require `bash.enableNetwork` and SHALL require the remote URL to match at least one configured `bash.allowedUrlPrefixes` entry.

#### Scenario: Network is disabled
- **WHEN** an Agent invokes `git clone`, `git fetch`, or `git pull` while `enableNetwork` is false or absent
- **THEN** the command SHALL fail with a network-disabled error
- **AND** it SHALL not issue an HTTP request

#### Scenario: Network is enabled without an allowlist
- **WHEN** an Agent invokes a remote Git operation while `enableNetwork` is true and `allowedUrlPrefixes` is empty or absent
- **THEN** the command SHALL fail closed
- **AND** it SHALL not issue an HTTP request

#### Scenario: Remote URL matches the allowlist
- **WHEN** an HTTPS remote URL matches a configured allowlist entry
- **THEN** the command MAY issue the required Git HTTP requests
- **AND** every redirect target SHALL be checked against the same allowlist

#### Scenario: Remote URL is not allowed
- **WHEN** an HTTPS remote URL does not match any configured allowlist entry
- **THEN** the command SHALL fail before the HTTP request is sent
- **AND** it SHALL report an allowlist rejection without exposing credentials or response contents

### Requirement: URL allowlist supports terminal wildcards
Workspace SHALL accept URL allowlist entries with an optional single terminal `*` wildcard and SHALL reject wildcard placement outside the terminal suffix.

#### Scenario: Terminal wildcard matches descendants
- **WHEN** the allowlist contains `https://github.com/example/*`
- **THEN** it SHALL match `https://github.com/example/repo.git`
- **AND** it SHALL match nested Git service paths below that prefix

#### Scenario: Prefix boundary is preserved
- **WHEN** the allowlist contains `https://api.example.com/v1/*`
- **THEN** it SHALL match paths below `/v1/`
- **AND** it SHALL not match `/v10/` or another origin

#### Scenario: Non-terminal wildcard is configured
- **WHEN** an allowlist entry contains a wildcard in the scheme, host, or middle of the path
- **THEN** Workspace configuration SHALL be rejected
- **AND** it SHALL not broaden network access as a fallback

### Requirement: Remote Git is public HTTPS only
Workspace SHALL support public HTTPS remote reads and SHALL reject SSH remotes, authentication callbacks, credential headers, and `git push`.

#### Scenario: Public HTTPS clone
- **WHEN** `git clone` receives an allowlisted HTTPS URL for a public repository
- **THEN** Workspace SHALL perform the clone through the sandbox HTTP policy
- **AND** it SHALL materialize the result in the virtual filesystem

#### Scenario: SSH or non-HTTPS remote
- **WHEN** a remote Git operation receives an SSH URL or a non-HTTPS URL
- **THEN** the command SHALL fail before opening a transport

#### Scenario: Push is requested
- **WHEN** an Agent invokes `git push`
- **THEN** the command SHALL fail explicitly as unsupported
- **AND** it SHALL not send an authenticated or unauthenticated receive-pack request

### Requirement: Git command cancellation and bounded output
Git custom commands SHALL respect the active Bash cancellation signal and SHALL return bounded textual results using the existing Bash result protocol.

#### Scenario: Git command is aborted
- **WHEN** the active Bash signal is aborted during local or remote Git work
- **THEN** Workspace SHALL cancel the Git operation where the transport and filesystem allow cancellation
- **AND** it SHALL return a non-zero cancellation result without continuing a detached host process

#### Scenario: Git output exceeds the tool limit
- **WHEN** a Git operation produces more output than the existing Bash tool limit
- **THEN** Workspace SHALL apply the existing output truncation behavior
- **AND** it SHALL preserve the non-zero or zero exit result independently of truncation
