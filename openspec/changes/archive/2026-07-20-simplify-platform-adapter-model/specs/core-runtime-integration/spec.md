## MODIFIED Requirements

### Requirement: Platform Message Conversion

Core MUST convert each eligible Koishi message into a runtime-domain `Platform.Message` whose working content is Koishi `Element[]`. After preparation and sealing, core MUST persist the new incompatible `athena.platform.message` custom runtime message as `Platform.MessageRecord` with literal `content: string`.

#### Scenario: Non-self message is admitted

- **WHEN** core receives a non-self Koishi session message and routing admits it
- **THEN** core MUST prepare and normalize elements before append or run submission
- **AND** custom message data MUST contain stable metadata and literal sealed `content` derived from `elements`
- **AND** it MUST NOT contain a duplicate `kind: "message"`, legacy message shape, snapshot, semantic view, or rendered presentation

#### Scenario: Self message is received

- **WHEN** core receives a message authored by the bot itself
- **THEN** it MUST ignore the message by default
- **AND** it MUST NOT enqueue preparation

### Requirement: Platform Event Type Surface

Core MUST expose public `Platform.Event` types with source, primary scope, type, optional platform timestamp, typed structured data, and frozen sanitized content. `Platform.Event` MUST NOT contain core receipt metadata. Plugins MUST extend event variants through TypeScript declaration merging without Fact, EventView, or template contributions.

#### Scenario: Platform event extension

- **WHEN** a plugin adds a non-message event kind
- **THEN** it MUST extend the event variant map through declaration merging
- **AND** the resulting event type MUST expose its declared structured data

### Requirement: Platform Message Model Projection

Core MUST provide a built-in runtime plugin that projects `athena.platform.message` through the fixed core envelope and core local-only element/image projection.

#### Scenario: Model conversion

- **WHEN** the built-in platform message plugin converts an `athena.platform.message`
- **THEN** core MUST produce a user model message with fixed formatted header and sealed content text
- **AND** it MUST NOT access platform APIs, network resources, or adapter model-projection hooks

#### Scenario: Unknown custom message

- **WHEN** the built-in platform message plugin receives another custom message type
- **THEN** it MUST leave conversion to other runtime plugins

## ADDED Requirements

### Requirement: Single Synchronous Adapter Refiner

Core MUST deterministically select at most one adapter for a collected Session and MAY invoke its optional synchronous `refine({ session, base })` hook before routing. Identity fields (`id`, optional `platform` / `adapter` / `profile`) MUST live flat on the adapter object without a nested identity type. The refiner MUST return a discriminated `Platform.RefineResult`: `keep`, `ignore`, `message`, or `event`. `keep` MUST retain an existing core base and otherwise act as ignore. `message` MUST replace an existing base message and is invalid without one. `event` MUST contain one complete semantic event. Core MUST NOT add separate message/event/scope/sender normalizer hooks, reader registries, or a multi-refiner pipeline.

#### Scenario: Adapter replaces a recognized message

- **WHEN** core has normalized a Session into a base `Platform.Message` and the selected adapter returns `message`
- **THEN** core MUST invoke that hook before routing
- **AND** it MUST use the returned message while preserving the base `receivedAt`

#### Scenario: Adapter returns message without a base

- **WHEN** core has no base message for a collected Session and the selected adapter returns `message`
- **THEN** core MUST record a diagnostic and ignore the invalid result
- **AND** it MUST skip adapter preparation for that Session

### Requirement: Core Receipt-Time Authority

Core MUST capture one `receivedAt` value immediately when collecting an inbound message Session and preserve it unchanged through synchronous normalization, adapter refinement, static classification, preparation, and persistence. `receivedAt` belongs to `Platform.Message` and `Platform.MessageRecord`, not `Platform.Event`. Core MUST NOT collect a second receipt timestamp for the same message.

#### Scenario: Collected Session becomes a message

- **WHEN** one collected Session is normalized as a `Platform.Message`
- **THEN** preparation and persistence MUST retain the same `receivedAt` value assigned at collection
- **AND** adapter replacement MUST NOT overwrite that value

### Requirement: Static Message-ID Tool Capability

Core MUST determine whether to include a formatted message ID from the active channel plugins' static `requiresMessageId` capability before constructing its platform projection plugin. Plugins that expose a message-operation tool MUST set this capability; plugins without such tools MUST NOT cause an ID field. This capability is not adapter-controlled and MUST NOT require model-time tool enumeration.

#### Scenario: OneBot operation tools are active

- **WHEN** an active OneBot utility plugin exposes reaction or essence operations for a channel
- **THEN** it MUST declare `requiresMessageId`
- **AND** core MUST configure that channel's projection to include raw message IDs

### Requirement: Canonical Platform Service Entry

Core MUST expose the plugin-facing platform service only through `ctx.yesimbot.platform`. Plugins MUST depend on the `yesimbot` service and use that typed property without assertions or an additional public service path.

#### Scenario: Platform plugin accesses the service

- **WHEN** a platform plugin registers or publishes through the platform service
- **THEN** it MUST use `ctx.yesimbot.platform`
- **AND** public documentation MUST describe that path as the sole platform service entry

### Requirement: FIFO Channel Message Lifecycle

For each admitted channel input, core MUST serialize static classification, message preparation, channel Agent resolution, the final runtime busy read, and the initial append/send/run submission in the per-channel FIFO. Static classification MUST produce `ignore`, `append`, or `reply` without consulting busy state. Core MUST return immediately for `ignore`. For `reply`, core MUST read `Agent.getActiveTurnId()` after preparation and immediately before submission, with no await between that read and `send(message, { ifBusy: "join" })` or `run(message)`. Model stream consumption, outbound response delivery, and terminal stream handling MUST occur outside the FIFO.

#### Scenario: Two messages arrive in one channel

- **WHEN** two eligible messages arrive for the same channel
- **THEN** core MUST complete the first message's preparation and initial submission before starting the second message's preparation
- **AND** core MUST make each reply's busy decision only after its preparation completes
- **AND** core MUST allow model turn stream consumption to proceed outside the lifecycle lock

### Requirement: Reset Is Ordered With Preparation

Core MUST enqueue reset in the same FIFO channel lifecycle as messages. Reset MUST wait for preparation and initial submission already ahead of it, then perform this strict order: `interrupt -> stop -> message storage clear -> channel asset clear -> runtime cache delete`. Messages enqueued after reset MUST not classify, prepare, resolve a runtime, or submit before reset completes.

#### Scenario: Reset follows image preparation

- **WHEN** reset is requested while a same-channel message is preparing images
- **THEN** reset MUST wait for that preparation and initial submission to finish
- **AND** reset MUST subsequently clear the resulting history and image assets before returning

#### Scenario: Message arrives after reset request

- **WHEN** an eligible message arrives after reset has been enqueued for its channel
- **THEN** core MUST not prepare or submit that message before the reset operation completes
