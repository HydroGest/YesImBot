# message-delivery Specification

## Purpose

Define Gateway-owned passive delivery, normalized send results, durable failure feedback, and current-bot active sending.

## Requirements

### Requirement: Gateway-Owned Passive Delivery
Gateway MUST call the original `Session.send()` for every ChannelRuntime output; RuntimeManager and ChannelRuntime MUST NOT receive a Session or Session-bound send capability.

#### Scenario: Runtime yields output
- **WHEN** Gateway receives a ChannelRuntime output
- **THEN** it MUST send it through the active Session without waiting for the full turn

### Requirement: Durable Passive Delivery Failure
A rejected passive send MUST create a same-channel `yesimbot.event` with `schemaVersion: 1`, `eventType: "delivery.failed"`, frozen `text`, turn ID, and assistant message ID. DefaultWill MUST not trigger a new turn for it.

#### Scenario: Passive output fails
- **WHEN** `Session.send()` rejects
- **THEN** Gateway MUST route one delivery-failure EventRecord through the producing runtime and MUST not recursively create another failure

### Requirement: Current-Bot Active Send Tool
Core MUST provide an Agent tool that sends through the current bot to an explicit channel and returns normalized success IDs or an error without selecting another bot.

#### Scenario: Active send resolves
- **WHEN** the tool's `Bot.sendMessage()` resolves with a string array
- **THEN** it MUST return the array, including an empty array, as success
