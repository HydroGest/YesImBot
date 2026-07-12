## MODIFIED Requirements

### Requirement: Core Service API

The Koishi core plugin MUST expose `ctx.yesimbot` as the main core service and MUST keep `ctx["yesimbot.model"]` as the model registry service.

#### Scenario: External plugin registers an agent plugin factory

- **WHEN** a Koishi plugin calls `ctx.yesimbot.registerAgentPlugin(factory)`
- **THEN** the core service MUST store the factory for channel runtimes created after registration
- **AND** the call MUST return a dispose function that unregisters that factory for future channel runtimes

#### Scenario: External plugin republishes a factory

- **WHEN** a Koishi plugin disposes a previously registered factory and registers a replacement factory
- **THEN** future channel runtimes MUST use the replacement factory
- **AND** already-created channel runtimes MUST NOT be hot-swapped by core in the first version

#### Scenario: Registered factory creates one channel plugin

- **WHEN** core creates a channel runtime
- **THEN** it MUST call each registered factory with the channel agent context
- **AND** each factory MUST return exactly one `AgentPlugin`

#### Scenario: Registered factory context is narrow

- **WHEN** core calls an agent plugin factory
- **THEN** the context MUST include channel metadata
- **AND** the context MUST include a platform section with platform name
- **AND** the context MAY include a raw Koishi bot handle as `platform.unsafeBot`
- **AND** the context MUST NOT include a full Koishi `Context` or current Koishi `Session`

#### Scenario: Unsafe bot handle is captured from channel creation

- **WHEN** core creates a channel runtime from an eligible Koishi session
- **THEN** `platform.unsafeBot` MUST reference the raw Koishi bot associated with that session when one is available
- **AND** existing channel runtimes MUST NOT hot-swap `platform.unsafeBot` if the underlying Koishi bot changes later

#### Scenario: Platform capabilities remain outside agent-runtime

- **WHEN** a plugin needs adapter-specific APIs such as OneBot `bot.internal`
- **THEN** the plugin MUST access them through the channel agent context and plugin-owned closures
- **AND** `agent-runtime` MUST NOT expose Koishi `Context`, Koishi `Session`, Koishi `Bot`, or adapter-specific internals through `AgentToolExecuteContext` or hook contexts

#### Scenario: Runtime handles are not exposed

- **WHEN** external code uses `ctx.yesimbot`
- **THEN** the service MUST NOT expose direct `getRuntime`, `createRuntime`, `send`, or `append` operations
