# Documentation Index

Navigation with rough token estimates. Load the minimum that answers the task.

---

## Session Start (Essential - ~900 tokens)

- `CLAUDE.md` (~450 tokens)
- `.codex/COMMON_MISTAKES.md` (~400 tokens)
- `.codex/QUICK_START.md` (~250 tokens)
- `.codex/ARCHITECTURE_MAP.md` (~400 tokens)

## Navigation by task type

| If the task is...               | Load                                       | Est. tokens |
| ------------------------------- | ------------------------------------------ | ----------- |
| Add/edit a Python node          | `docs/learnings/node-patterns.md`          | ~500        |
| Edit a `web/*.js` extension     | `docs/learnings/web-extension-patterns.md` | ~500        |
| Build/adjust node UI            | `docs/learnings/ui-conventions.md`         | ~400        |
| Node I/O contract or HTTP route | `docs/learnings/api-design.md`             | ~400        |
| Avoid anti-patterns             | `docs/learnings/common-pitfalls.md`        | ~400        |
| Optimize VRAM/tensor/UI         | `docs/learnings/performance.md`            | ~400        |
| Wildcard engine work            | `docs/learnings/wildcard-engine.md`        | ~400        |
| LM Studio / Muse work           | `docs/learnings/llm-integration.md`        | ~350        |
| Install / distribute the pack   | `docs/learnings/deployment.md`             | ~350        |
| Verify a change in the app      | `docs/learnings/testing-patterns.md`       | ~300        |

Fast lookups (cheatsheet): `docs/QUICK_REFERENCE.md` (~350 tokens).

See also `.claude/LEARNINGS_INDEX.md` for legacy Claude-specific notes.

## Decision tree

```
What are you changing?
├─ Python node logic ........... node-patterns.md (+ common-pitfalls.md)
│   └─ tensor/VRAM heavy? ....... + performance.md
├─ Node inputs/outputs/types ... api-design.md (mind backward compat!)
├─ Node UI (web/*.js) .......... web-extension-patterns.md + ui-conventions.md
├─ LLM / Muse calls ............ llm-integration.md
├─ Wildcard / [[variable]] ..... wildcard-engine.md
├─ Install / packaging ......... deployment.md
└─ About to report "done"? ..... testing-patterns.md (verify live!)
```

## Never auto-load (0 token cost)

- `.claude/completions/**`
- `.claude/sessions/**`
- `docs/archive/**`

## Before / after

- Before: load whole repo + scattered docs at session start (~8,000+ tokens).
- After: ~900 tokens at start, +300-500 per task topic.

---

**Last Updated**: 2026-06-22
