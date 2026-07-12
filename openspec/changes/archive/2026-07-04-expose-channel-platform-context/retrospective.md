# Retrospective: expose-channel-platform-context

> Written: 2026-07-04 (after verify passed)
> Commit range: `c68e8cec..6158d1e0`
> Worktree: `/home/workspace/Athena` (normal repo, no extra worktree by user instruction)

---

## 0. Evidence

- **Commit range**: `c68e8cec..6158d1e0` (3 commits at write-time)
- **Diff size**: +2211 / -10 lines across 20 files
- **Tasks done**: 19/19 (`grep -cE '^\s*- \[x\]' tasks.md` -> 19)
- **Active hours**: ~1.5
- **Subagent dispatches**: 4 (`Phase 1 core implementer`, `Phase 2 onebot implementer`, `Phase 3 verification`, `final review`)
- **New external dependencies**: none; new package reuses existing workspace/API dependencies (`@yesimbot/agent-runtime`, `koishi`, `koishi-plugin-yesimbot`, `vitest`)
- **Bugs encountered post-merge**: none
- **OpenSpec validate state at archive**: pass (`openspec validate --all --json`: 6/6 valid; `openspec validate expose-channel-platform-context --strict`: valid)
- **Test coverage signal**: core scoped test 33/33 passed; onebot-utils test 9/9 passed; core and onebot-utils type checks passed; onebot-utils build passed

Commit chain (chronological):

```text
9db6f2da feat(core): expose channel platform context
4a9aa203 docs(openspec): add channel platform context change
6158d1e0 docs(openspec): verify channel platform context
```

---

## 1. Wins

- The core/runtime boundary stayed narrow: `ChannelAgentContext` gained `platform.name` and `platform.unsafeBot`, while `packages/agent-runtime/src` still has no `koishi|unsafeBot|Session|Bot` matches.
- OneBot migration stayed YAGNI: only `onebot_get_forward_message`, `onebot_create_reaction`, and `onebot_set_essence` were migrated; `onebot_get_message_id` remains excluded from implementation.
- TDD-style subagent phases produced useful evidence: Phase 1 RED showed factory context lacked platform metadata; Phase 2 RED showed the new plugin package had no implementation entry yet.
- The verification phase caught an unrelated but real core test failure in `createPlatformMessage`; fixing it made `koishi-plugin-yesimbot` scoped tests fully green at 33/33.
- Final review found no Critical, Important, or Minor required fixes.

## 2. Misses

- 🟡 [painful | evidence: `.superpowers/sdd/phase-3-verification-report.md`] Full scoped core test initially failed because `createPlatformMessage()` computed message id/timestamp but did not pass them to `createCustomMessage()`. The fix landed in `core/src/runtime/message.ts` and was verified by `tests/channel-message.test.ts`.
- 📌 [nit | evidence: `.superpowers/sdd/phase-2-onebot-utils-report.md`] Adding a new workspace required one `yarn install` refresh before `yarn workspace koishi-plugin-yesimbot-onebot-utils ...` would resolve.
- 📌 [nit | evidence: `openspec instructions verify --json`] The dedicated `openspec-verify-change` skill was not available in this session, so verify was produced manually from the schema's fallback checklist.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| Pre-flight workspace setup | Did not invoke `using-git-worktrees` or create a worktree. | User explicitly instructed: "本次不使用worktree". |
| Task 4 tsconfig | `plugins/onebot-utils/tsconfig.json` uses `rootDir: "."` instead of `./src`. | The task plan includes tests in `tsconfig` include; TypeScript rejects test files outside `rootDir: "./src"`. This matches the existing `packages/agent-runtime` pattern for packages that type-check tests. |
| Task 5 verification | Added a narrow fix to `core/src/runtime/message.ts`. | Scoped core test exposed a pre-existing runtime message metadata bug; fixing it was necessary to make the planned verification command pass. |
| Verify production | Used manual fallback instead of `openspec-verify-change`. | Tool/skill was unavailable; schema instruction explicitly allows manual fallback using the numbered checks. |

## 4. Skill / workflow compliance

| Skill                                            | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming                        | ✓ prior artifact present |
| superpowers:writing-plans                        | ✓ prior artifact present |
| superpowers:using-git-worktrees                  | ✗ deliberately skipped |
| superpowers:subagent-driven-development          | ✓ adapted into explicit Phase subagents |
| (transitive) superpowers:test-driven-development | ✓ via Phase 1 / Phase 2 reports |
| (transitive) superpowers:requesting-code-review  | ✓ final reviewer plus Phase 3 verification |
| superpowers:finishing-a-development-branch       | ↗ after archive |

### Deliberately Skipped Skills

- **`superpowers:using-git-worktrees`**
  - **What was skipped**: The isolated worktree setup step.
  - **Why this cycle**: The user explicitly wrote "本次不使用worktree" in the session instructions. Creating one would have violated the highest-priority direct instruction.
  - **How to prevent recurrence**: `one-off — schema boundary case, no prevention possible`. The schema's default is correct, but direct user instruction can intentionally override it for a specific cycle.

- **`superpowers:finishing-a-development-branch` at retrospective write-time**
  - **What was skipped**: It was not run before writing this retrospective.
  - **Why this cycle**: The superpowers-bridge apply instruction orders retrospective before archive and finishing; running finishing first would reorder the canonical cycle.
  - **How to prevent recurrence**: `schema graph fix` if desired: mark finishing as a post-retrospective / post-archive activity in the retrospective template so it is not evaluated as skipped before it is reachable.

## 5. Surprises

- The OpenSpec verify artifact requires committed implementation evidence before it is produced, so implementation and task artifacts were committed before verify.md.
- `openspec validate --all --json` validates active specs plus the active change, but main specs are not synced until archive; verify therefore records delta specs as "needs sync" rather than treating that as failure.
- A small runtime message bug unrelated to platform context blocked full scoped core verification; the existing test was already strong enough to identify the root cause.

## 6. Promote candidates -> long-term learning

- [ ] 🟡 **Do not include tests under `tsconfig` unless `rootDir` allows them** -> **Promote to project AGENTS.md**
  > **Why**: The new plugin package needed `rootDir: "."` because `check-types` included `tests`; otherwise TypeScript rejected files outside `./src`.
  > **How to apply**: When creating a new workspace package with `"include": ["src", "tests"]`, either set `rootDir: "."` or keep tests out of that package's typecheck.

- [ ] 📌 **Explicit user "no worktree" should be represented as an intentional schema exception** -> **Promote to schema**
  > **Why**: The apply schema expects worktree setup, but a direct user instruction can intentionally disable it.
  > **How to apply**: In retrospective templates, distinguish "skipped against workflow" from "user-overridden workflow step".

- [ ] 📌 **Manual verify fallback is acceptable only when the verify skill is unavailable** -> **Promote to skill**
  > **Why**: The schema already documents fallback checks; recording exactly why fallback was used keeps verification auditable.
  > **How to apply**: When `openspec-verify-change` is absent, write verify.md from the numbered instruction checklist and cite the unavailable skill as the trigger.
