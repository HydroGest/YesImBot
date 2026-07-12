## MODIFIED Requirements

### Requirement: Channel Runtime Identity

Core MUST create and cache one agent runtime per `ChannelScopeId` derived from the current `ChannelScope`.

#### Scenario: First message in a channel
- **WHEN** core receives the first eligible message for a channel scope
- **THEN** it MUST derive a `ChannelScopeId`
- **AND** it MUST lazily create an agent runtime for that id

#### Scenario: Subsequent message in the same channel
- **WHEN** core receives another eligible message with the same platform, self id, and channel id
- **THEN** it MUST derive the same `ChannelScopeId`
- **AND** it MUST reuse the existing runtime for that id

#### Scenario: Same channel with different bot identity
- **WHEN** core receives messages with the same platform and channel id but different self ids
- **THEN** it MUST derive different `ChannelScopeId` values
- **AND** it MUST use different runtimes

#### Scenario: Channel type metadata
- **WHEN** core creates the channel runtime context
- **THEN** it MUST include whether the channel is private or group
- **AND** the channel type MUST NOT be part of the `ChannelScopeId`

### Requirement: Core Configuration

Core MUST keep first-version configuration limited to `basePath`, `chatModel`, and `logLevel`.

#### Scenario: Resolve unified base path
- **WHEN** `basePath` is relative
- **THEN** core MUST resolve it against Koishi `ctx.baseDir`

#### Scenario: Use absolute base path
- **WHEN** `basePath` is absolute
- **THEN** core MUST use it as-is

#### Scenario: Locate core data files
- **WHEN** core needs prompt files, model configuration, channel metadata, or sessions
- **THEN** it MUST resolve `AGENTS.md`, `PERSONA.md`, and `models.json` under the unified base path
- **AND** it MUST resolve channel metadata and session files under `channels/<ChannelScopeId>/`

### Requirement: Channel JSONL Storage

Core MUST use one append-only JSONL storage file per channel runtime under that channel's canonical directory.

#### Scenario: Storage path construction
- **WHEN** core creates storage for a channel runtime
- **THEN** it MUST derive the `ChannelScopeId` from the current `ChannelScope`
- **AND** it MUST place the JSONL file at `basePath/channels/<ChannelScopeId>/sessions/messages.jsonl`
- **AND** it MUST NOT derive the filename from sanitized raw platform fields

#### Scenario: Scope metadata is ensured before storage use
- **WHEN** core creates channel storage
- **THEN** it MUST ensure the channel scope metadata record exists for the derived `ChannelScopeId`

#### Scenario: Storage contract
- **WHEN** agent-runtime calls the channel storage
- **THEN** the storage MUST support `append`, `read`, and `clear`
- **AND** the storage MUST NOT require indexes, pagination, migrations, or compression

#### Scenario: Restart reads history
- **WHEN** core recreates a channel runtime whose canonical JSONL file already exists
- **THEN** the runtime storage MUST read the previously appended entries

### Requirement: Channel Reset

Core MUST support current-channel reset through the `ctx.yesimbot.resetChannel(scope)` service API and a minimal Koishi command.

#### Scenario: Reset scope
- **WHEN** reset is requested
- **THEN** the scope MUST identify platform, self id, and channel id as a `ChannelScope`

#### Scenario: Reset operation
- **WHEN** core resets a channel with an existing runtime
- **THEN** it MUST interrupt the runtime, stop it, clear the channel JSONL storage, and remove it from the runtime cache

#### Scenario: Reset without existing runtime
- **WHEN** core resets a channel that has no cached runtime
- **THEN** it MUST clear that channel's JSONL storage if present under the canonical channel directory

#### Scenario: Command scope
- **WHEN** a user runs the reset command
- **THEN** the command MUST reset only the current Koishi channel
- **AND** it MUST NOT accept a scope for another channel in the first version

#### Scenario: Command authority
- **WHEN** a user without administrator authority runs the reset command
- **THEN** Koishi command authorization MUST prevent the reset
