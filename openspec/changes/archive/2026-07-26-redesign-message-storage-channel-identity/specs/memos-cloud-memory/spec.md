## ADDED Requirements

### Requirement: Core Channel Identity Metadata
MemOS channel metadata MUST source `channel_hash` from `YesImBotService.channelIdentity(scope)` and MUST preserve MemOS-owned user, conversation, agent, author, and message identities.

#### Scenario: Shared assignee changes
- **WHEN** a shared channel changes assignee
- **THEN** MemOS MUST emit the same channel hash while deriving agent identity from the current real bot self ID
