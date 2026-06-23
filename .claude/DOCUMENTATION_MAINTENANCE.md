# Documentation Maintenance

When and how to keep this doc structure useful and cheap.

---

## When to update COMMON_MISTAKES.md

Add an entry when a bug cost real time and is likely to recur: a ComfyUI gotcha,
a wrong-install-path incident, a tensor-shape bug, a broken-workflow regression.
Keep each entry to Symptom / Check / Fix. Prune entries that no longer apply.

## When to create a completion doc

At the end of every non-trivial task, write
`.claude/completions/YYYY-MM-DD-task-name.md` from
`.claude/templates/completion-template.md`. These are NEVER auto-loaded.

## When to use a session file

For multi-step work spanning a session, create
`.claude/sessions/active/YYYY-MM-DD-topic.md` from the session template. Move it
to `.claude/sessions/archive/` when done. NEVER auto-loaded.

## When to archive

Move planning docs, superseded designs, and one-off summaries to `docs/archive/`.
Keep `docs/learnings/` to current, reusable patterns only.

## When to update learnings

When a new reusable pattern emerges (a node idiom, a UI convention, an LLM-call
shape), add or update the relevant `docs/learnings/*.md` and ensure
`.claude/LEARNINGS_INDEX.md` and `docs/INDEX.md` list it.

## Token discipline

- Keep CLAUDE.md under 200 lines; link to details instead of duplicating.
- Split any learnings file over ~1000 lines by sub-topic.
- Keep token estimates in `docs/INDEX.md` current.
- Never auto-load `completions/`, `sessions/`, or `docs/archive/`.

## Decision tree: where does this knowledge go?

```
I learned / changed something. Where do I write it?
├─ A bug that wasted time and could recur ...... .claude/COMMON_MISTAKES.md (Symptom/Check/Fix)
├─ A reusable pattern/idiom ..................... docs/learnings/<topic>.md (+ update both indexes)
├─ A record of a finished task ................. .claude/completions/YYYY-MM-DD-*.md
├─ Notes for in-progress multi-step work ....... .claude/sessions/active/YYYY-MM-DD-*.md
├─ Superseded / historical doc ................. move to docs/archive/
└─ A cross-session fact about the user/project . auto-memory (MEMORY.md index)
```

## Examples

- Spent an hour because edits hit the dev copy, not the live install -> add a
  COMMON_MISTAKES entry, do not bury it in a learnings file.
- Discovered the standard shape for an LLM call -> update
  `docs/learnings/llm-integration.md` and confirm it is listed in
  `docs/INDEX.md` and `.claude/LEARNINGS_INDEX.md`.
- Finished "add wardrobe randomizer node" -> write
  `.claude/completions/2026-06-22-wardrobe-randomizer.md` from the template.
- Old planning doc no longer reflects the design -> move it to `docs/archive/`,
  do not delete (history).

---

**Last Updated**: 2026-06-22
