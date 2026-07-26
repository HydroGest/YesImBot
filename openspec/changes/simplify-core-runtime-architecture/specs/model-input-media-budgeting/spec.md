## MODIFIED Requirements

### Requirement: Explicit Model Media Enablement
Core MUST embed an image only when the global multimedia switch is enabled and the model's `models.json` chat override explicitly includes `image` in `modalities.input`. Missing input-modality metadata MUST be treated as unsupported. Built-in provider plugins MUST remain modality-agnostic and MUST NOT supply image capability for this gate. `multimedia.enabled` MUST gate only model projection and MUST NOT disable ingress image freezing or durable image persistence.

#### Scenario: Global multimedia is disabled
- **WHEN** a resolved model declares image input but `multimedia.enabled` is false
- **THEN** Core MUST project unchanged text without reading or appending image files
- **AND** Gateway MUST continue to freeze eligible ingress images under the configured numeric image budget

#### Scenario: Model capability is missing
- **WHEN** multimedia is globally enabled but the resolved model does not explicitly declare image input
- **THEN** Core MUST project unchanged text without image files

#### Scenario: Model override declares image input
- **WHEN** `models.json` explicitly includes `image` in one chat model's input modalities
- **THEN** newly created or reloaded ChannelRuntimes using that model MAY embed images under the global switch and unified numeric image budget

#### Scenario: Provider plugin registers a model
- **WHEN** a built-in provider registers a chat model without a matching modalities override in `models.json`
- **THEN** Core MUST treat that model as not supporting image input

### Requirement: Unified Image Budget
Core MUST expose one unified numeric image budget with `maxCount`, `maxBytesPerImage`, and `maxTotalBytes`. A separate Gateway freeze budget or call-scoped image-limit contract MUST NOT exist. The same values MUST limit image freezing for one admitted message, AssetStore acceptance, and selection for every model request. Image download timeout MUST remain 10 seconds and download concurrency MUST remain 2 as ingress execution controls, not configurable image-budget fields.

#### Scenario: One admitted message reaches its image count or total-byte limit
- **WHEN** Gateway freezes eligible images for one admitted message
- **AND** accepting another image would exceed `maxCount` or `maxTotalBytes`
- **THEN** Gateway MUST replace that image with the permanent unavailable form
- **AND** it MUST NOT exceed the unified budget while freezing that message

#### Scenario: AssetStore receives an oversized image
- **WHEN** Gateway attempts to store image bytes larger than `maxBytesPerImage`
- **THEN** AssetStore MUST reject those bytes
- **AND** resolution MUST retain the permanent unavailable form without retrying the remote resource

#### Scenario: Call reaches image count limit
- **WHEN** `maxCount` eligible references have been selected for one model request
- **THEN** Core MUST append no additional image file for that request

#### Scenario: One image exceeds its byte limit
- **WHEN** a candidate's original bytes exceed `maxBytesPerImage`
- **THEN** Core MUST skip that candidate and continue considering later candidates

#### Scenario: Tool loop prepares another request
- **WHEN** AI SDK prepares a later model step in the same Agent turn
- **THEN** Core MUST create a fresh `maxCount` and `maxTotalBytes` selection budget
- **AND** it MUST reapply the configured deterministic selection strategy

## RENAMED Requirements

- FROM: `### Requirement: Independent Model-Call Image Budget`
- TO: `### Requirement: Unified Image Budget`
