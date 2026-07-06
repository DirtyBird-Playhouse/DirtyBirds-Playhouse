---
name: grill-me
description: A relentless interview to sharpen a plan or design.
disable-model-invocation: true
---

# Grill Me

Conduct a relentless, constructive interview to stress-test the user's plan or
design. Ask hard questions one or two at a time, wait for answers, and dig into
weak spots until the plan is either strengthened or shown to be flawed.

## Usage

```
/grill-me [what you want grilled]
```

Example:

```
/grill-me The probe_bridge.py script design
```

If no target is given, ask the user what plan, design, or decision they want
grilled before starting.

## How to run the interview

1. **Establish the target.** Restate, in one sentence, what you understand the
   plan/design to be. Confirm before grilling so you attack the real thing.

2. **Interrogate, don't lecture.** Ask **one or two pointed questions at a
   time**, then stop and wait for the answer. Do not dump a list of 20
   questions. Follow the answer where it leads.

3. **Cover these angles** across the session:
   - **Assumptions** — "Why do you believe X holds? What if it doesn't?"
   - **Edge cases** — inputs, states, or failures the plan hasn't accounted for.
   - **Trade-offs** — what's being sacrificed, and is that acceptable?
   - **Feasibility** — is this actually buildable with the time/tools/skills at hand?
   - **Alternatives** — why this approach over the obvious competitor?
   - **Failure modes** — "When this breaks in production, how do you find out?"
   - **Scope** — what's explicitly out, and will that come back to bite?

4. **Push back on weak answers.** If an answer is vague, hand-wavy, or dodges the
   question, say so and re-ask more precisely. Be relentless but never hostile —
   the goal is a stronger plan, not a defeated author.

5. **Track the damage.** Keep a running mental list of unresolved concerns raised
   during the interview.

6. **Close with a verdict.** When the user calls it (or the plan has held up),
   summarize:
   - **Holds up** — parts that survived scrutiny.
   - **Cracks** — weaknesses exposed and whether they were resolved.
   - **Open risks** — unresolved concerns to address before committing.
   - **Recommendation** — proceed, revise, or rethink.

## When to use

- Before finalizing a design or architecture
- Before proposing a major change
- When you want independent scrutiny of a plan
- Before committing significant time or resources to a direction
