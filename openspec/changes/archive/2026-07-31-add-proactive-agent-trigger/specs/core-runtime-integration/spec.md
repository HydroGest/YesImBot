# core-runtime-integration Specification Delta

## MODIFIED Requirements

### Requirement: Core Runtime Facade

`YesImBotService` MUST expose model access, scoped assets, SessionResolver registration, Agent plugin registration, `getStoragePath(scope)`, channel reset, global stop, and `trigger(event: EventRecord)`. It MUST delegate Session handling and channel runtime lifecycle to internal modules. It MUST own the Bot transport used by `trigger()` and MUST NOT expose RuntimeManager, ChannelRuntime, an output iterable, runtime reload, Will, or WillEngine factory registration.

#### Scenario: Platform plugin registers a resolver

- **WHEN** a plugin calls `ctx.yesimbot.registerResolver()`
- **THEN** the facade MUST delegate registration to Gateway

#### Scenario: Trusted caller triggers an event

- **WHEN** Core or a trusted plugin calls `ctx.yesimbot.trigger()` with a complete EventRecord
- **THEN** the facade MUST arrange forced handling through the target ChannelRuntime
- **AND** it MUST complete the operation without exposing runtime internals to the caller
