## Why

QQ chat history import into MemOS should be simpler than the previous reviewed-batch pipeline. The source files are operator-provided trusted exports, MemOS is designed to extract memories from raw conversation history, and the old review/approval/state workflow added cost and friction without improving import quality.

## What Changes

**Standalone Trusted QQ Import Script**
- From: QQ import is tied to `plugins/memos-client/src/import` with review prompts, review results, approval state, commit state, and validation state.
- To: A package-local TypeScript script file under `plugins/memos-client/scripts` reads QQ export JSON files directly, chunks raw conversation fragments within MemOS limits, and calls MemOS `add_message` unless `--dry-run` is set.
- Reason: Keep the import path direct, auditable, and independent from the runtime plugin's Agent-visible tools.
- Impact: Old review/approval/batch-state import files and tests are removed; runtime `search_message` / `add_message` behavior remains separate.

**Trusted Raw Conversation Payloads**
- From: LLM-generated review summaries and approval records decide what is committed.
- To: Filter deterministic noise, then upload raw dialogue messages with historical `chat_time`; memory extraction is delegated to MemOS.
- Reason: MemOS recommends raw messages as the source of truth, while LLM summaries lose context and duplicate MemOS extraction.
- Impact: No review model credentials, no review prompts, and no local approval artifacts are required.

**Explicit Safety Boundary**
- From: Multiple commands decide whether a batch is pending, reviewed, approved, committed, failed, or validated.
- To: One CLI uses `--dry-run` as the local-only mode. Removing `--dry-run` performs live writes and requires `MEMOS_API_KEY`.
- Reason: A single explicit switch is easier to reason about than a state machine.
- Impact: Tests use synthetic fixtures only; the script must not embed real file paths, bot ids, group ids, group names, or contact names.

## Capabilities

### New Capabilities
- `qq-chat-memory-import`: Standalone trusted QQ export import with dry-run, directory scanning, deterministic filtering, configurable chunking, and MemOS `add_message` writes.

### Modified Capabilities
- `memos-cloud-memory`: Keep runtime import-aware retrieval safeguards and safe metadata, but historical import writes come from the standalone script rather than plugin runtime import state.

## Impact

- Affected files:
  - `plugins/memos-client/scripts/qq-memos-import.ts`
  - `plugins/memos-client/tests/qq-memos-import.test.ts`
  - `plugins/memos-client/README.md`
  - `plugins/memos-client/package.json`
  - `openspec/changes/import-qq-chat-memory-to-memos/*`
- Removed old workflow:
  - LLM review runner and prompt generation
  - review result import and schema
  - approve / approve-all batch state
  - approved-batch commit state
  - import validation state
  - old import tests and docs
- External system:
  - MemOS Cloud `POST /add/message`
