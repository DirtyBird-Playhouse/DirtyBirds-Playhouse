# Pass 5 — shared Sampler components

Completed: 2026-09-01

## Refactor boundary

The Sampler now uses the shared `makeFlyoutBtn` and `makeSlider` constructors
from `web/db_shared.js`. Its node-specific code still owns widget bindings,
labels, ranges, picker state, and sampling behavior.

## Changes

| Current behavior | Structural improvement | Validation |
| --- | --- | --- |
| Sampler had a private list-flyout renderer duplicating the shared flyout | Remove the duplicate modal/list construction and use the shared flyout through `makeFlyoutBtn` | Sampler audition tests, UI contracts, and JavaScript syntax check |
| Sampler had private flyout-button construction | Pass Sampler getters/setters into the shared button constructor; retain the same labels, current values, selection callbacks, and dirty-canvas refresh | Source contract and focused sampler tests |
| Sampler had private slider DOM construction | Use the shared slider for Steps, CFG, and Pick Timeout while retaining existing ranges, formatting, and widget setters | Sampler audition tests and shared-control contract |

## Stable surfaces

- Sampler node schema, picker route/event, timeout behavior, selection state,
  previews, overlay behavior, and output ordering are unchanged.
- Sampler-specific noise segmented control, picker modal, inline status, and
  lifecycle handling remain local.
- Shared constructors remain the single authority for flyout and slider DOM
  primitives.

## Validation commands

```powershell
node --check web/jsdirtybirds_sampler.js
node --check web/db_shared.js
python -m pytest -q tests/test_sampler_audition_panel.py tests/test_cycler_overlay.py tests/test_prompt_builder_ui_contract.py tests/test_refactor_baseline.py
python -m pytest -q
```
