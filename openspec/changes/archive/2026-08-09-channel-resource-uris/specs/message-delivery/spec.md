# message-delivery Specification

## ADDED Requirements

### Requirement: Resource source preparation before delivery
Core MUST prepare recognized `asset://`, `artifact://`, and `workspace://` sources in `img` and `file` elements before passive Gateway delivery, autonomous Bot delivery, or the current-Bot active send tool reaches a platform adapter. Core MUST resolve each source within the producing channel scope, validate its media and delivery limits, and materialize only a representation supported by that platform. Core MUST preserve unrecognized structured elements without URI recovery or an element whitelist.

#### Scenario: Passive output sends a workspace image
- **WHEN** an assistant segment contains `<img src="workspace:///images/chart.png"/>`
- **THEN** Core MUST resolve the current channel workspace file before `Session.send()`
- **AND** it MUST send a platform-supported structured image element rather than `workspace://`

#### Scenario: Active send uses an artifact image
- **WHEN** the current-Bot active send tool sends content containing `<img src="artifact://mcp_screenshot/019d3b7e-1bd0-7e4f-9c5d-5bf3fd41f1d4"/>`
- **THEN** Core MUST prepare that source through the same resolver path used for passive delivery

### Requirement: Active send resource-source guidance
The Core `sendMessage` tool description MUST state that `img` and `file` source attributes may use an existing channel `asset://`, `artifact://`, or `workspace://` URI. It MUST state that Core resolves those sources before platform delivery. The description MUST NOT imply that `sendMessage` reads `skill://` or arbitrary host paths.

#### Scenario: The Agent prepares an active attachment send
- **WHEN** the Runtime exposes the current-Bot `sendMessage` tool
- **THEN** its description MUST identify the three supported source schemes
- **AND** it MUST identify Core as the delivery-time resolver

#### Scenario: A referenced output resource is unavailable
- **WHEN** Core cannot resolve one recognized resource source in an output segment
- **THEN** Core MUST omit only that unavailable media reference
- **AND** it MUST preserve sibling output content and record a safe diagnostic without a host path, source URL, or raw bytes
