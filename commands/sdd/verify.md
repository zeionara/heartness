---
description: SDD phase 4 — check the diff against the approved spec, review for defects, run the full suite
agent: build
---

Run the **Verify** phase of the `sdd` skill for: $ARGUMENTS

1. Load the `sdd` skill.
2. Read `.sdd/<ISSUE_ID>/spec.md` and `.sdd/<ISSUE_ID>/plan.md`.
3. Dispatch the `spec-reviewer` subagent (subagent tool, agent id
   `spec-reviewer`) in **mode B** with the approved spec and the diff. It
   reports each acceptance criterion as met, not met or not verifiable, with a
   file and a line, plus any scope creep.
4. Dispatch the `reviewer` subagent over the same diff for defects. Significant
   findings go back to the `implementer` and are re-verified afterwards.
5. Dispatch the `tester` subagent over the full suite and the linters.
6. Present the result in the conversation and ask for the acceptance gate.
   Stop there.

Never commit and never stage. Do not move the issue to Review until the user
accepts and the branch is pushed with the merge request open. If anything
needs fixing, report it and let the user decide whether to re-run
`/sdd/implement`.
