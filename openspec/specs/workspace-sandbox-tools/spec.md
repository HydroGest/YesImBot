# workspace-sandbox-tools Specification

## Purpose
Define Workspace sandbox tools, channel-scoped isolation, virtual filesystem mounts, and operator documentation.

## Requirements

### Requirement: Channel-Scoped Workspace Isolation
Workspace MUST obtain the stable channel root through `ctx.yesimbot.resource.get(scope)` and use `ChannelResources.path` with its `workspace/` child as the writable root. Its in-memory cache MUST use shared `[platform, channelId]` and direct `[platform, selfId, channelId]` semantics.

#### Scenario: Workspace is resolved
- **WHEN** a runtime or resource reader requests the Workspace
- **THEN** the plugin MUST create or reuse `workspace/` below `ChannelResources.path`
- **AND** it MUST NOT construct the channel directory protocol

#### Scenario: Shared Bot replacement
- **WHEN** a shared runtime is recreated for a different current Bot
- **THEN** Workspace MUST reuse the same channel root and workspace files

### Requirement: Named Resource Reader
Workspace MUST register a named ResourceReader through `ctx.yesimbot.resource.use(reader)`. The reader MUST implement `init(resources, uri, options)` and MUST enforce the configured virtual filesystem boundary before returning data.

#### Scenario: Workspace URI is opened
- **WHEN** Core invokes the Workspace reader for a workspace URI
- **THEN** the reader MUST resolve it below the channel workspace root
- **AND** it MUST return a bounded ResourceOpenResult or a structured read failure

### Requirement: Bash Tool Backed Default Tool Set
Workspace SHALL expose the `bash-tool`-backed `bash`, `readFile`, and `writeFile` tools as its default Sandbox tool set. Sandbox mode SHALL remain the default mode, and Workspace SHALL NOT expose a dedicated Git or `host-exec` tool.

#### Scenario: Default tools are registered
- **WHEN** the Workspace Agent plugin initializes in Sandbox mode
- **THEN** its tool set SHALL include exactly `bash`, `readFile`, and `writeFile` as the Workspace tools

#### Scenario: Git exposure is absent
- **WHEN** the Workspace Sandbox tool set is assembled
- **THEN** it SHALL not include a `git` tool, `host-exec`, or a separate host command schema

#### Scenario: Host reuses the same shell
- **WHEN** an allowed Host Runtime initializes
- **THEN** it SHALL use the same three bash-tool contracts rather than adding a second tool set
### Requirement: Virtual Filesystem Boundary
Workspace Sandbox tools MUST operate through the configured `just-bash` virtual filesystem and MUST NOT directly access unmounted host paths. Host mode is a separate backend and is not governed by this Sandbox boundary.

#### Scenario: A mounted path is written
- **WHEN** an agent writes through Sandbox `writeFile`
- **THEN** the virtual filesystem SHALL apply the configured writable, read-only, or overlay mount policy

#### Scenario: An unmounted host path is requested
- **WHEN** a Sandbox command or file tool attempts to access a host path that is not represented by a declared or implicit virtual mount
- **THEN** the virtual filesystem SHALL deny the access
### Requirement: Workspace Documentation
Workspace documentation SHALL describe Core-resolved readable storage, default tools, mount safety, and channel isolation without claiming that the plugin derives directory names or owns a Core storage facade.

#### Scenario: Operator reads isolation documentation
- **WHEN** an operator reads Workspace documentation
- **THEN** it MUST identify `resource.get(scope)` and `ChannelResources.path` as the channel-root boundary


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

### Requirement: Single normalized Sandbox mount declarations
Sandbox SHALL accept one mount declaration list with `source`, `target`, and `mode` values of `rw`, `ro`, or `overlay`.

#### Scenario: Mounts are normalized
- **WHEN** the plugin starts
- **THEN** relative sources SHALL resolve against `ctx.baseDir`, existing sources SHALL be canonicalized, and writable missing directories SHALL be created

#### Scenario: Mount targets conflict
- **WHEN** mount targets duplicate, are `/`, overlap the reserved `/home/workspace`, or form a parent/child nesting
- **THEN** configuration SHALL be rejected without applying an override or precedence rule

### Requirement: Sandbox Git rollback
Sandbox SHALL not register or initialize the unapproved Git tool or Host temporary-mount bridge.

#### Scenario: Plugin starts after rollback
- **WHEN** Workspace starts in Sandbox mode
- **THEN** no Git tool, `enableGit` registration, `host-exec`, `hostTmpRoot`, or Git temporary mount SHALL be created