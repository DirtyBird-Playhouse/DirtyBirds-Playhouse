# Pass 1 — proven dead-code deletion

Completed: 2026-09-01

## Scope and proof standard

This pass deletes code only when repository-wide symbol search, module imports,
registration and protocol snapshots, and focused tests agree that it has no
runtime caller. Saved-workflow repair paths are not dead merely because only old
graphs exercise them.

## Deletions

| Current behavior | Structural improvement | Validation |
| --- | --- | --- |
| Prompt Builder rendered prompt choices through its current menu builders; `itemLabel` was never called | Remove the abandoned formatter and its inline styling path | Prompt UI contract and full source search |
| Sampler renders selectable cards through its active image-panel/modal paths; `inlineCard` was never called | Remove the superseded card constructor while retaining shared status, sizing, and repaint helpers | Sampler audition and Prompt UI contract tests |
| `db-pick-badge` and `db-pick-check` were applied only by the dead `inlineCard` path | Remove the newly unreachable selector blocks | `test_stylesheet_has_no_unreachable_rules` |
| Optional panels call `makeCollapsibleSectionLabel` and register their owning DOM widgets themselves; `addCollapsibleTitle` had no caller | Remove the stale wrapper so the shared module exposes one collapsible-label abstraction | UI contract now asserts the active constructor exists and the unused wrapper does not |
| Prompt Enhance never invoked the imported shared `makeSlider` | Remove the unused import | Repository-wide symbol search and UI contract tests |

## Audited and retained

- Python imports and local variables: Ruff `F401`, `F841`, `F811`, and `F821`
  checks found no candidates.
- CSS: `test_stylesheet_has_no_unreachable_rules` remains the reachability gate
  and found no unused `db-*` selectors.
- Retired-widget cleanup, legacy Prompt output repair, sampler muting repair,
  legacy pipe types, and old pipe-field defaults remain compatibility shims
  protected by the Pass 0 baseline.
- Route-only modules and side-effect imports remain registered behavior.
- Tracked workflows, model assets, documentation, and launch helpers were not
  treated as dead merely because code does not import them.
- Generated caches and other untracked data were not deleted.

## Validation commands

```powershell
ruff check nodes --select F401,F841,F811,F821
python -m pytest -q tests/test_refactor_baseline.py tests/test_prompt_builder_ui_contract.py tests/test_sampler_audition_panel.py
python -m pytest -q
```
