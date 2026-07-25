# channel-storage-protocol Specification

## Purpose

Define logical identity, readable Manifest-backed channel storage, namespace ownership, and the clean-break boundary.

## Requirements

### Requirement: Canonical Channel Identity Protocol
Core MUST use `channelIdentity` for the versioned shared tuple `['yesimbot.channel',1,'shared',platform,null,channelId]` and direct tuple `['yesimbot.channel',1,'direct',platform,selfId,channelId]`, encoded as the lowercase unpadded Base32 of the first 16 SHA-256 bytes.

#### Scenario: Identity conformance is checked
- **WHEN** Core identifies shared onebot `123456` or direct onebot `10000` / `123456`
- **THEN** it MUST produce `a5vnf2ijd75c2ibyo2s5czdir4` and `ymdz53gzamgvzjzrtf6vesoal4` respectively

### Requirement: Readable Channel Directory Protocol
Core MUST store shared channels as `v1-shared-<platform>-<channelId>` and direct channels as `v1-direct-<platform>-<channelId>-<selfId>` independently from logical identity.

#### Scenario: Directory components are encoded
- **WHEN** a scope component contains bytes outside ASCII letters, digits, or `_`
- **THEN** Core MUST replace each Unicode code point with `_`, preserve allowed bytes and repeated `_`, and reject a complete basename longer than 200 characters

### Requirement: Authoritative Channel Manifest
Each valid `channel.json` MUST contain format, identity, and directory versions; `identity`; `directoryName`; direct classification; scope coordinates; and optional name. Core MUST validate its identity, directory name, parent basename, and direct/selfId invariants.

#### Scenario: Existing directory conflicts
- **WHEN** a readable directory contains a mismatched or unsupported Manifest
- **THEN** Core MUST reject access and MUST NOT merge, overwrite, rename, delete, or allocate an alternate directory

### Requirement: Manifest Scan Without Catalog
Core MUST atomically create a complete Manifest in a sibling temporary directory before rename, MUST scan valid Manifests into an in-memory identity index at startup, and MUST NOT create, rebuild, read, or write `channels.json`.

#### Scenario: Old layout is found
- **WHEN** startup finds an old hash directory, Manifest, or Catalog
- **THEN** Core MUST preserve it without reading, migrating, deleting, or using it as fallback

### Requirement: Storage Namespace Registry
Core MUST require unique registered namespaces and MUST resolve `ensureStorage` only beneath a validated namespace root in the Manifest-backed channel directory.

#### Scenario: Namespace path is resolved
- **WHEN** a caller supplies a valid scope, registered namespace, and safe relative segments
- **THEN** Core MUST return a path beneath that namespace root and MUST not create the caller's final file

### Requirement: Channel Data Lifecycle
Core MUST clear only sessions and assets on reset and MUST preserve the Manifest, workspace, and other registered namespaces.

#### Scenario: A channel is reset
- **WHEN** Core resets a channel
- **THEN** it MUST remove JSONL and scoped assets without deleting its Manifest or module namespaces
