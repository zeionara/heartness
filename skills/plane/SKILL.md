---
name: Plane
description: Read and update issues in the configured Plane project — search, fetch one issue, post a comment, move an issue between workflow states. Use when the task is tracked in Plane, when a spec phase needs the issue text, or when the user asks to update the tracker. Plane is the source of truth for tasks.
---

# Plane

The tracker the team works in. Four tools, all backed by the project's REST
API by the plugin in `~/.config/opencode/plugins/plane` (auto-loaded, no
config entry needed).

## Tools

| Tool | Use it for | Writes? |
|---|---|---|
| `plane_search` | find issues by key, sequence id or title text | no |
| `plane_get` | full detail of one issue: state, priority, assignees, labels, description | no |
| `plane_comment` | post a comment on an issue | **yes** |
| `plane_set_status` | move an issue to another workflow state | **yes** |

`plane_search` takes `query`, `state` and `limit` (default 20, max 100).
`plane_get` takes the issue key (`${PLANE_PREFIX}-123`), the bare sequence
number (`123`) or the issue UUID. `plane_comment` takes `issue` and `body`.
`plane_set_status` takes `issue` and `status` (the state name; it is resolved
against the live state list, so an unknown or ambiguous name comes back as an
error listing the available states).

## Environment

The tools read these at call time. They are never written into a file.

| Variable | Meaning |
|---|---|
| `PLANE_URL` | Base URL of the instance |
| `PLANE_API_KEY` | API key, sent as the `X-API-Key` header. Never print it |
| `PLANE_WORKSPACE_SLUG` | Workspace slug |
| `PLANE_PROJECT_ID` | Project UUID |
| `PLANE_PREFIX` | Prefix of the issue key, e.g. `FOO`. The key is `${PLANE_PREFIX}-<SEQUENCE_ID>`. Falls back to the project's `identifier` from the API |

## The API, as it actually behaves on this instance

Verified live, not from documentation:

- REST base is `${PLANE_URL}/api/v1`; authentication is the `X-API-Key` header.
- **Every filter parameter is ignored** — `?search=`, `?sequence_id=`, `?id=`,
  `?name=` and Django-style variants all return the same unfiltered list.
  `plane_search` therefore matches locally over the issue list.
- List pagination is `per_page` + `cursor`; the envelope carries `results` and
  `next_cursor`. `limit=` is not the parameter.
- One issue is fetched by key with
  `GET /workspaces/<slug>/work-items/<PREFIX>-<seq>/` and by UUID with
  `GET /workspaces/<slug>/projects/<project>/issues/<uuid>/`.
  `GET .../issues/<seq>/` does **not** work — the detail path wants a UUID.
- `?expand=state,assignees,labels` turns the id fields into objects with
  names. The tools use it.
- A comment is created with `POST .../work-items/<uuid>/comments/` and the body
  field `comment_html`; a state change is `PATCH .../work-items/<uuid>/` with
  `{"state": "<state-uuid>"}`.
- `/api/v2` is not served here — v1 only.
- The frontend-internal `/api/workspaces/...` endpoints reject API keys
  (`401`) and need a browser session. Never use them.

## Rules

1. **Writes need an explicit go-ahead.** `plane_comment` and `plane_set_status`
   change a shared tracker. Show the exact comment text or the target state and
   wait for the user to confirm in the conversation before calling them. This
   gate is prompt-level: no permission rule enforces it, so it is the agent's
   job to ask.
2. **Russian for what people read.** Issue titles, descriptions and comments go
   in Russian (AGENTS.md rule 7). English stays for code, specs, plans and
   anything only a developer reads. Quote an existing Russian title verbatim
   instead of translating it.
3. **Never print `PLANE_API_KEY`.** Not in a file, not in a command line that
   lands in a log, not in an issue or a comment.
4. **Use the tools, not hand-rolled `curl`/`fetch`.** They already handle
   pagination, id→name mapping, HTML stripping, truncation and the canonical
   issue URL. A raw request that reaches for `?search=` will silently return
   the wrong page.
5. **Never create an issue on your own.** Find the existing one first; a
   duplicate is worse than no issue. If a task really needs a new issue, ask
   the user first — creating one is an outward action.
6. **The issue id is the only path element.** SDD artefacts live in
   `.sdd/${PLANE_PREFIX}-<SEQUENCE_ID>/`. Never derive a path or a filename
   from an issue title.

## Issue text format

- **Title** — one line, Russian, starts with an action verb, no ids or file
  paths in it. The title is a pointer, not a spec.
- **Description** — three parts, in this order: `Что нужно` (what), `Почему`
  (why), `Критерии приёмки` (acceptance criteria, checkable).
- **Comment** — Russian, one topic per comment. State what changed and where,
  and link the artefact (`.sdd/<ISSUE_ID>/spec.md`) when there is one.

## The issue URL

`${PLANE_URL}/${PLANE_WORKSPACE_SLUG}/browse/${PLANE_PREFIX}-<SEQUENCE_ID>/`

`plane_get` and `plane_search` return this URL already resolved. Do not
construct it by hand — an archived issue has a different address, and the
tools know the difference.
