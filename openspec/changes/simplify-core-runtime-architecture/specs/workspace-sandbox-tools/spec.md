## MODIFIED Requirements

### Requirement: Channel-Scoped Workspace Isolation
Workspace MUST register the `workspace` namespace, use `channelIdentity(scope)` only as its in-memory cache key, and use `ensureStorage(scope, "workspace")` as its sole writable-root path source.

#### Scenario: Workspace is resolved
- **WHEN** a runtime requests its workspace
- **THEN** Core MAY expose readable raw channel coordinates in the resolved v1 directory, while the plugin MUST neither construct nor derive that directory protocol

#### Scenario: Shared assignee reload
- **WHEN** an operator reloads a shared channel after Koishi changes its assignee and a later admitted event creates a runtime for the current assignee
- **THEN** Workspace MUST reuse the same namespace root and cache identity
