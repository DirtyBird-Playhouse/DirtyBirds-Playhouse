"""PostToolUse: syntax-check an edited Python file immediately.

The node aggregator imports each package defensively, so a syntax error does not
raise — the package is skipped with a log warning and its nodes just vanish from
the ComfyUI menu. This catches that at the moment of the edit instead of at the
next restart.

Also drops a marker so the Stop hook knows a node file changed and the
registration smoke test is worth running.
"""

import sys

from _hooklib import MARKER_DIR, edited_path, read_payload, rel, within_repo


def main():
    payload = read_payload()
    path = edited_path(payload)
    if path is None or path.suffix != ".py" or not within_repo(path):
        sys.exit(0)

    try:
        source = path.read_bytes()
    except OSError:
        sys.exit(0)  # deleted, moved, or unreadable — not this hook's problem

    try:
        # Builtin compile: parses only, writes no .pyc, imports nothing.
        compile(source, str(path), "exec")
    except SyntaxError as exc:
        # Exit 2 sends stderr back to Claude so it fixes this before moving on.
        print(
            f"Syntax error in {rel(path)} line {exc.lineno}: {exc.msg}\n"
            f"The node package will silently fail to import and its nodes will "
            f"disappear from the ComfyUI menu. Fix this before continuing.",
            file=sys.stderr,
        )
        sys.exit(2)
    except ValueError as exc:
        print(f"Cannot compile {rel(path)}: {exc}", file=sys.stderr)
        sys.exit(2)

    posix = rel(path).replace("\\", "/")
    if posix.startswith("nodes/"):
        try:
            MARKER_DIR.mkdir(parents=True, exist_ok=True)
            session = str(payload.get("session_id") or "unknown")
            (MARKER_DIR / f"{session}.nodes-touched").write_text(posix, encoding="utf-8")
        except OSError:
            pass  # marker is an optimisation; never fail the edit over it

    sys.exit(0)


if __name__ == "__main__":
    main()
