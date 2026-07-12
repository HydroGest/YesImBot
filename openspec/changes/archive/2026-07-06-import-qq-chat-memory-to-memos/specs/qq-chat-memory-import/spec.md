## ADDED Requirements

### Requirement: Standalone Trusted Import CLI

The QQ chat memory import MUST be implemented as a standalone TypeScript script file under `plugins/memos-client/scripts` and MUST NOT depend on the old `plugins/memos-client/src/import` review/approval runtime.

#### Scenario: Required operator input
- **WHEN** the operator runs the import script
- **THEN** the CLI MUST require `--input <file-or-dir>`
- **AND** it MUST require `--bot-self-id <id>`
- **AND** it MUST NOT provide a default export path, default bot id, default group id, or default contact id

#### Scenario: Dry-run mode
- **WHEN** the operator passes `--dry-run`
- **THEN** the script MUST parse, filter, de-duplicate, chunk, and print sanitized statistics
- **AND** it MUST NOT call MemOS Cloud
- **AND** it MUST NOT require `MEMOS_API_KEY`

#### Scenario: Live import mode
- **WHEN** the operator omits `--dry-run`
- **THEN** the script MUST require `MEMOS_API_KEY`
- **AND** it MUST call MemOS `POST /add/message` for each planned chunk
- **AND** it MUST read the base URL from `--base-url`, then `MEMOS_BASE_URL`, then the documented MemOS Cloud default

#### Scenario: Sanitized debug output
- **WHEN** the operator passes `--debug`
- **THEN** debug logs MUST include only sanitized stage summaries and counts
- **AND** they MUST NOT include API keys, Authorization headers, full request bodies, or embedded real input defaults

### Requirement: Input Discovery and Parsing

The script MUST read supported QQ exporter JSON files from explicit operator input.

#### Scenario: Single file input
- **WHEN** `--input` points to a JSON file
- **THEN** the script MUST process only that file

#### Scenario: Directory input
- **WHEN** `--input` points to a directory
- **THEN** the script MUST scan only direct child files ending in `.json`
- **AND** it MUST NOT recurse into subdirectories
- **AND** it MUST process files in deterministic sorted order

#### Scenario: Supported export shape
- **WHEN** a JSON file contains `chatInfo`, `statistics`, `messages`, and `exportOptions`
- **THEN** the script MUST extract conversation type, channel id, message id, timestamp, sender id, sender display name, text, system flag, recalled flag, element types, and resources

#### Scenario: Channel id inference
- **WHEN** the conversation is a group chat
- **THEN** the script SHOULD infer the channel id from the file name suffix in parentheses, falling back to supported `chatInfo` channel fields
- **WHEN** the conversation is a private chat
- **THEN** the script SHOULD infer the channel id from the first non-bot sender id, falling back to supported `chatInfo` channel fields

### Requirement: Deterministic Filtering and De-duplication

The script MUST remove deterministic low-value input before chunking.

#### Scenario: Filter noisy messages
- **WHEN** a message is a QQ system message, empty text, recalled without text, or media/resource-only noise
- **THEN** it MUST be excluded from the MemOS payload

#### Scenario: Preserve text-bearing messages
- **WHEN** a message has meaningful text, even with additional non-text elements
- **THEN** it SHOULD remain eligible for import

#### Scenario: De-duplicate messages
- **WHEN** multiple files contain duplicate messages
- **THEN** the script MUST de-duplicate by conversation plus QQ message id first
- **AND** it MUST fall back to conversation plus timestamp, sender id, and normalized text hash

### Requirement: Chunking Within MemOS Limits

The script MUST split input into chunks that stay below configurable limits.

#### Scenario: Default chunk limits
- **WHEN** the operator does not pass chunk flags
- **THEN** the script MUST default to `--max-tokens 16000`
- **AND** it MUST default to `--max-messages 400`
- **AND** it MUST default to `--max-hours 168`
- **AND** it MUST default to `--overlap-messages 0`

#### Scenario: Mixed chunk boundaries
- **WHEN** adding a message would exceed token, message count, or time range limits
- **THEN** the script MUST start a new chunk

#### Scenario: Configurable overlap
- **WHEN** `--overlap-messages <n>` is greater than zero
- **THEN** the next chunk SHOULD include the previous chunk's last `n` messages for context
- **AND** `n` MUST be smaller than `--max-messages`

### Requirement: MemOS Add Message Payload

The script MUST write raw dialogue chunks using MemOS `messages` list format.

#### Scenario: System source context
- **WHEN** a chunk request is built
- **THEN** the first message MUST have `role: "system"`
- **AND** its content MUST include the platform identifier, channel id, and chunk time range
- **AND** it MUST include `chat_time` set to the chunk start time

#### Scenario: Role mapping
- **WHEN** a QQ message sender id equals `--bot-self-id`
- **THEN** the MemOS message role MUST be `assistant`
- **WHEN** a QQ message sender id differs from `--bot-self-id`
- **THEN** the MemOS message role MUST be `user`

#### Scenario: Ordinary message content
- **WHEN** a QQ message is converted
- **THEN** its content MUST use `${userName}(${userId}): ${content}`
- **AND** it MUST include historical `chat_time`

#### Scenario: Request metadata
- **WHEN** a chunk is imported
- **THEN** the request MUST include shared MemOS identity fields `user_id`, `conversation_id`, and `agent_id`
- **AND** it MUST include `tags`, `info.import_source = "qq_chat"`, `source = "yesimbot.qq_import"`, and configured `async_mode`

#### Scenario: Subject id excludes bot identity
- **WHEN** a chunk request is built
- **THEN** `user_id` MUST identify the chat subject using platform, channel type, and subject raw id
- **AND** group imports MUST use the group id as the subject raw id
- **AND** private imports MUST use the contact user id as the subject raw id
- **AND** `user_id` MUST NOT include `--bot-self-id`

#### Scenario: Chunk conversation id
- **WHEN** a chunk request is built
- **THEN** `conversation_id` MUST identify that chunk, not the whole channel
- **AND** it MUST be deterministic from import source, platform, channel type, subject raw id, chunk start time, chunk end time, first message id, last message id, and chunk index
- **AND** different chunks from the same chat subject SHOULD have different `conversation_id` values

#### Scenario: Import agent id
- **WHEN** a chunk request is built
- **THEN** `agent_id` MUST identify the importing bot/agent using platform and `--bot-self-id`

#### Scenario: Import identity helper reuse
- **WHEN** the script derives MemOS ids
- **THEN** it MUST use the same shared identity helper as `plugins/memos-client` runtime tools
- **AND** it MUST NOT keep a local copy of channel hashing or MemOS id algorithms

### Requirement: Old Workflow Removal

The old reviewed-batch workflow MUST be removed from source, tests, and docs.

#### Scenario: Review workflow removed
- **WHEN** the repository is searched for QQ import workflow commands
- **THEN** it MUST NOT expose `review-run`, `review-prompts`, `import-review`, `approve`, `approve --all`, or commit-approved-batches as the current QQ import path
- **AND** old review prompt/result/state-machine files SHOULD be deleted rather than left unused

#### Scenario: Synthetic tests only
- **WHEN** import tests define fixtures
- **THEN** they MUST use synthetic ids, names, and paths
- **AND** they MUST NOT embed real operator export paths, bot ids, group ids, group names, or contact names
