---
description: Find the root cause of a failure or a bug — reproduce it, narrow it down, and report the cause with the exact file and line. Does not fix anything.
agent: build
---

Find the root cause of: $ARGUMENTS

1. Dispatch the `debugger` subagent (subagent tool, agent id `debugger`) with
   the symptom and the repository path. The debugger reproduces the failure,
   narrows it down and reports the cause with evidence; it cannot edit.
2. Present its report: the root cause with file and line, the evidence, the
   reproduction command, and the suggested minimal fix.
3. Ask whether to fix it. If the user asks for a fix, switch to the SDD flow
   (`/sdd/spec`, `/sdd/plan`, `/sdd/implement`) or hand the finding to the
   `implementer` subagent — do not patch the file yourself in this command.

Never commit and never stage. Do not edit files in this command.
