# channel-will-evaluation Specification

## Purpose
Define passive-input participation decisions and the active Messenger post bypass.

## Requirements

### Requirement: Fixed Core Will Selection
Core MUST provide one fixed default WillEngine. Without a live Session match, a new ChannelRuntime MUST use that default. The default MUST trigger direct messages and messages mentioning the current Bot, and MUST wait for ordinary shared messages and non-message events.

#### Scenario: Default engine evaluates input
- **WHEN** a runtime without a matching WillPlugin evaluates a direct message, a Bot mention, or an ordinary shared message
- **THEN** it MUST return `trigger`, `trigger`, or `wait` respectively

### Requirement: Session-Filtered Will Plugins
Optional WillPlugin instances MUST register through `ctx.yesimbot.agent.will(plugin)`, expose one numeric priority, match only while the live Session is available during runtime creation, and provide a WillEngine setup. Core MUST sort plugins by ascending priority and stable registration order, selecting the first match. No WillPlugin or WillEngine may retain the Session.

#### Scenario: Multiple Will plugins compete
- **WHEN** several registered plugins match one live Session
- **THEN** Core MUST select the first plugin by priority and registration order

#### Scenario: No Session is available
- **WHEN** a runtime is created without a live Session
- **THEN** Core MUST select the fixed default and MUST NOT invoke a Session matcher

### Requirement: Passive Will Decision Ordering
ChannelRuntime MUST persist and emit an ordinary accepted input before calling `WillEngine.decide()`. A decision MUST be `wait` or `trigger`; `wait` MUST not start or join a turn. A passive turn that produced assistant output MAY call `WillEngine.observe()` once after its output stream completes.

#### Scenario: Will waits
- **WHEN** WillEngine returns `wait` for an ordinary input
- **THEN** the runtime MUST retain the input without starting an Agent turn

#### Scenario: Passive turn produces output
- **WHEN** a passive turn produces renderable assistant output
- **THEN** Core MUST observe the completed reply at most once

### Requirement: Active Post Bypass
`ctx.yesimbot.messenger.post(event, { trigger: true })` MUST bypass both `WillEngine.decide()` and `WillEngine.observe()`. It MUST still use the runtime FIFO, Agent lifecycle, model, tools, output queue, and producing-runtime failure feedback. `trigger: false` MUST bypass Will and record the event without starting or joining a turn.

#### Scenario: Active post bypasses Will
- **WHEN** a trusted plugin posts an EventRecord
- **THEN** Core MUST not call `WillEngine.decide()` or `WillEngine.observe()` for that post
- **AND** Core MUST use the normal Agent turn and delivery path when triggered

### Requirement: Delivery Failure Does Not Trigger Will
A rejected passive or active delivery MUST append one same-channel `delivery.failed` EventRecord through the producing runtime. Core MUST NOT call `messenger.post()` or evaluate Will for that feedback event.
