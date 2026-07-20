"""Stop: run the node-registration smoke test if any node file changed.

tests/test_node_registration_smoke.py already imports the pack the way ComfyUI
does and asserts every node registered with a usable schema. It only helps when
someone remembers to run it — this runs it automatically once Claude finishes a
batch of edits that touched nodes/.

Skips silently when nothing under nodes/ changed, or when no ComfyUI checkout is
available (the test skips itself in that case anyway).
"""

import subprocess
import sys

from _hooklib import MARKER_DIR, REPO_ROOT, find_python, read_payload

TEST = "tests/test_node_registration_smoke.py"
TIMEOUT_SECONDS = 240


def main():
    payload = read_payload()

    # Guard against a Stop-hook loop: if we already blocked once and Claude is
    # stopping again, let it stop.
    if payload.get("stop_hook_active"):
        sys.exit(0)

    session = str(payload.get("session_id") or "unknown")
    marker = MARKER_DIR / f"{session}.nodes-touched"
    if not marker.exists():
        sys.exit(0)  # no node files touched this session

    try:
        proc = subprocess.run(
            [find_python(), "-m", "pytest", TEST, "-q"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        marker.unlink(missing_ok=True)
        print(
            f"Registration smoke test timed out after {TIMEOUT_SECONDS}s. "
            "Not blocking, but the pack may not import cleanly — worth a manual "
            f"`pytest {TEST}`.",
            file=sys.stderr,
        )
        sys.exit(0)
    except OSError as exc:
        marker.unlink(missing_ok=True)
        print(f"Could not run the registration smoke test: {exc}", file=sys.stderr)
        sys.exit(0)

    # Clear the marker either way: one report per batch of edits, not a loop.
    marker.unlink(missing_ok=True)

    if proc.returncode == 0:
        sys.exit(0)

    # Exit 2 blocks the stop and hands the failure back to Claude to fix.
    tail = (proc.stdout or "")[-3000:]
    print(
        "You edited nodes/ and the registration smoke test now fails — a node "
        "package is failing to import, so its nodes will be missing from the "
        "ComfyUI menu with only a log warning. Fix this before finishing.\n\n"
        f"{tail}",
        file=sys.stderr,
    )
    sys.exit(2)


if __name__ == "__main__":
    main()
