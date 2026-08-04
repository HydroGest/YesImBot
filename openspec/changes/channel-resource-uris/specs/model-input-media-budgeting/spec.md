# model-input-media-budgeting Specification

## MODIFIED Requirements

### Requirement: Explicit Model Image Capability
Core MUST append image files only from successful Core `read` results when the resolved chat model's `models.json` override explicitly includes `image` in `modalities.input`. Missing modality metadata and provider registration alone MUST be treated as unsupported. The authority-4 `yesimbot.model.add-input-modality <model> <modality>` command MUST persist an idempotent, validated modality addition and refresh ModelService without replacing active Runtimes.

#### Scenario: Image capability is absent
- **WHEN** the resolved model has no explicit `image` input modality
- **AND** the model reads an image URI
- **THEN** Runtime MUST return unchanged textual metadata without reading asset, artifact, or workspace bytes for provider input

#### Scenario: Active Runtime predates a modality addition
- **WHEN** an operator adds `image` after a Runtime was created
- **THEN** that Runtime MUST retain its capability snapshot until replacement

### Requirement: Image Input Budget
Core MUST expose top-level `imageInput` as `false` or an object with optional `maxCount`, `maxBytesPerImage`, and `maxTotalBytes`. `false` MUST disable image projection. When enabled or omitted for an image-capable model, Runtime MUST use defaults of 4 images, 5 MiB per image, and 10 MiB total per model-message context. Runtime MUST allocate that budget only while preparing image parts from explicit read results.

#### Scenario: Image input is disabled
- **WHEN** `imageInput` is false
- **AND** the model reads an image URI
- **THEN** Runtime MUST not read or append image files for provider input

#### Scenario: A fresh read-result model step is prepared
- **WHEN** Agent prepares the model step after a distinct successful image read
- **THEN** Runtime MUST allocate a fresh count and byte budget

### Requirement: Image failure preserves read text
Runtime MUST omit only a generated image part when an explicit read cannot open bytes, has an unsupported MIME, or exceeds a budget. It MUST retain the compact read result, continue the turn, and record diagnostics for read and MIME failures. Runtime MUST NOT retry a platform resource or retry the model call.

#### Scenario: A read image cannot be opened
- **WHEN** Runtime cannot open one explicit image read for provider projection
- **THEN** Runtime MUST preserve the read result text
- **AND** it MUST continue the turn without an image part

## REMOVED Requirements

### Requirement: Deterministic Image Projection
**Reason:** Runtime no longer scans message history or current input for image IDs. Models explicitly request resource consumption through the Core `read` tool.

**Migration:** Existing `<img id>` history remains readable as text and can be consumed later through its canonical `asset://` reference. No JSONL rewrite, fallback reader, or automatic attachment remains.
