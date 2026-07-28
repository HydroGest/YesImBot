# model-input-media-budgeting Specification

## Purpose
TBD - created by archiving change harden-agent-input-pipeline. Update Purpose after archive.
## Requirements
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
### Requirement: Single-Model Input Modality Command
Core MUST provide the authority-4 command `yesimbot.model.add-input-modality <model> <modality>`. The command MUST accept a registered full model ID or alias, validate the modality against `CHAT_MODEL_MODALITIES`, idempotently add it to only that model's `models.json` input modalities through an atomic write, and refresh ModelService after a successful write. It MUST NOT edit provider configuration or automatically replace active ChannelRuntimes.

#### Scenario: Modality is added
- **WHEN** an authorized operator adds `image` to a registered model without that input modality
- **THEN** Core MUST persist `image` once under that model's chat override
- **AND** a subsequent model resolution MUST expose the new input modality

#### Scenario: Modality already exists
- **WHEN** an authorized operator adds an input modality already present for the model
- **THEN** the command MUST report an idempotent no-op
- **AND** it MUST NOT duplicate or rewrite unrelated model configuration

#### Scenario: Model or modality is invalid
- **WHEN** the model cannot be resolved or the modality is not in `CHAT_MODEL_MODALITIES`
- **THEN** the command MUST return a recognizable error without modifying `models.json`

#### Scenario: Runtime is already active
- **WHEN** the command refreshes ModelService while a ChannelRuntime using that model already exists
- **THEN** the active runtime MUST keep its immutable capability snapshot until explicit reload or replacement

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
### Requirement: Deterministic Image Selection Strategies
Core MUST discover frozen image references by walking persisted Message `elements` in document order, and MUST order candidates across inputs by the configured selection strategy. Core MUST NOT recover references by parsing a rendered text projection, and selection MUST remain deterministic for identical persisted input.

#### Scenario: Candidates are discovered
- **WHEN** Core builds the candidate sequence for a turn
- **THEN** it MUST read references from persisted `elements`
- **AND** references within one input MUST follow element document order

#### Scenario: Same history is projected twice
- **WHEN** the same persisted history is projected on two turns with identical configuration
- **THEN** the selected candidate sequence MUST be identical

#### Scenario: Nested elements carry a reference
- **WHEN** a frozen image reference appears inside a nested element
- **THEN** Core MUST discover it by walking element children

### Requirement: Per-Reference Budget Accounting
Every frozen image reference MUST be an independent budget candidate. Duplicate asset IDs MUST consume count and byte budgets once per reference and MUST NOT be deduplicated. A rejected candidate MUST NOT prevent a later candidate from being selected when the later candidate fits the remaining budget.

#### Scenario: One asset is referenced twice
- **WHEN** the same asset ID appears twice in the candidate sequence and both occurrences fit
- **THEN** Core MUST select two file parts and charge both occurrences

#### Scenario: Earlier candidate does not fit
- **WHEN** an earlier candidate exceeds the per-image or remaining total-byte budget and a later candidate fits
- **THEN** Core MUST skip the earlier candidate and select the later candidate

### Requirement: Media Failure Preserves Text
Unsupported MIME, missing assets, read failures, disabled capability, and budget rejection MUST omit only the generated file part. Core MUST preserve the complete base text and original content elements, MUST emit a relevant diagnostic for asset failures, and MUST NOT retry a remote platform resource or retry the model call automatically as text-only.

#### Scenario: One selected asset is missing
- **WHEN** local AssetStore cannot read one candidate
- **THEN** Core MUST retain the owning message's unchanged text
- **AND** it MUST continue considering later candidates without a platform API call

