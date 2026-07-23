# koishi-plugin-yesimbot-memos-client

MemOS Cloud long-term memory plugin for yesimbot. It adds `search_message` and `add_message` so the agent can retrieve relevant memory before answering and selectively write durable memory after replying.

## Required config

- `apiKey`: MemOS Cloud API key. Keep it server-side only and never print the raw key.
- `baseUrl`: optional, defaults to `https://memos.memtensor.cn/api/openmem/v1`.

## Main options

- `memoryScope`: default `"auto"`, which resolves to `group -> channel` and `private -> user`. You can force `"channel"` or `"user"` when needed.
- `searchMemoryLimit`, `searchPreferenceLimit`, `searchRelativity`, `includePreference`
- `asyncMode`: defaults to `true`. Async writes may take a few seconds to become searchable.
- `tags`
- `includeRawIdentityInfo`: defaults to `false`, so raw platform ids are not sent to MemOS unless you opt in explicitly.
- `enableDebugTools`: defaults to `false`. When enabled, registers development-only debug tools.

## Channel identity

The plugin uses the Core Channel Key as the MemOS `channel_hash` metadata
field. The Core Key is a 26-character lowercase Base32 string derived from
deterministic canonical tuples:

- Shared channels: `platform + channelId` — the Key and `channel_hash` remain
  stable when Koishi changes the bot assignee.
- Direct channels: `platform + selfId + channelId` — the Key and
  `channel_hash` change when the bot identity differs, providing bot-level
  isolation.

MemOS `user_id`, `conversation_id`, and `agent_id` remain plugin-owned
identities derived through the plugin's `deriveMemosIdentity` helper. The
Core Channel Key does not replace those field semantics.

## Development Debug Tools

When `enableDebugTools` is `true`, the plugin also registers `debug_search_channel_memory`. It accepts `query`, `channelId`, and optional `channelType` so developers can search another channel's MemOS subject without exposing raw `user_id`, `conversation_id`, filters, credentials, or MemOS request parameters to the model.

Keep this option disabled outside development or controlled debugging sessions.

## Local verification without API key

You can verify request construction, schema shape, identity hashing, prompt policy, and sanitized error handling without a live MemOS key:

```bash
yarn workspace koishi-plugin-yesimbot-memos-client exec vitest run \
  tests/tools.test.ts tests/plugin.test.ts tests/identity.test.ts tests/client.test.ts
yarn turbo run check-types --filter=koishi-plugin-yesimbot-memos-client
```

## QQ History Import

QQ history import is an operator-controlled standalone script, not an Agent-visible runtime tool. It imports trusted QQ exporter JSON directly into MemOS as raw conversation chunks; MemOS performs memory extraction in the background.

Use `--dry-run` first. Dry-run parses, filters, de-duplicates, chunks, and prints sanitized statistics without calling MemOS or requiring `MEMOS_API_KEY`:

```bash
npx tsx plugins/memos-client/scripts/qq-memos-import.ts \
  --input ./exports \
  --bot-self-id <bot-self-id> \
  --dry-run \
  --debug
```

Live import is the same command without `--dry-run`. It requires `MEMOS_API_KEY`; `MEMOS_BASE_URL` or `--base-url` may override the default MemOS Cloud URL:

```bash
MEMOS_API_KEY=<server-side-key> npx tsx plugins/memos-client/scripts/qq-memos-import.ts \
  --input ./exports \
  --bot-self-id <bot-self-id>
```

Supported flags:

- `--input <file-or-dir>`: required. A directory scans only direct child `*.json` files.
- `--bot-self-id <id>`: required. Used to map self messages to role `assistant`.
- `--dry-run`: local-only planning mode; never calls MemOS.
- `--debug`: prints sanitized counts and stage summaries only.
- `--max-tokens <n>`: default `16000` estimated tokens per chunk.
- `--max-messages <n>`: default `400` imported messages per chunk.
- `--max-hours <n>`: default `168` hours per chunk.
- `--overlap-messages <n>`: default `0`; must be smaller than `--max-messages`.
- `--async-mode true|false`: default `true`, passed through to MemOS.
- `--base-url <url>`: overrides `MEMOS_BASE_URL`.

The script does not embed real export paths, bot ids, group ids, group names, or contact names. Debug logs must not print API keys, Authorization headers, or full request bodies.

## Optional live MemOS verification

Only do this when `MEMOS_API_KEY` is configured and starts with `mpg-`. Do not echo the raw key in logs or terminal captures.

Suggested smoke-test flow:

1. Export `MEMOS_API_KEY` in your shell.
2. Write one durable fact with `/add/message`.
3. Wait a few seconds because async mode is enabled by default.
4. Search with `/search/memory` and confirm the fact can be recalled.

This live check is optional; local tests do not require network access or a key.

## Current gaps

- Current tool execution still relies on capturing `athena.platform.message` during message conversion to recover author/message source context for MemOS metadata.
- Full-turn internal memory ingestion is still future work; v1 only exposes the narrow LLM-visible `add_message(content)` path.
