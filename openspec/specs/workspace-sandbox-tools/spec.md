# workspace-sandbox-tools Specification

## Requirements

### Requirement: Workspace lives under the channel root
The workspace plugin MUST obtain `getStoragePath(scope)` and use its `workspace/` child as the sandbox root.

#### Scenario: A workspace is initialized
- **WHEN** the workspace plugin creates a sandbox for a channel
- **THEN** it creates `workspace/` below the returned channel root

### Requirement: Workspace isolation follows channel tuple semantics
Shared scopes for different current Bots MUST reuse one workspace root; direct scopes with distinct selfIds MUST use distinct workspace roots.
