# Archive Save Node Separation

## Summary
- Kept `Dirty Talk — The Script` focused on prompt authoring and positive/negative outputs.
- Removed prompt archive/display ownership from `Sample — The Payoff`.
- Created `Save — The Archive` as the standalone prompt/image archive node.

## Verification
- Python compile passed for prompt, booru, sampler, and saveprompt modules.
- JavaScript syntax checks passed for Dirty Talk, Sampler, Archive, shared loader UI, and shared helpers.
- Wildcard engine tests passed.
- Live ComfyUI restarted and verified:
  - Dirty Talk shows authoring controls without Save Prompt.
  - `Save — The Archive` appears in the DirtyBirds node library.
  - Backend node metadata reports separated inputs/outputs for Dirty Talk, Sample, and Archive.
