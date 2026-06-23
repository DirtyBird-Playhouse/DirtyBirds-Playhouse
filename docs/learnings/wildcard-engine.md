# Wildcard Engine

`dirtybirds_wildcard_engine.py` expands wildcards and processes `[[variable]]`
declarations with roll-scoped register-lock.

## Register-lock syntax

- `[[reg=value]]` - declare/assign a register for the current roll scope.
- `[[reg]]` - read the locked register value.
- Declarations are processed anywhere they appear, including inside templates
  pulled in via the scenario-template-file pattern.
- The lock is scoped per roll, so repeated reads within a roll return the same
  resolved value.

## Notes

- Scenario-template files can be pulled in and still have their `[[variable]]`
  declarations processed.
- For the test run command and module split details, see memory
  `[[wildcard-engine-variables]]`.
- `instructions.md` is the plain-language user guide for this engine; keep it in
  sync when syntax changes.
