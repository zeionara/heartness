---
description: Review the current changes for defects — correctness, error handling, resource leaks, concurrency, security and test gaps. Findings ordered by severity, with file and line.
agent: build
---

Review the current changes: $ARGUMENTS

1. Work out the target of the review. If the arguments name a ref (a commit, a
   branch, a range) review that diff; otherwise review the working-tree diff
   against HEAD.
2. Dispatch the `reviewer` subagent (subagent tool, agent id `reviewer`) over
   that diff. Give it the repository path and the exact ref or range you chose.
3. The reviewer reports findings ordered by severity, each with a file and a
   line, and a short note on why it is a defect rather than a preference.
4. Present the findings in the conversation, most severe first. Add one line
   per finding on what the fix would touch — do not write the fix yourself.
5. Ask whether to fix anything. Fixing is a separate, explicit step.

Never commit and never stage. Do not edit files in this command.
