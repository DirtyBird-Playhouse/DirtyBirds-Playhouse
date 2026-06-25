# Node Pack Audit And Dead Code Cleanup

## Summary

- Fixed a Dirty Talk frontend runtime error where `applyWidths()` referenced the removed `seedWrap` variable after seed mode moved into the wildcard menu.
- Fixed local pytest collection by making the ComfyUI package entrypoint safe when pytest imports it as a top-level `__init__` module.
- Removed unused imports from active loader/sampler modules, legacy mirror modules, and wildcard tests.

## Verification

- `python -m compileall -q -x "user_files|master\.yaml|\.git|\.pytest_cache|docs[/\\]archive|\.claude[/\\](sessions|completions)" .`
  - Passed; only reported unreadable `.pytest_cache` directories.
- `node --check` over all `web/*.js` files.
- `python -m pytest tests\test_wildcard_engine.py -q`
  - `10 passed`; pytest still warns it cannot write cache under `.pytest_cache`.
- Reloaded ComfyUI at `http://127.0.0.1:8188/`, added Dirty Talk, and confirmed no `seedWrap` / `ReferenceError` browser logs.
