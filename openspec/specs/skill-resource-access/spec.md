# skill-resource-access Specification

## Purpose
TBD: Workspace-owned Skill discovery, reading, and execution mounts.

## Requirements

### Requirement: Workspace-owned Skill catalog and URI containment
The Workspace integration MUST accept configured Skill paths, discover the Skill catalog, and register `skill` through Core `registerResourceScheme()` with a prompt that describes `skill://<skill-name>/<relative-path>` reading and `/skills/<skill-name>/` execution paths. Its asynchronous opener MUST resolve a Skill URI only when `<skill-name>` identifies a Workspace catalog entry and the normalized relative path remains below that Skill's validated root. It MUST return bounded readable content without exposing the root's host path.

#### Scenario: A Workspace Skill reference is read
- **WHEN** Core reads `skill://csv/scripts/analyze.sh`
- **AND** Workspace has a `csv` Skill with that file below its root
- **THEN** Workspace MUST return that file as the Skill URI content

#### Scenario: A Skill URI escapes its root
- **WHEN** Core reads `skill://csv/../private.txt`
- **THEN** Workspace MUST reject the request without opening a file

### Requirement: Workspace Skill prompt uses Core read without a loader tool
Workspace MUST list each model-visible Skill with `skill://<skill-name>/SKILL.md` in its system prompt. The prompt MUST instruct the Agent to use Core `read` for a matching Skill's instructions and auxiliary files, and to use `/skills/<skill-name>/...` only for Workspace Bash execution. It MUST NOT expose a Skill host path. Workspace MUST NOT register a `load_skill` Agent tool.

#### Scenario: A matching Skill is selected
- **WHEN** the Agent selects a visible Skill from the Workspace prompt
- **THEN** it MUST be able to call Core `read` for that Skill's `SKILL.md`
- **AND** no `load_skill` tool MUST be available

### Requirement: Workspace mounts catalog Skills read-only
Workspace MUST make each catalog Skill root available to its own Bash and file tools as a read-only mount at `/skills/<skill-name>/`. Those tools MAY consume virtual mount paths, but they MUST NOT execute `skill://` strings as filesystem paths.

#### Scenario: Workspace runs a Skill script through its mount
- **WHEN** the model runs a supported command against `/skills/csv/scripts/analyze.sh`
- **THEN** Workspace MUST read the script through a read-only mount

#### Scenario: Workspace is disabled
- **WHEN** Workspace is inactive
- **THEN** no `skill://` handler or Skill prompt MUST be available
- **AND** no compatibility Skills plugin or loader tool MUST be registered
