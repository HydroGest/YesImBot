# design-platform-adapter-system

Design the Koishi platform adaptation boundary, normalized message and event model, extension registry, and unified LLM presentation flow.

Start with [HANDOFF.md](./HANDOFF.md) when applying Slice 01 in a new agent
session. Use [ROADMAP.md](./ROADMAP.md) as the authoritative progress index.

Implementation is divided into numbered directories under `slices/`; each slice
owns its own `tasks.md`,
`plan.md`, apply cycle, and `verify.md`. A slice represents one complete
releasable implementation version and can contain several internal milestones.
Update the roadmap after every slice status or cross-slice design change.
