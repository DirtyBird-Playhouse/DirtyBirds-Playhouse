# Testing Patterns

This suite has no automated test runner as the primary gate; verification is
live, in the running ComfyUI app. (Renamed from testing-verification.)

## Required loop for any node change

1. Confirm the active install path. Edit the directory ComfyUI actually loads
   from (a junction points the dev folder at
   `ComfyUI-Installs\ComfyUI\ComfyUI`). Verify which copy is live first.
2. Restart or reload ComfyUI so Python re-imports and `web/` is re-served.
   Refresh the browser for JS changes.
3. Exercise the feature in the UI.
4. Confirm with a screenshot.

## Rules

- Never claim a fix works from server-side or static inspection alone.
- Confirm the correct test model and hardware (CPU/CUDA) context before running;
  do not hardcode a model assumption.
- Use the `verify-node` skill to drive and evidence this end-to-end.
- For UI consistency, run the `db-ui-reviewer` agent on changed `web/*.js`.

## Wildcard engine

The wildcard engine is the one component with a standalone test run. See memory
`[[wildcard-engine-variables]]` for the command.
