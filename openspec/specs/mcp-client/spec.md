# mcp-client Specification

## Purpose

Define how `koishi-plugin-yesimbot-mcp-client` connects MCP servers, exposes MCP tools through the agent plugin system, refreshes tool catalogs, and cleans up resources.

## Requirements

### Requirement: Stable MCP Tool Registry
The MCP client plugin MUST expose MCP server tools through stable `AgentPlugin.tools` declarations rather than recreating tools through `extendTools` on every turn.

#### Scenario: Initial tool discovery
- **WHEN** the MCP client starts and connects to configured servers
- **THEN** it MUST call `listTools()` for each connected server
- **AND** it MUST convert returned MCP tools to named `AgentTool` definitions
- **AND** it MUST publish those tools through a named AgentPlugin object registered with `ctx.yesimbot.agent.use`

#### Scenario: Tool name prefix
- **WHEN** an MCP server named `docs` exposes a tool named `search`
- **THEN** the exposed agent tool name MUST be `docs-search`
- **AND** the prefixed name MUST be used for conflict detection by the agent runtime

#### Scenario: Stable tool order
- **WHEN** MCP tools are published to the AgentPlugin object
- **THEN** the plugin MUST sort the exposed tool list by final agent tool name
- **AND** later runtime snapshots created from the same catalog MUST expose tools in the same order

### Requirement: MCP Tool Catalog Refresh
The MCP client plugin MUST react to MCP tool catalog change notifications by refreshing the cached server tool registry and replacing its registered AgentPlugin object.

#### Scenario: Server reports tool list change
- **WHEN** a connected MCP server sends `notifications/tools/list_changed`
- **THEN** the plugin MUST call `listTools()` again for that server
- **AND** it MUST rebuild that server's cached tool definitions
- **AND** it MUST dispose the previously registered AgentPlugin object
- **AND** it MUST register a replacement object through `ctx.yesimbot.agent.use`

#### Scenario: Refresh affects future runtimes
- **WHEN** the MCP client replaces its AgentPlugin object after a tool list change
- **THEN** channel runtimes created after the refresh MUST see the refreshed tool list
- **AND** already-created channel runtimes MUST retain their existing snapshot

#### Scenario: Refresh failure
- **WHEN** refreshing a server's tool list fails
- **THEN** the plugin MUST log the failure
- **AND** it MUST NOT publish a partial empty replacement for that server solely because refresh failed

### Requirement: MCP Resource Cleanup
The MCP client plugin MUST clean up its registered AgentPlugin object and MCP resources on stop.

#### Scenario: Plugin stop
- **WHEN** the MCP client stops
- **THEN** it MUST dispose the registered AgentPlugin object
- **AND** it MUST close connected MCP clients
- **AND** it MUST close connected transports
- **AND** it MUST clear internal client and transport registries


### Requirement: MCP inline media becomes artifact references
The MCP client plugin MUST recognize supported inline image blocks, validate and persist their bytes through its current channel-bound artifact writer, and return compact safe metadata plus the canonical `artifact://<tool-name>/<uuid-v7>` URI. It MUST NOT return Base64 image data, provider-specific media parts, source URLs, or opaque serialized media blocks to Agent history or model input.

#### Scenario: MCP tool returns an inline image
- **WHEN** an MCP tool returns a supported inline image block within the configured image limits
- **THEN** the plugin MUST persist the decoded bytes through its current channel-bound artifact writer
- **AND** it MUST return a compact `artifact://` reference

#### Scenario: MCP tool returns an unknown media block
- **WHEN** an MCP tool returns a non-text block that is not a supported inline image
- **THEN** the plugin MUST return a bounded safe description
- **AND** it MUST NOT `JSON.stringify` the opaque block into model input

#### Scenario: MCP tool returns a remote URL
- **WHEN** an MCP tool returns a remote media URL or resource link
- **THEN** the plugin MUST return a safe reference description
- **AND** it MUST NOT fetch that URL automatically

### Requirement: MCP artifact guidance preserves remote tool descriptions
The MCP client plugin MUST add one Runtime-level system prompt stating that MCP media results are immutable `artifact://` references and that the Agent calls Core `read` only when the media content is needed. It MUST state that media is not inline Base64 and that remote URLs are not automatically available. The plugin MUST preserve each remote MCP tool's original description rather than appending that common guidance to every tool description.

#### Scenario: An MCP Runtime is initialized
- **WHEN** the MCP client contributes one or more remote tools to a channel Runtime
- **THEN** the Runtime system prompt MUST contain the MCP artifact guidance once
- **AND** each remote tool description MUST retain its server-provided text