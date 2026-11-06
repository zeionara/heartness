---
description: Run the project's tests and linters and report only the failures. Keeps the verbose output out of the main conversation.
agent: build
---

Run the tests: $ARGUMENTS

1. Work out the scope. If the arguments name a test path, a module or a
   marker, run that; otherwise run the project's full suite.
2. Dispatch the `tester` subagent (subagent tool, agent id `tester`) with the
   scope and the repository path. The tester runs the suite and the linters
   and reports failures only — it cannot edit anything.
3. Present the failures in the conversation: the test name, the assertion or
   exception, and the traceback lines that matter. The raw output stays in the
   subagent.
4. If everything passes, say so in one line with the command and its exit
   status.

Never commit and never stage. Do not edit files in this command, and do not
fix a failing test here.
