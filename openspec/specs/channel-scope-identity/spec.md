# channel-scope-identity Specification

## Requirements

### Requirement: Discriminated ChannelScope Is the Public Context
Core MUST expose `ChannelScope` as exactly one of:

```ts
{ type: "shared"; platform: string; channelId: string }
{ type: "direct"; platform: string; selfId: string; channelId: string }
```

A shared scope MUST NOT carry `selfId`; a direct scope MUST carry its real `selfId`.

#### Scenario: Plugin receives a shared scope
- **WHEN** Core initializes a plugin for a shared channel
- **THEN** the plugin MUST receive only the shared platform and channel coordinates

#### Scenario: Plugin receives a direct scope
- **WHEN** Core initializes a plugin for a direct channel
- **THEN** the plugin MUST receive the direct platform, real selfId, and channel coordinates

### Requirement: Persistent Coordinates Follow Tuple Semantics
Shared channels MUST use `[platform, channelId]` for persistent Channel and Runtime identity. Direct channels MUST use `[platform, selfId, channelId]`. The current Bot selfId for a shared runtime is transient and MUST NOT change shared persistence identity.

#### Scenario: Shared Bot changes
- **WHEN** the current Bot changes for the same shared platform and channel
- **THEN** Core MUST retain the same Channel and persistent resource root
- **AND** it MAY replace the transient ChannelRuntime

### Requirement: Readable Versionless Channel Roots
Channel roots MUST use safe readable `shared-*` or `direct-*` directory names below the configured channel root. Raw coordinates containing delimiters or traversal-looking text MUST remain contained and distinct.

#### Scenario: Direct coordinates are unsafe
- **WHEN** Core creates a direct channel root from unsafe raw coordinates
- **THEN** the result MUST remain below the channel root and not collide with another scope

### Requirement: No Public Opaque Identity
Core MUST NOT expose a ChannelKey, opaque channel identity string, tuple-key helper, directory helper, or storage map key as a package API.

### Requirement: Session-Free Runtime Scope
Messenger MAY derive ChannelScope from a live Session, but Channel, Conversation, Resources, Runtime, Agent history, Will state, and JSONL MUST retain no Session. EventRecord `selfId` is the explicit Bot selection field for trusted active posts.
