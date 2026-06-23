# Learnings Index

Pointers to detailed docs in `docs/learnings/`. Load only the topic you need.

| Topic | File | Load when |
|-------|------|-----------|
| Node patterns | `docs/learnings/node-patterns.md` | Adding/editing a Python node backend |
| Web extension patterns | `docs/learnings/web-extension-patterns.md` | Editing any `web/*.js` extension |
| UI conventions | `docs/learnings/ui-conventions.md` | Building node UI (palette, DOM widgets, width-sync) |
| Common pitfalls | `docs/learnings/common-pitfalls.md` | Reference of anti-patterns to avoid |
| Performance | `docs/learnings/performance.md` | VRAM/tensor/UI optimization |
| Testing patterns | `docs/learnings/testing-patterns.md` | Confirming a change in the live app |
| API design | `docs/learnings/api-design.md` | Node I/O contract or server HTTP routes |
| Deployment | `docs/learnings/deployment.md` | Install layout, deps, distribution |
| Wildcard engine | `docs/learnings/wildcard-engine.md` | Working on `dirtybirds_wildcard_engine.py` |
| LLM integration | `docs/learnings/llm-integration.md` | Touching Muse / LM Studio calls |

## Spec topics not created (N/A for this project)

- `database-patterns.md` - no database/ORM in this suite.
- `queue-systems.md` - no background-job queue.
- `state-management.md` - no Redux/store; node UI state is litegraph widgets
  (covered in `ui-conventions.md`).
- `routing.md` - no client-side router (ComfyUI litegraph context).
- `authentication.md` - no auth layer.
- `component-patterns.md` - node UI "components" are covered by
  `web-extension-patterns.md` + `ui-conventions.md`.

---

**Last Updated**: 2026-06-22
