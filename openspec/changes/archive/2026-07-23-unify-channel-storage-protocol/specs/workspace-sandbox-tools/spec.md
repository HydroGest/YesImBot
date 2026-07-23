## MODIFIED Requirements

### Requirement: Channel-Scoped Workspace Isolation

The Workspace plugin SHALL register the `workspace` storage namespace and SHALL use the directory resolved by `YesImBotService.ensureStorage` as the default writable Workspace root.

#### Scenario: Distinct persistent channel identities use distinct workspace roots
- **WHEN** two Agent runtimes use different Core Channel Keys
- **THEN** each Runtime MUST receive a Workspace whose default writable files are isolated from the other Runtime
- **AND** each Workspace root MUST resolve beneath its Channel Key directory

#### Scenario: Same channel reuses persisted workspace
- **WHEN** an Agent runtime is recreated for the same Channel Key
- **THEN** the Workspace plugin MUST resolve the same `workspace` namespace root
- **AND** files written by a previous Runtime MUST remain available

#### Scenario: Shared channel changes assignee
- **WHEN** RuntimeManager rebuilds a shared-channel Runtime for a new Koishi assignee
- **THEN** the Workspace plugin MUST reuse the same Workspace root and cached persistent data

#### Scenario: Direct channels use bot isolation
- **WHEN** two direct scopes differ by `selfId`
- **THEN** they MUST resolve different Workspace roots

#### Scenario: Workspace root hides raw channel ids
- **WHEN** the Workspace plugin resolves a channel workspace directory
- **THEN** the directory name MUST NOT include raw `platform`, `selfId`, or `channelId`

#### Scenario: Workspace plugin does not implement channel paths
- **WHEN** the Workspace plugin needs a channel Workspace root
- **THEN** it MUST call `YesImBotService.ensureStorage` with the registered `workspace` namespace
- **AND** it MUST NOT use plugin-local target types, root configuration, channel sanitization, hash helpers, or path concatenation

#### Scenario: Workspace plugin unloads
- **WHEN** the Workspace plugin invokes its namespace disposer
- **THEN** Core and the plugin MUST preserve persisted Workspace data
