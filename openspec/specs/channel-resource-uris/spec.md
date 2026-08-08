# channel-resource-uris Specification

## Purpose
TBD: Canonical channel-scoped resource URIs and Core read projections.

## Requirements

### Requirement: Channel-scoped resource URI grammar
Core MUST recognize the canonical `asset://<id>` and `artifact://<tool-name>/<uuid-v7>` forms and a non-reserved URI only when an active trusted registration owns its scheme. Initial registrations define `skill://<name>/<relative-path>` and `workspace:///<relative-path>`. Each registered scheme MUST validate its own path grammar; Core MUST NOT derive a channel scope, host path, source URL, or authorization authority from any URI. A URI MUST NOT contain authority where its selected scheme does not define one, user information, a port, query, fragment, empty path, dot segment, invalid encoding, or a path that escapes its registered root.

#### Scenario: Core accepts a canonical asset URI
- **WHEN** a channel Runtime resolves `asset://a6e2b32e1d9d64b2e906ac5c3216d18f`
- **THEN** it MUST resolve that complete ID only through its bound channel AssetStore

#### Scenario: Core accepts an artifact URI
- **WHEN** a channel Runtime resolves `artifact://mcp_screenshot/019d3b7e-1bd0-7e4f-9c5d-5bf3fd41f1d4`
- **THEN** it MUST resolve only the canonical UUID v7 directory in the current channel's `artifacts/mcp_screenshot/` root

#### Scenario: Core rejects a traversal URI
- **WHEN** a tool supplies `workspace:///reports/%2e%2e/secret.txt`
- **THEN** Core MUST reject the URI without opening a file

### Requirement: Core-owned read tool and scheme registration
The public Core facade MUST expose `registerResourceScheme(scheme, prompt, open)` for trusted integrations. Core MUST reserve `asset` and `artifact` and reject attempts to register or replace either. Core MUST reject duplicate active scheme registrations. `open` MUST be asynchronous, receive the current ChannelScope, parsed URI, and Core-owned `{ signal, maxBytes }` limits, and return only `{ bytes, mediaType?, filename? }`; `mediaType` is a hint and `filename` is a display basename, not a path. Core MUST snapshot active registrations while creating a channel Runtime. Disposal MUST affect only Runtimes created afterward.

Core MUST provide one native `read` tool. Core MUST dispatch `asset://` and `artifact://` itself and MUST use a current Runtime's matching registered opener only for its own scheme. Core MUST build the read-tool description with fixed `asset` and `artifact` descriptions first and active registration prompts in stable scheme-name order afterward. Plugins MUST NOT replace the `read` tool or cause Core to fall back to a host path, platform URL, or an unregistered scheme.

#### Scenario: A Runtime snapshots Workspace schemes
- **WHEN** Workspace registers `skill` and `workspace` and Core creates a channel Runtime
- **THEN** that Runtime's read tool MUST include both Workspace prompts and use the registered asynchronous openers
- **AND** disposing either registration later MUST NOT change that Runtime

#### Scenario: A registration conflicts with Core
- **WHEN** a plugin attempts to register `asset`
- **THEN** Core MUST reject the registration

#### Scenario: A Workspace Skill URI is read
- **WHEN** Workspace is active
- **AND** the model calls `read` with a valid `skill://` URI
- **THEN** Core MUST return the bounded Skill content
- **AND** it MUST NOT expose an executable host path

#### Scenario: Workspace is unavailable
- **WHEN** Workspace is inactive
- **AND** the model calls `read` with a valid `skill://` or `workspace://` URI
- **THEN** Core MUST return an explicit unavailable result
- **AND** it MUST NOT read a local `file:` path

### Requirement: Core resource tool guidance
The Core `read` tool description MUST instruct the Agent to read an exact URI only when its content is needed. It MUST distinguish immutable platform `asset://`, immutable tool `artifact://`, mutable `workspace://`, and read-only `skill://`; it MUST prohibit passing a URI to Bash; it MUST state that an image is projected only after an explicit relevant read for an image-capable model; and it MUST state that reading does not create another artifact. Core MUST keep this fixed guidance separate from registered scheme prompts.

#### Scenario: A Runtime builds the read tool
- **WHEN** Core creates a channel Runtime with Workspace active
- **THEN** the read description MUST contain Core's fixed resource rules
- **AND** it MUST append the active Workspace scheme prompts without replacing those rules

### Requirement: Core read deadline
Core MUST expose top-level `resourceReadTimeoutMs` with a default of 30,000 and a minimum value of 1. Core MUST combine the current turn cancellation with that deadline and pass the resulting signal to the registered opener. On deadline expiry, Core MUST return an explicit timeout result and MUST NOT persist a partial result or create a provider media part.

#### Scenario: A resource opener exceeds the configured deadline
- **WHEN** an active scheme opener does not complete before `resourceReadTimeoutMs`
- **THEN** Core MUST return a resource-read timeout result
- **AND** it MUST not include bytes from that opener in model input or history

### Requirement: Reading preserves artifact identity
When Core reads an `artifact://` URI, it MUST open the existing artifact data and metadata directly. Core MUST NOT write a new artifact, replace the URI, or mutate the referenced artifact while producing a read result or provider media part.

#### Scenario: A model reads an artifact image
- **WHEN** a model calls `read` for an existing artifact image
- **THEN** Core MUST retain that artifact URI in the persisted read result
- **AND** it MUST NOT create another artifact directory

### Requirement: Read results are bounded logical records
Core MUST persist a `read` result as a compact logical record containing the requested URI, safe metadata, and bounded text or an explicit result category. A `read` result MUST NOT persist raw bytes, Base64 data, host paths, platform URLs, credentials, or provider-specific media parts. Core MUST limit textual resource content returned to the model to 30,000 characters.

#### Scenario: A large text resource is read
- **WHEN** a readable text resource exceeds 30,000 characters
- **THEN** Core MUST return no more than 30,000 characters of content
- **AND** it MUST identify that truncation occurred

### Requirement: Explicit image projection from read results
Core MUST create an image provider part only from a successful explicit `read` result for an image resource. Core MUST require both an image-capable model snapshot and an enabled image-input budget. Core MUST add the provider part only to the model request that follows that read result and MUST retain only the compact logical result in history.

#### Scenario: An image-capable model reads an asset
- **WHEN** an image-capable Runtime calls `read` for a fitting image asset
- **THEN** Core MUST include a temporary image part in the following model request
- **AND** it MUST NOT store Base64 image data in JSONL

#### Scenario: A text-only model reads an image
- **WHEN** a Runtime without explicit image input capability calls `read` for an image asset
- **THEN** Core MUST return safe image metadata
- **AND** it MUST NOT read image bytes for provider input
