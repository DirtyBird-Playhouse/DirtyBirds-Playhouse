# Refactor baseline

Established: 2026-09-01

This is the behavior-preservation gate for incremental refactors. It records
the graph-facing and browser-facing interfaces that existing workflows depend
on. It does not promise that private helper names or module boundaries stay
fixed.

The machine-readable contract is
`tests/fixtures/refactor_baseline/public_api.json`. Update that snapshot only
when a reviewed change intentionally changes the public behavior. A refactor
that merely moves code must leave it unchanged.

## Required validation

Run the characterization gate first:

```powershell
python -m pytest -q tests/test_refactor_baseline.py tests/test_pipe_roundtrip.py tests/test_node_registration_smoke.py
```

Then run the repository suite:

```powershell
python -m pytest -q
```

The characterization gate is deliberately static where possible. It must not
start, query, or depend on the live ComfyUI instance. The optional registration
probe runs in a subprocess only when a usable ComfyUI checkout is discoverable.

## Stable public surface

The snapshot protects:

- registration keys and display names;
- ordered required, optional, and hidden input names;
- ordered output types and names;
- execution method, category, and output-node status;
- the canonical `PIPE_LINE` output type and the legacy
  `DIRTYBIRDS_PIPE` input alias;
- the keys carried by a DirtyBirds pipe;
- HTTP method/path pairs registered below `/dirtybirds/`;
- server-to-browser event names and their producer/consumer modules.

Input order matters because ComfyUI restores widget values positionally.
Outputs and registration keys are graph-facing APIs. Route methods and event
names are frontend/backend protocol contracts.

## Compatibility fixtures

`tests/fixtures/refactor_baseline/workflows/legacy_pipe_type.json` represents a
saved graph whose link still uses `DIRTYBIRDS_PIPE`. Inputs must continue to
accept that type even though new outputs use `PIPE_LINE`.

`tests/fixtures/refactor_baseline/workflows/prompt_widget_order.json` records
the Prompt Builder widget sequence after the retired `dress_state` slot. New
widgets must remain additive at the end unless a separate migration explicitly
changes saved-workflow compatibility.

## Intentional compatibility shims

| Shim | Current behavior | Removal gate |
| --- | --- | --- |
| Pipe input union | Accepts `PIPE_LINE,DIRTYBIRDS_PIPE`; emits `PIPE_LINE` | Versioned workflow migration with fixtures for upgraded graphs |
| Prompt boolean repair | A shifted legacy string cannot enable step mode | Saved-workflow migration proving old widget arrays are rewritten |
| Additive node inputs/outputs | New controls and caption outputs are appended | Explicit public API migration and workflow parity tests |
| Defensive node aggregation | One failed optional package is logged and skipped | Dependency policy guaranteeing every node dependency is available |
| Missing pipe fields | Consumers use defaults for older or foreign pipes | Versioned pipe schema and conversion adapter |

## CSS ownership map

| Surface | Owner | Contract |
| --- | --- | --- |
| Tokens, control appearance, widths, sizing, two-column layout | `web/db_shared.js`, `web/css/style.css` | Node modules do not create competing form primitives or resize authorities |
| Loader composition | `web/jsdirtybirds.js` | Content and loader behavior only |
| Prompt composition | `web/jsdirtybirds_prompt.js` | Content and prompt behavior only |
| Sampler composition and picker | `web/jsdirtybirds_sampler.js` | Sampling/picker behavior using shared components |
| Image, inpaint, finish, save, trigger-word composition | Corresponding `web/jsdirtybirds_*.js` module | Node-specific content and behavior only |

The existing UI contract tests remain the selector reachability, design-token,
shared-control, and sizing parity gate. A later CSS reorganization should first
add computed-style or screenshot parity checks; this baseline does not pretend
source inspection proves pixel identity.

## Known baseline failures

On 2026-09-01, before Pass 0 files were added, `python -m pytest -q` reported
196 passed, 4 skipped, 2 failed, and 17 errors:

- node registration could not complete against the discovered ComfyUI checkout;
- the Prompt Enhance endpoint source contract did not match its test;
- face-restore collection hit a missing `comfy_aimdo.host_buffer` dependency;
- eight path tests encountered Windows access errors while pytest cleaned
  `.pytest_tmp`.

These are observations, not accepted failures. They must be fixed or explicitly
classified before a later pass claims a fully green baseline. Refactor reviews
must compare their results to the latest verified run, not silently expand this
list.

## Pass review template

Every refactor pass should state:

1. Current behavior being preserved.
2. Structural improvement being made.
3. Focused validation proving parity.
4. Full-suite result and any delta from the known baseline.
5. Whether the public snapshot changed; for a refactor, the expected answer is
   no.
