## ADDED Requirements

### Requirement: Workspace Logical Identity And Storage Boundary
Workspace MUST use `channelIdentity(scope)` only for its in-memory cache and MUST use `ensureStorage(scope, "workspace")` as the sole workspace path source.

#### Scenario: Workspace is resolved
- **WHEN** a runtime requests its workspace
- **THEN** Core MAY expose readable raw channel coordinates in the resolved v1 directory, while the plugin MUST neither construct nor derive that directory protocol
