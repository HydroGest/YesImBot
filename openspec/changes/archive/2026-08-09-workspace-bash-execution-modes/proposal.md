## Why

Workspace currently exposes only a `just-bash` virtual filesystem. Operators need an explicitly selected Host mode for real Bash and host paths, but silently changing the default would widen the existing security boundary. The change also needs a reviewable approval path for risky calls and must remove the unapproved Sandbox Git exposure from the current WIP.

## What Changes

**Execution mode selection**
- From: every Workspace channel uses the Sandbox backend.
- To: a discriminated `bash.mode` selects `sandbox` or `host`, with `sandbox` as the default.
- Reason: make the higher-risk capability explicit without changing existing deployments.
- Impact: new Host configuration and runtime behavior; existing Sandbox behavior remains the default.

**Host execution**
- Add a real Bash backend behind the existing `bash-tool` `Sandbox` contract.
- Use real channel workspace paths, a required low-privilege OS identity, Host roots, channel allowlisting, process cleanup, and approval interception.
- Do not add `host-exec`, a second tool schema, or a dedicated Git tool.

**Sandbox rollback and mounts**
- Replace the three public mount maps with a single `source`/`target`/`mode` declaration while preserving `rw`, `ro`, and virtual `overlay` semantics.
- Remove the unapproved Git tool and Host temporary-mount changes from the current WIP.

## Capabilities

### New Capabilities

- `workspace-host-bash`: Selectable real-host Bash execution with Host channel admission, Host roots, low-privilege process execution, AST-based risk classification, explicit approval, notifications, and audit events.

### Modified Capabilities

- `workspace-sandbox-tools`: Preserve the default `bash`/`readFile`/`writeFile` Sandbox tool set, formalize the single-array mount model, and remove Git/Host-temporary exposure from Sandbox.

## Impact

Affected areas include `plugins/workspace/src/index.ts`, `types.ts`, `mounts.ts`, `bash-tool.ts`, `workspace.ts`, `prompt.ts`, and a refactored `host-engine.ts` plus `host-policy.ts`. Focused Workspace and new Host policy/runner tests are required. The design may require a minimal `bash-tool` structured-cwd seam. No source implementation, configuration, test, or general documentation is changed by this design-only record.
