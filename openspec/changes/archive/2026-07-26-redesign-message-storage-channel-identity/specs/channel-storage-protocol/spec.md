## ADDED Requirements

### Requirement: Readable Manifest-Backed Channel Storage
Core MUST store shared channels as `v1-shared-<platform>-<channelId>` and direct channels as `v1-direct-<platform>-<channelId>-<selfId>`, with `channel.json` as the authority.

#### Scenario: Channel storage is initialized
- **WHEN** Core creates storage for a scope
- **THEN** it MUST atomically commit a Manifest containing identity, directory name, versions, scope coordinates, and nullable shared `selfId`

### Requirement: Directory Encoding And Integrity
Core MUST preserve ASCII letters, digits, and `_` in directory components; replace every other Unicode code point with `_`; reject basenames longer than 200 characters; and reject identity or directory mismatches.

#### Scenario: Existing directory conflicts
- **WHEN** a readable directory contains a mismatched Manifest
- **THEN** Core MUST reject access and MUST NOT merge, overwrite, rename, delete, or allocate an alternate directory

### Requirement: Manifest Scan Without Catalog
Core MUST scan valid Manifests into memory at startup and MUST NOT create, rebuild, or read `channels.json`.

#### Scenario: Old layout is found
- **WHEN** startup finds an old hash directory, old Manifest, or Catalog
- **THEN** Core MUST preserve it without reading, migrating, or deleting it
