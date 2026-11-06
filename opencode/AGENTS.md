# AGENTS.md

1. You can work with projects located at /opt folder - for example:  

- /opt/project1
- /opt/project2

2. To run a using venv python module, python-based project, create a virtual environment at specific project - for example:  

- /opt/project1/.venv
- /opt/project2/.venv

3. Do not commit changes yourself, and do not stage them. Just update files on the disk and make required API calls.

4. When you create resources for testing, delete them yourself at the end of test.

5. Do not print env variables with auth credentials before running scripts to check their values.

6. You are running in a docker container, which has no system packages like 'docker' or 'sudo' available. There are custom aliases for agentic systems, which are located at /home/zeio/agents.zsh. These aliases are configured on the host OS inside which the docker system with your container is running. The opencode sessions is usually run using alias 'opencode' from this file. You can suggest updates to the script for improving user experience.

7. Language. Write in Russian anything a non-developer might read: Plane issue titles, descriptions and comments, README files, `.env.example`, and any other document meant for the team. Write in English everything else: SDD specs and plans, code, code comments, commit messages, and anything only the developer reads. When an artefact quotes an original Russian text (for example an issue title), quote it verbatim rather than translating it.

8. Spec-driven development. Non-trivial work — new behaviour, a change to an API or a data model, several files, more than about an hour, or anything the user is unsure about — goes through the `sdd` skill and the `/sdd/spec`, `/sdd/plan`, `/sdd/implement`, `/sdd/verify` commands. Work that can be described in one sentence skips SDD: just do it. Every phase ends at a gate; never start the next phase without an explicit approval from the user in the conversation.

9. SDD artefacts. Specs, plans and task checklists live in `.sdd/<ISSUE-ID>/` inside the project repository — for example `.sdd/${PLANE_PREFIX}-<SEQUENCE_ID>/spec.md`. The issue id is the only path element: never derive a path or a filename from an issue title, and never assemble the id by hand — take it from Plane. These folders are kept permanently, ADR-style: the folder stays after the merge, do not delete or rename it, and `.sdd/` must never be gitignored. The spec is written in English, with the Russian issue title quoted as a pointer to the Plane original.

10. Git. The agent never commits and never stages anything — rule 3 applies to subagents as well. Leave the working tree dirty for the user to review and commit by hand.

11. Plane. Plane is the source of truth for tasks. Find the existing issue first; never create a duplicate without asking. Creating or updating an issue is an outward action — confirm it with the user in the conversation before doing it. Issue text is written in Russian, following the format in the `plane` skill. Read and update issues through the `plane` tools (`plane_search`, `plane_get`, `plane_comment`, `plane_set_status`) — never hand-roll API calls against the instance. The instance is configured through the `PLANE_URL`, `PLANE_API_KEY`, `PLANE_WORKSPACE_SLUG`, `PLANE_PROJECT_ID` and `PLANE_PREFIX` environment variables: read them at run time, never hard-code an instance URL, workspace slug, project id or issue-key prefix into a file, and never print `PLANE_API_KEY`. The web URL of an issue is `${PLANE_URL}/${PLANE_WORKSPACE_SLUG}/browse/${PLANE_PREFIX}-<sequence_id>/`; the REST API base is `${PLANE_URL}/api/v1`; the issue key is `${PLANE_PREFIX}-<SEQUENCE_ID>`.

12. There are two types of projects - enterprise and experimental. For enterprise projects the SDD-based approach is used by default, for experimental projects the SDD-based approach is applied only if explicitly told so.
