# Proactive Agent Trigger Specification

## ADDED Requirements

### Requirement: Trusted Event Trigger Facade

Core MUST expose `ctx.yesimbot.trigger(event: EventRecord)` to Core and trusted in-process plugins. The operation MUST accept a complete EventRecord and MUST NOT accept a synthetic MessageRecord. It MUST resolve only after the forced runtime operation and any output delivery have completed.

#### Scenario: Trusted plugin triggers an event

- **WHEN** a trusted plugin calls `ctx.yesimbot.trigger()` with a declaration-merged EventRecord
- **THEN** Core MUST use that record's `platform`, `selfId`, and `channel` as the target
- **AND** Core MUST retain the event's `eventType`, `text`, and declared variant fields

#### Scenario: Matching Bot is unavailable

- **WHEN** no current Bot exactly matches the EventRecord's `platform` and `selfId`
- **THEN** `trigger()` MUST reject
- **AND** Core MUST NOT commit the EventRecord or start an Agent turn

### Requirement: Forced Event Turn

Core MUST commit a triggered EventRecord through the target channel's existing FIFO and MUST publish `yesimbot/event` after durable append. Core MUST force an idle runtime to start one Agent turn and MUST join a busy runtime to its active turn. The forced path MUST NOT evaluate Will or publish `yesimbot/will` for that event.

#### Scenario: Forced event reaches an idle runtime

- **WHEN** a trusted trigger targets an idle ChannelRuntime
- **THEN** Core MUST append and publish the EventRecord before starting one Agent turn
- **AND** Core MUST expose one internal output iterable for that turn

#### Scenario: Forced event reaches a busy runtime

- **WHEN** a trusted trigger targets a ChannelRuntime with an active turn
- **THEN** Core MUST join the EventRecord to that turn
- **AND** Core MUST NOT create another Agent stream consumer or output iterable

### Requirement: Triggered Event Model Projection

Core MUST project a triggered EventRecord through the existing event model projection. The model-visible event content MUST contain only the event type and frozen text inside the existing untrusted event wrapper; Core MUST NOT promote event text to system-instruction authority or project declaration-merged variant fields by default.

#### Scenario: Trigger contains extension fields

- **WHEN** a triggered EventRecord includes declaration-merged variant fields
- **THEN** plugins and Core observers MUST receive those fields as structured event data
- **AND** the default model projection MUST omit them
