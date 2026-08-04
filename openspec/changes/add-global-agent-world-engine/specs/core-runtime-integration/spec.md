## MODIFIED Requirements

### Requirement: Core Runtime Facade

`YesImBotService` MUST expose model access, scoped assets, SessionResolver registration, Agent plugin registration, `getStoragePath(scope)`, channel reset, global stop, `trigger(event: EventRecord)`, and a dedicated `ctx.yesimbot.global` module for shared GlobalAgent management. It MUST delegate Session handling and channel runtime lifecycle to internal channel modules and MUST delegate GlobalAgent lifecycle to internal global modules. It MUST own the Bot transport used by `trigger()` and MUST NOT expose either RuntimeManager, ChannelRuntime, GlobalRuntime, an output iterable, runtime reload, Will, or WillEngine factory registration.

#### Scenario: Platform plugin registers a resolver

- **WHEN** a plugin calls `ctx.yesimbot.registerResolver()`
- **THEN** the facade MUST delegate registration to Gateway

#### Scenario: Trusted caller triggers an event

- **WHEN** Core or a trusted plugin calls `ctx.yesimbot.trigger()` with a complete EventRecord
- **THEN** the facade MUST arrange forced handling through the target ChannelRuntime
- **AND** it MUST complete the operation without exposing runtime internals to the caller

#### Scenario: Trusted caller manages a GlobalAgent

- **WHEN** a trusted plugin calls an operation on `ctx.yesimbot.global`
- **THEN** the facade MUST route it through internal GlobalAgent hosting
- **AND** it MUST NOT expose GlobalRuntimeManager or GlobalRuntime

### Requirement: Runtime Manager Ownership

Core's channel runtime manager MUST own ChannelRuntime creation, replacement, reset, and channel-runtime shutdown. It MUST share concurrent first creation for one persistent channel tuple. GlobalRuntimeManager MUST own explicit GlobalRuntime start, replacement, stop, clear, and Core shutdown for one `agentId`. Neither manager may accept Session, call SessionResolver, serve as an event broadcast bus, or expose its runtime map publicly. GlobalRuntimeManager MUST NOT send platform messages.

#### Scenario: First event reaches a channel

- **WHEN** the channel runtime manager routes the first resolved event for a channel
- **THEN** it MUST create exactly one ChannelRuntime for the channel tuple

#### Scenario: Concurrent events reach an uncached channel

- **WHEN** multiple events concurrently require the same new channel
- **THEN** the channel runtime manager MUST create one ChannelRuntime and route every event to it

#### Scenario: Trusted plugin starts a GlobalAgent

- **WHEN** a valid explicit start targets an inactive GlobalScope
- **THEN** GlobalRuntimeManager MUST create exactly one GlobalRuntime for its agentId
- **AND** it MUST NOT require or synthesize Session

### Requirement: Runtime Stop Ordering

Global stop MUST stop Gateway admission, stop both runtime-manager admissions, interrupt and stop all ChannelRuntime Agent and WillEngine instances, interrupt and stop all GlobalRuntime Agent instances, terminate channel output iterables, wait active Gateway handlers, and release in-memory runtimes. Global stop MUST preserve every channel and GlobalAgent JSONL history and scoped asset root.

#### Scenario: Core is disposed during an active channel turn

- **WHEN** global stop begins while a channel turn is active
- **THEN** Core MUST prevent new admission and terminate the active runtime work
- **AND** it MUST wait for the owning Gateway handler to finish

#### Scenario: Core is disposed during an active global turn

- **WHEN** global stop begins while a GlobalAgent turn or tool is active
- **THEN** Core MUST prevent new global submissions and interrupt that work
- **AND** it MUST wait for GlobalRuntime teardown without deleting persisted data
