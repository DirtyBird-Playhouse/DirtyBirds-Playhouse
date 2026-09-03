# Pass 6 — Sampler picker state boundary

Completed: 2026-09-01

The token-keyed, lock-protected browser picker state now lives in
`nodes/sampler/pick_state.py`. The Sampler entrypoint keeps the route, timeout
loop, event payloads, interruption handling, and its `_PickState` compatibility
alias.

| Current behavior | Structural improvement | Validation |
| --- | --- | --- |
| Picker state storage and synchronization lived beside sampling orchestration | Extract the dependency-free state machine | Pending-token, stale-token, normalization, empty-selection, and existing sampler tests |
| Multiple prompts are isolated by string tokens under a lock | Preserve token normalization, lock scope, and one-shot `take` semantics | `tests/test_pick_state.py` |

No route, event, timeout, output, or UI contract changed.
