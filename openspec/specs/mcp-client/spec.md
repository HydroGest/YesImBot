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
- **AND** it MUST publish those tools by registering an agent plugin factory whose plugin contains a `tools` field

#### Scenario: Tool name prefix

- **WHEN** an MCP server named `docs` exposes a tool named `search`
- **THEN** the exposed agent tool name MUST be `docs-search`
- **AND** the prefixed name MUST be used for conflict detection by the agent runtime

#### Scenario: Stable tool order

- **WHEN** MCP tools are published to the agent plugin factory
- **THEN** the plugin MUST sort the exposed tool list by final agent tool name
- **AND** later factories created from the same catalog MUST expose tools in the same order

### Requirement: MCP Tool Catalog Refresh

The MCP client plugin MUST react to MCP tool catalog change notifications by refreshing the cached server tool registry and republishing the agent plugin factory.

#### Scenario: Server reports tool list change

- **WHEN** a connected MCP server sends `notifications/tools/list_changed`
- **THEN** the plugin MUST call `listTools()` again for that server
- **AND** it MUST rebuild that server's cached tool definitions
- **AND** it MUST dispose the previously registered agent plugin factory
- **AND** it MUST register a replacement factory exposing the refreshed stable tool list

#### Scenario: Refresh affects future runtimes

- **WHEN** the MCP client republishes its agent plugin factory after a tool list change
- **THEN** channel runtimes created after the refresh MUST see the refreshed tool list
- **AND** already-created channel runtimes MUST NOT be assumed to receive the refreshed tools unless a future runtime hot-refresh capability is added

#### Scenario: Refresh failure

- **WHEN** refreshing a server's tool list fails
- **THEN** the plugin MUST log the failure
- **AND** it MUST NOT publish a partial empty replacement for that server solely because refresh failed

### Requirement: MCP Resource Cleanup

The MCP client plugin MUST clean up registered factories and MCP resources on stop.

#### Scenario: Plugin stop

- **WHEN** the MCP client stops
- **THEN** it MUST dispose any registered agent plugin factory
- **AND** it MUST close connected MCP clients
- **AND** it MUST close connected transports
- **AND** it MUST clear internal client and transport registries
