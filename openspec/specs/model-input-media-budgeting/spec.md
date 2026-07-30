# model-input-media-budgeting Specification

## Purpose

Define Runtime-owned projection of persisted message and event Inputs into model messages, including image capability, byte-backed AssetStore attachment selection, and model-call image budgets.

## Requirements

### Requirement: Explicit Model Image Capability

Core MUST append image files only when the resolved chat model's `models.json` override explicitly includes `image` in `modalities.input`. Missing modality metadata and provider registration alone MUST be treated as unsupported. The authority-4 `yesimbot.model.add-input-modality <model> <modality>` command MUST persist an idempotent, validated modality addition and refresh ModelService without replacing active Runtimes.

#### Scenario: Image capability is absent
- **WHEN** the resolved model has no explicit `image` input modality
- **THEN** Runtime MUST project unchanged text without reading AssetStore bytes

#### Scenario: Active Runtime predates a modality addition
- **WHEN** an operator adds `image` after a Runtime was created
- **THEN** that Runtime MUST retain its capability snapshot until replacement

### Requirement: Image Input Budget

Core MUST expose top-level `imageInput` as `false` or an object with optional `maxCount`, `maxBytesPerImage`, and `maxTotalBytes`. `false` MUST disable image projection. When enabled or omitted for an image-capable model, Runtime MUST use defaults of 4 images, 5 MiB per image, and 10 MiB total per model-message context.

#### Scenario: Image input is disabled
- **WHEN** `imageInput` is false
- **THEN** Runtime MUST not read or append image files

#### Scenario: A fresh model call is prepared
- **WHEN** Agent prepares a distinct ModelMessageContext
- **THEN** Runtime MUST allocate a fresh count and byte budget

### Requirement: Deterministic Image Projection

Runtime MUST scan Input candidates in FIFO `history` followed by `current` order. It MUST recursively discover `img.id` references in Element document order, read bytes only through the bound channel AssetStore, and append selected AI SDK FileParts to the owning Input without mutating source messages. JPEG, PNG, GIF, and WebP byte signatures are supported.

#### Scenario: Nested image references are projected
- **WHEN** an image is nested in persisted Elements
- **THEN** Runtime MUST discover it in document order

#### Scenario: Repeated asset references fit the budget
- **WHEN** one AssetStore ID occurs multiple times
- **THEN** Runtime MUST append and charge each reference independently

### Requirement: Image Failure Preserves Text

Runtime MUST omit only a generated file part when an AssetStore read fails, bytes have an unsupported MIME, or a candidate exceeds a budget. It MUST retain the complete text projection, continue considering later fitting candidates, and record diagnostics for read and MIME failures. Runtime MUST NOT retry a platform resource or retry the model call.

#### Scenario: One asset cannot be read
- **WHEN** AssetStore fails to read one candidate
- **THEN** Runtime MUST preserve its text and continue with later candidates

