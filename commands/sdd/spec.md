---
description: SDD phase 1 — write the spec: what and why, with acceptance criteria, into .sdd/<ISSUE_ID>/spec.md
agent: spec-writer
---

Run the **Spec** phase of the `sdd` skill for: $ARGUMENTS

1. Load the `sdd` skill and read its `templates/spec.md`.
2. Resolve the issue from the argument above:
   - If it looks like an issue id (`${PLANE_PREFIX}-<SEQUENCE_ID>`), look it up with the Plane tools
     (`plane_search`, then `plane_get`). If those tools are not available in
     this session, say so and ask the user to paste the issue text, then
     continue.
   - Otherwise treat it as the task description.
3. Explore the repository only as much as needed to state the problem
   precisely: where it breaks, which components are involved, what the current
   behaviour is. Do not design yet.
4. Ask the user at most three clarifying questions, in plain text, each with
   your recommended answer. Do not ask what the code can answer.
5. Write `.sdd/<ISSUE_ID>/spec.md` following the template. Line 1 is always
   `# ${PLANE_PREFIX}-<SEQUENCE_ID>`. Line 3 is the issue's web URL, built from the environment
   variables `${PLANE_URL}/${PLANE_WORKSPACE_SLUG}/browse/${PLANE_PREFIX}-<SEQUENCE_ID>/`
   or taken from the Plane tool's response — never type an instance host,
   workspace slug or project id from memory. The body is English; the issue
   title is quoted verbatim from Plane as a pointer, never translated.
6. Present the spec content in the conversation and ask for approval. Stop
   there — do not start the plan phase.

Do not edit any product code in this phase. Do not create or update anything in
Plane.
