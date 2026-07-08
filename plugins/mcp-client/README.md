# koishi-plugin-yesimbot-mcp-client

Expose tools from configured MCP servers to Athena channel runtimes.

## Tool Registry

On startup, the plugin connects to each configured MCP server, calls `listTools()`, converts the returned MCP tools to `AgentTool` definitions, and publishes them through `AgentPlugin.tools`.

Tool names are prefixed with the server name:

```text
<server>-<tool>
```

For example, a server named `docs` exposing `search` becomes `docs-search`.

The published tool list is sorted by final tool name so model-call tool order remains stable across turns and future runtime creation.

## Tool List Changes

The plugin listens for MCP `notifications/tools/list_changed`. When a connected server reports a catalog change, the plugin:

1. Calls `listTools()` again for that server.
2. Rebuilds that server's cached `AgentTool` definitions.
3. Disposes the previous agent plugin factory.
4. Registers a replacement factory with the refreshed stable tool list.

This refresh affects channel runtimes created after the replacement factory is registered. Existing channel runtimes keep their initialized plugin tool registry until a future runtime hot-refresh capability is added.
