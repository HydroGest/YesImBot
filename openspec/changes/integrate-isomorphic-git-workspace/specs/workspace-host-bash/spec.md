## REMOVED Requirements

### Requirement: Host mode selection

**Reason**: Workspace no longer exposes real-host Bash execution; the sandbox is the only execution backend.

**Migration**: Remove `bash.mode` and configure the remaining sandbox fields directly under `bash`.

### Requirement: Host channel admission

**Reason**: There is no Host capability to admit or deny.

**Migration**: Delete Host channel allowlist configuration and approval admission checks.

### Requirement: Host backend reuses the bash-tool contract

**Reason**: The Host backend is removed rather than maintained as a second implementation.

**Migration**: Keep the existing sandbox `bash`, `readFile`, and `writeFile` contracts only. Use the `workspace-sandbox-git` requirements for sandbox Git.

### Requirement: Real Host process execution

**Reason**: Workspace must not start arbitrary `/bin/bash` processes for Agent calls.

**Migration**: Use the just-bash virtual execution backend and virtual mounts.

### Requirement: Host process identity and cleanup

**Reason**: Host process identity, process groups, and Host runner lifecycle no longer exist.

**Migration**: Remove `uid`, `gid`, Host runner slots, and Host process cleanup paths.

### Requirement: Host root policy

**Reason**: Direct Host file access is removed.

**Migration**: Use the configured sandbox mount boundary; retain only `rw`, `ro`, and `overlay` virtual mount semantics.

### Requirement: AST-based Host risk classification

**Reason**: No real Host Bash call requires a separate approval classifier.

**Migration**: Delete Host policy parsing and risk tags; sandbox safety remains enforced by just-bash and mount boundaries.

### Requirement: Explicit approval without an Agent approval tool

**Reason**: Host approval requests are removed with Host execution.

**Migration**: Remove the in-memory approval broker and all approval hook interception.

### Requirement: Host approval notification and authority

**Reason**: There are no Host requests to notify or approve.

**Migration**: Remove the Host approval Koishi commands and authority checks.

### Requirement: Host audit records

**Reason**: Host approval and execution outcomes are no longer produced.

**Migration**: Remove Host-specific audit events; retain ordinary Workspace/plugin logging where already required.
