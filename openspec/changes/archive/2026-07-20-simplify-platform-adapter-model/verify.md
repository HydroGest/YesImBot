# Verify: simplify-platform-adapter-model

## Test Results

### Core (`koishi-plugin-yesimbot`): 13 test files, 61 tests passed ✓️
```
tests/platform-types.test.ts          ✓ 7 tests
tests/channel-message.test.ts         ✓ 3 tests
tests/platform-normalize.test.ts      ✓ 6 tests
tests/platform-session.test.ts        ✓ 2 tests
tests/platform-elements.test.ts       ✓ 12 tests
tests/platform-projection.test.ts     ✓ 6 tests
tests/platform-prepare.test.ts        ✓ 4 tests
tests/message-flow.test.ts            ✓ 5 tests
tests/error-handling.test.ts          ✓ 3 tests
tests/platform-service-helper.ts      (helper)
tests/channel-context.test.ts         ✓
... (remaining test files)
```

### OneBot Platform (`koishi-plugin-yesimbot-platform-onebot`): 3 test files, 13 tests passed ✓
```
tests/events.test.ts     ✓ 6 tests
tests/prepare.test.ts    ✓ 4 tests
tests/plugin.test.ts     ✓ 3 tests
```

### OneBot Utils (`koishi-plugin-yesimbot-onebot-utils`): 1 test file, 9 tests passed ✓
```
tests/onebot-utils.test.ts ✓ 9 tests
```

## Typecheck
```
@yesimbot/agent-runtime         ✓
koishi-plugin-yesimbot           ✓
koishi-plugin-yesimbot-platform-onebot  ✓
koishi-plugin-yesimbot-onebot-utils     ✓
All 6 packages: 6 successful
```

## Build
```
All 8 tasks: 8 successful
```

## Deleted Modules and Behaviors

### Deleted source files:
- `core/src/platform/view.ts` — MessageView/Snapshot/Reader stack
- `core/src/platform/render.ts` — template/Fact/EventView rendering
- `core/src/platform/resources.ts` — generic resource engine
- `core/src/platform/schema.ts` — Zod fact/event/extension schemas
- `plugins/platform-onebot/src/readers.ts` — OneBot Reader-based image acquisition

### Deleted test files:
- `core/tests/platform-resources.test.ts`
- `core/tests/platform-registry.test.ts`
- `core/tests/platform-view.test.ts`
- `core/tests/render.test.ts`
- `core/tests/service.test.ts`
- `core/tests/reset.test.ts`
- `plugins/platform-onebot/tests/readers.test.ts`

### Removed behaviors:
- Runtime Zod fact schema validation (parsePlatformFact)
- EventDefinition, EventView, Fact, template rendering
- Reader/Snapshot/ReadContext resource pipeline
- Extension schema registration and parsing
- Event JSONL storage / agent custom message admission
- Legacy Platform.Message shape (content string, extensions map, version field)
- Adapter.Identity nested type
- prepareMessage(string) API

## Operational Note

**Upgrade requires clearing or replacing channel session JSONL + assets directories.**
The new `PersistedPlatformMessage` format uses `content` (a literal string) derived from
`elements` (Koishi element tree). Old JSONL records with `Platform.Message` shapes
(version, extensions, resources, content-as-plain-text) will not be decoded.

**Rollback**: previous binary + previous data directory.
