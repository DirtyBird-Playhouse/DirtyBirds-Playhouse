---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

# Handoff

Create a compact handoff document summarizing the current conversation and context so a fresh agent can pick up the work.

## What it does

1. **Summarizes** the current conversation into key decisions, findings, and blockers
2. **Suggests skills** the next agent should invoke based on the work
3. **References artifacts** (plans, PRDs, ADRs, commits, diffs) by path/URL instead of copying them
4. **Redacts** sensitive data (API keys, passwords, PII)
5. **Saves** to the OS temp directory (not the project workspace)

## Usage

When you've made progress on a task but need to hand off to another agent or session:

```
/handoff [next session focus]
```

Example:
```
/handoff Verify the probe script works with all ComfyUI node types
```

If no focus is provided, the document will summarize the entire conversation for general handoff.

## Output

The handoff document includes:

- **Summary** — compact overview of what's been done
- **Key findings** — important context and decisions
- **Blockers** — anything preventing immediate progress
- **Artifacts** — references to PRs, plans, commits, issues (with paths/URLs, not copies)
- **Suggested skills** — which skills the next agent should invoke
- **Next steps** — concrete action items

Sensitive information is automatically redacted. The document is saved to your OS temp directory with a timestamp.
