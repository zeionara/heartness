---
description: Read and update the Plane issue for this task — fetch it, post a comment, move it between workflow states.
agent: build
---

Work with the Plane issue: $ARGUMENTS

1. Load the `plane` skill and follow it. The tools are `plane_search`,
   `plane_get`, `plane_list_comments`, `plane_comment`,
   `plane_set_description` and `plane_set_status`.
2. Work out the intent from the arguments:
   - an issue key or a phrase → find it with `plane_search`, then read it with
     `plane_get`;
   - `comment <text>` → prepare the comment;
   - `description <text>` → prepare the description replacement;
   - `status <name>` → prepare the state change.
   If the arguments are empty, use the issue key of the current SDD task
   (`.sdd/<ISSUE_ID>/`).
3. Reading is free: do it and report what you found.
4. Writing is not. For a comment, a description replacement or a state change,
   show the exact new text and the target state, then wait for the user to
   confirm in the conversation before calling the tool. The skill's
   confirm-before-write rule applies here too — a command is not the
   confirmation.
5. After a confirmed write, report the result with the issue URL.

Never create an issue unless the user asked for it. Never commit and never
stage.
