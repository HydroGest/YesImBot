# workspace-sandbox-tools Specification

## ADDED Requirements

### Requirement: Workspace URI export boundary and registration
Workspace MUST register `workspace` through Core `registerResourceScheme()` with a prompt that distinguishes external `workspace:///relative/path` consumption from internal `/home/workspace/...` sandbox paths. Its asynchronous opener MUST resolve `workspace:///<relative-path>` only against the current channel root's default `workspace/` child. It MUST treat the URI as a live mutable reference and MUST NOT expose `/skills`, configured read-only mounts, overlays, system paths, or arbitrary host paths through that scheme.

#### Scenario: Core reads a workspace product
- **WHEN** Core resolves `workspace:///exports/report.csv` for a channel Runtime
- **THEN** Workspace MUST open the current `workspace/exports/report.csv` content for that channel

#### Scenario: URI targets an operator mount
- **WHEN** Core resolves a workspace URI that normalizes outside the default `workspace/` root
- **THEN** Workspace MUST reject the request without opening a configured mount

### Requirement: Workspace integrates the Skill catalog
Workspace MUST expose `skillPaths` configuration, discover and validate Skills, and mount each accepted Skill root read-only at `/skills/<skill-name>/`. Workspace MUST own the associated Skill URI resolver and prompt. It MUST NOT depend on an independent Skills plugin or expose a compatibility Skills plugin surface.

#### Scenario: Workspace starts with configured Skills
- **WHEN** Workspace starts with one or more valid Skill paths
- **THEN** it MUST make the discovered Skill catalog available for `skill://` reads and `/skills/<name>/` virtual mounts

#### Scenario: Workspace starts without Skills
- **WHEN** Workspace starts with no configured Skill paths
- **THEN** it MUST provide its ordinary workspace tools
- **AND** it MUST not expose a Skill catalog or loader tool

### Requirement: Workspace prompt distinguishes internal paths from external URIs
The Workspace system prompt MUST direct `readFile`, `writeFile`, and `bash` to virtual POSIX paths such as `/home/workspace/...` and active `/skills/...` mounts. It MUST describe `workspace:///relative/path` as a live external-consumption reference for Core read, analysis integrations, and outbound `img` or `file` sources. It MUST state that Bash does not consume `workspace://` URIs.

#### Scenario: The Agent needs to inspect a workspace image
- **WHEN** a Workspace image must be examined by an image-capable model
- **THEN** the Workspace prompt MUST direct the Agent to call Core `read` with its `workspace://` URI
- **AND** it MUST NOT direct Bash to consume that URI

### Requirement: Workspace paths and URIs have distinct roles
Workspace MUST keep `readFile`, `writeFile`, and `bash` on virtual POSIX paths. It MUST use `workspace://` only as an external-consumption reference for Core readers, analysis integrations, and outbound delivery. A caller that needs an immutable snapshot of a workspace file MUST materialize it through its artifact writer before publishing an `artifact://` reference.

#### Scenario: Bash reads a workspace file
- **WHEN** a model uses Bash to process `/home/workspace/chart.png`
- **THEN** Workspace MUST use its virtual filesystem path semantics
- **AND** it MUST NOT require Bash to parse `workspace://`

#### Scenario: A later write changes a workspace URI
- **WHEN** Bash replaces `workspace/output.txt` after `workspace:///output.txt` was produced
- **THEN** a later URI resolution MUST read the replacement content
