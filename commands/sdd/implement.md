---
description: SDD phase 3 — implement the checklist one task at a time, with a test and a verification run after each
agent: build
---

Run the **Implement** phase of the `sdd` skill for: $ARGUMENTS

1. Load the `sdd` skill.
2. Read `.sdd/<ISSUE_ID>/plan.md` and `.sdd/<ISSUE_ID>/tasks.md`. If either is
   missing, stop and say so — do not implement without an approved plan.
3. Work through the unchecked tasks in order. For each task, dispatch the
   `implementer` subagent (subagent tool, agent id `implementer`) with: the
   task text, the acceptance criterion it serves, the file paths, the
   repository path and branch, and what is already known — decisions from the
   plan and discoveries from earlier tasks. The subagent writes the failing
   test, the minimal code, runs the task's verification command and reports
   back. It never commits.
4. On the report: if it asked a question, answer it from the plan or ask the
   user; if the verification is red, send it back with the failure; if it
   found that the spec is wrong, stop and fix the spec before going on.
5. Tick the task in `.sdd/<ISSUE_ID>/tasks.md` once its verification is green.
   Track the overall progress with the todo tool as well.
6. After each checkpoint task, dispatch the `tester` subagent over the full
   suite and the `reviewer` subagent over the diff of that group. Significant
   findings go back to the `implementer` as a new mini-task.
7. Tasks marked `[P]` may be dispatched in parallel when they touch different
   files and have no dependency between them.

Keep this conversation to summaries — the details stay in the subagent
reports. Never commit and never stage: leave the working tree dirty for the
user to review and commit. Anything discovered outside the tasks goes as one
"Out of scope:" line at the end of `tasks.md`, never into the code.
