---
name: SDD
description: Spec-driven development workflow for non-trivial changes — spec (what and why, with acceptance criteria) → plan (how) → tasks (ordered and verifiable) → implement (one task at a time) → verify (spec against the diff). Use when a task adds behaviour, changes an API or a data model, touches several files, takes more than about an hour, or is ambiguous. Skip for trivial changes that fit in one sentence.
---

# Spec-driven development

Code is written only against a spec and a plan the user approved. Each phase
ends at a gate and the user approves in plain text. The artefacts live in the
repository, so they survive restarts and travel with the code.

## When to use it

Use the full flow when the change:

- adds observable behaviour, or changes an API, a data model or a contract;
- touches several files, or is expected to take more than about an hour;
- has any part the user is unsure about.

Skip it when the change fits in one sentence — a rename, a config value, a
one-line fix. Then just do the work.

## Phases

| Phase | Command | Produces | Gate | Status after the gate |
|---|---|---|---|---|
| Spec | `/sdd/spec` | `.sdd/<ISSUE_ID>/spec.md` — what and why | user approves the text | `Todo` |
| Plan | `/sdd/plan` | `.sdd/<ISSUE_ID>/plan.md` — how | user approves | `Todo` |
| Tasks | `/sdd/plan` (task list section) | `.sdd/<ISSUE_ID>/tasks.md` | user approves | `Todo` |
| Implement | `/sdd/implement` | code, one task at a time | per task: tests green | `In Progress` |
| Verify | `/sdd/verify` | spec-vs-diff report | user accepts | `Review` once the branch is pushed and the MR is open |

**Gate rule.** Never start the next phase without an explicit approval in the
conversation. Present the artefact, ask, and only then write it to disk or to
Plane. Writing to Plane is an outward action and needs its own confirmation.
The spec, plan and tasks phases do not edit product code.

## Where the artefacts live

`.sdd/<ISSUE_ID>/` in the project repository, in format `.sdd/${PLANE_PREFIX}-<SEQUENCE_ID>/`.

The issue id is the key Plane gives the work item — `PLANE_PREFIX` followed by
the sequence number, e.g. `${PLANE_PREFIX}-1234`. Take it from Plane;
never assemble it by hand.

- The issue id is the **only** path element. Never derive a path or a filename
  from an issue title — titles contain slashes, brackets and Cyrillic.
- The folder is kept permanently, ADR-style. It stays after the merge; do not
  delete or rename it. `.sdd/` must never be gitignored.
- `spec.md` line 1 is always `# ${PLANE_PREFIX}-<SEQUENCE_ID>`, so the whole archive
  lists with `rg '^# ' .sdd/ --glob 'spec.md'`.

Formats: `templates/spec.md`, `templates/plan.md`, `templates/tasks.md` in this
skill's directory. Read the template before writing a file.

## Rules that hold in every phase

1. **Fresh evidence.** "Done" means the tests and linters were run *in this
   turn* and the output was read. A previous run does not count.
2. **One task at a time.** Implement tasks in order. Each task ends with its
   own verification command green before the next one starts.
3. **Minimal diff.** Only what the task asks for. No drive-by refactoring, no
   renames "while we are here", no new abstraction for a single use, no new
   dependency without asking.
4. **Tests before code** for non-trivial logic. Watch the test fail for the
   right reason, then make it pass. Trivial changes are verified by running
   them, not by a test.
5. **Scope discipline.** If the implementation reveals that the spec is wrong,
   stop and fix the spec — do not quietly implement a different thing.
6. **Out of scope.** Anything discovered but not covered by the spec is
   reported as a note, never smuggled into the code.
7. **No commits.** The agent never commits and never stages. The user reviews
   and commits by hand.

## Working with Plane

Plane is the source of truth for the task and the issue text is written in
Russian.

### Configuration

The instance is configured entirely through environment variables. Never write
an instance URL, a workspace slug or a project id into a file — read them at
run time.

| Variable | Meaning |
|---|---|
| `PLANE_URL` | Base URL of the Plane instance, e.g. `https://plane.example.com` |
| `PLANE_API_KEY` | API key, sent as the `X-API-Key` header. Never print it |
| `PLANE_WORKSPACE_SLUG` | Workspace slug |
| `PLANE_PROJECT_ID` | Project UUID |
| `PLANE_PREFIX` | Prefix of the issue key, e.g. `FOO`. The issue key is `${PLANE_PREFIX}-<SEQUENCE_ID>`. If it is unset, take the project's `identifier` from the Plane API |

