---
name: verify-node
description: Verify a ComfyUI custom node change end-to-end in the live app before declaring it done. Use after editing any DirtyBirds node (Python or web/*.js), or when asked to confirm a node fix actually works. Enforces editing the live install directory and proving the result with screenshot evidence.
---

# Verify Node

Verify a ComfyUI node change against the running app. Do not report a fix as done
until every step below passes. Never claim success from static or server-side
inspection alone.

## Steps

1. **Confirm active ComfyUI install path.** Identify and print the exact directory
   ComfyUI loads this node from. The dev location is junctioned to the real
   install (see memory: ComfyUI install location) — verify which copy is live
   before touching anything. If ambiguous, stop and confirm with the user.
2. **Apply edits only to the live directory.** Make changes solely in the path
   confirmed in step 1, so they are actually loaded. Do not edit a stale copy.
3. **Restart / reload ComfyUI.** Restart the app (or hard-refresh the browser for
   web-only JS changes) so the new code is loaded.
4. **Reproduce in the browser.** Open the workflow, exercise the feature, and
   reproduce the exact failing case the change was meant to fix.
5. **Report PASS/FAIL with screenshot evidence only.** State PASS or FAIL and back
   it with a screenshot of the live result. No "should work" / "looks correct"
   without a screenshot.
