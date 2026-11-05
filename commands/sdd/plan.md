---
description: SDD phase 2 — implementation plan (files, decisions, risks, test strategy) and the ordered task checklist
agent: spec-writer
---

Run the **Plan** phase of the `sdd` skill for: $ARGUMENTS

1. Load the `sdd` skill and read its `templates/plan.md` and
   `templates/tasks.md`.
2. Read the approved spec at `.sdd/<ISSUE_ID>/spec.md`. If it does not exist
   or was never approved, stop and say so — do not plan without an approved
   spec.
3. Read the code the change touches: entry points, models, call sites, tests,
   config. Read only what is needed.
4. Write `.sdd/<ISSUE_ID>/plan.md` — approach, every file to touch with what
   changes in it, decisions with the rejected alternative, risks, test
   strategy. Name every file; no "and so on".
5. Write `.sdd/<ISSUE_ID>/tasks.md` — tasks in dependency order, 15–60
   minutes each, each naming its files and carrying a verification command or
   a concrete manual check. `[P]` only for tasks that touch different files
   and have no dependency between them. A checkpoint task after each coherent
   group.
6. Present both in the conversation and ask for approval. Stop there — do not
   start implementing.

Do not edit any product code in this phase. Do not create or update anything in
Plane.