Derived values:

- REST API base — `${PLANE_URL}/api/v1`
- Web URL of an issue — `${PLANE_URL}/${PLANE_WORKSPACE_SLUG}/browse/${PLANE_PREFIX}-<SEQUENCE_ID>/`

This is the URL Plane's own UI puts in the address bar: `PLANE_PREFIX` is
the project's identifier and the last segment is the sequence number. An
archived issue is addressed differently —
`${PLANE_URL}/${PLANE_WORKSPACE_SLUG}/projects/${PLANE_PROJECT_ID}/archives/issues/<ISSUE_UUID>` —
but archived work is out of scope here.

The templates in `templates/` show the Plane URL placeholders unresolved. The artefact
you write carries the **resolved** URL, so a human can click it; the template
stays portable.

### Procedure

1. Find the issue before starting: `plane_search` to locate it, `plane_get` to
   read its title, state and description. Search by id, title or service tag.
2. If the Plane tools are unavailable in the current session, ask the user to
   paste the issue text and continue — do not block the whole flow on it.
3. The spec, plan and tasks are written in **English**. The issue title is
   quoted verbatim from Plane as a pointer, not translated.
4. Creating or updating an issue is an outward action: confirm with the user
   before doing it.

## Artefact quality bar

- **Spec** — a stranger could write the acceptance tests from it alone. Each
  criterion is a statement a reviewer can check against the diff. No
  implementation decisions; those belong in the plan.
- **Plan** — names every file to touch and what changes in it. For each
  decision with a real alternative, state the choice and the rejected one.
- **Tasks** — 15–60 minutes each, names its files, carries a verification
  command or a concrete manual check, ordered by dependency. `[P]` marks only
  tasks that touch different files and have no dependency between them. A
  checkpoint task after each coherent group.

## Template rules

The templates in `templates/` are skeletons only — copy the structure, fill it
in, and leave the template's placeholder rows behind. Do not copy the
template's own headings into the artefact as empty stubs: drop any section
that has nothing to say.

**`spec.md`**
- Line 1 is always `# ${PLANE_PREFIX}-<id>`. Never the title.
- Lines 3–4 are the Plane URL and the issue title quoted verbatim, never
  translated. The URL is **resolved** from the environment variables before it
  is written: `${PLANE_URL}/${PLANE_WORKSPACE_SLUG}/browse/${PLANE_PREFIX}-<SEQUENCE_ID>/`.
  Take it from the Plane tool's response when there is one; never type an
  instance host from memory.
- `Goal` — one or two sentences: what changes, and for whom.
- `Observable behaviour` — a numbered list of what the system does differently.
- `Acceptance criteria` — numbered `AC1`, `AC2`, …, each one a statement the
  reviewer can check against the diff. Refer to them by number in the other
  sections.
- `Non-goals` — what this explicitly does not do. Keeps scope creep visible.
- `Verification` — how each criterion is checked: a command, or a concrete
  manual step.
- No implementation decisions. No user stories, no "done when", no headings
  the template does not have.

**`plan.md`**
- `Approach` — two to four sentences on how it will be built, plus the key
  decisions and the reason for each.
- `Files to touch` — a table naming **every** file and what changes in it. No
  "and so on".
- `Decisions` — only decisions with a real alternative: the choice, the
  rejected one, the reason. One line each.
- `Risks` — what can go wrong and how each risk is reduced.
- `Test strategy` — which commands, which manual checks, what counts as green.
- Drop `Decisions` or `Risks` if there is nothing to say.

**`tasks.md`**
- One line per task, in the form `- [ ] <what changes> — <files> — <how it is
  verified>`.
- 15–60 minutes per task. Split anything longer.
- Every task names its files and carries a verification command or a concrete
  manual check.
- Ordered by dependency: foundations first, then behaviour, then polish.
- `[P]` only for tasks that touch different files and have no dependency on
  each other.
- A checkpoint task after each coherent group: run the suite, exercise the
  behaviour by hand.
- Tick a box in place when the task is done and its verification is green.
- Anything found outside the spec goes at the end of the file as a single
  `Out of scope:` line, never into the code.
