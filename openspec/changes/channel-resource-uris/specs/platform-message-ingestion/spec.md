# platform-message-ingestion Specification

## MODIFIED Requirements

### Requirement: OneBot Resolver Image Persistence
The OneBot Resolver MUST recursively persist `img` elements that it can load. For each successful persistence, it MUST write bytes through the supplied Store, receive a complete 32-character lowercase hexadecimal asset ID, and return `h("img", { id })`. A successful persisted image MUST contain no source URL, path, or data URI. The Resolver MAY apply platform-specific download limits; Core MUST NOT impose an inbound image-download policy.

#### Scenario: OneBot persists an image
- **WHEN** a OneBot message contains an image whose bytes the Resolver successfully persists
- **THEN** the OneBot Resolver MUST write its bytes through the supplied Store
- **AND** the returned Draft MUST contain an `img` with its complete persisted ID

#### Scenario: OneBot preserves an image that cannot persist
- **WHEN** one OneBot image load or Store write fails
- **THEN** the OneBot Resolver MUST preserve that original image element
- **AND** it MUST continue processing sibling elements
