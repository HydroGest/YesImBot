# mcp-client Specification

## ADDED Requirements

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
