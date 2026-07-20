"""PreToolUse: refuse edits to vendored third-party code.

nodes/fixer/vendor/ is a vendored copy of Forbidden Vision. Patching it in place
works right up until the next vendor sync silently reverts the fix, so changes
belong in the DirtyBirds adapter (nodes/fixer/) instead.
"""

import json
import sys

from _hooklib import edited_path, read_payload, rel, within_repo

PROTECTED = ("nodes/fixer/vendor",)


def deny(reason):
    json.dump({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }, sys.stdout)


def main():
    payload = read_payload()
    path = edited_path(payload)
    if path is None or not within_repo(path):
        sys.exit(0)

    posix = rel(path).replace("\\", "/")
    for guarded in PROTECTED:
        if posix == guarded or posix.startswith(guarded + "/"):
            deny(
                f"{posix} is vendored third-party code (Forbidden Vision). "
                "Editing it in place gets reverted by the next vendor sync. "
                "Make the change in the DirtyBirds adapter under nodes/fixer/ "
                "instead — or, if the vendor itself genuinely needs patching, "
                "stop and say so rather than editing silently."
            )
            break
    sys.exit(0)


if __name__ == "__main__":
    main()
