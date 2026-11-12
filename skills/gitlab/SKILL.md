---
name: GitLab
description: Review and work with merge requests on the GitLab instance — list MRs, read diffs and discussion threads, analyze review comments, post replies and applicable code suggestions. Use when the task is a GitLab merge request review, when the user asks to respond to MR comments, or when review feedback has to turn into code changes.
---

# GitLab

The code-review surface for enterprise projects. Five tools, all backed by the
instance REST API by the plugin in `~/.config/opencode/plugins/gitlab`
(auto-loaded, no config entry needed).

## Tools

| Tool | Use it for | Writes? |
|---|---|---|
| `gitlab_mr_list` | find MRs in a project by state, author or text | no |
| `gitlab_mr_get` | full detail of one MR: state, branches, description, diff refs, pipeline | no |
| `gitlab_mr_diff` | per-file unified diffs of the MR | no |
| `gitlab_mr_comments` | all discussion threads, oldest first, with file/line anchors | no |
| `gitlab_mr_comment` | post a comment, a reply in a thread, or a comment anchored to a diff line | **yes** |

`gitlab_mr_list` takes `project` (required) and optional `state` (default
`opened`), `author` (username), `query` (substring over iid, title,
description, author) and `limit` (default 20, max 100).
`gitlab_mr_get`, `gitlab_mr_diff` and `gitlab_mr_comments` take `project` and
`mr` (the iid, `42` or `!42`). `gitlab_mr_comment` takes `project`, `mr`,
`body` (Markdown), plus at most one of:
- `reply_to` — discussion id or any note id in the thread, from
  `gitlab_mr_comments` output;
- `file` + `new_line` (or `old_line` for removed lines) — anchors the comment
  to a diff line, which turns a ` ```suggestion ` block into an applicable
  suggestion.

## Environment

The tools read these at call time. They are never written into a file.

| Variable | Meaning |
|---|---|
| `GITLAB_URL` | Base URL of the instance, no trailing slash. The REST base is `${GITLAB_URL}/api/v4` |
| `GITLAB_TOKEN` | Personal access token, sent as the `PRIVATE-TOKEN` header. Never print it |

`project` is the `group/project` path (nested groups allowed) or the numeric
project id. Take it from the repository's origin remote or the task context —
never guess it from a title.

## The API, as it actually behaves on this instance

Verified live on GitLab 19.0.1, not from documentation:

- Auth is the `PRIVATE-TOKEN` header (Bearer works too; the tools use
  PRIVATE-TOKEN).
- Bare-array endpoints (`merge_requests`, `diffs`, `discussions`) paginate
  with `page` + `per_page` and carry no pagination envelope — the tools stop
  on a short page.
- `GET .../merge_requests/:iid` carries `diff_refs` (`base_sha`, `start_sha`,
  `head_sha`) — the triple needed to anchor a comment to a diff line.
- **`POST .../notes` silently drops a nested `position`** — the note is
  created unanchored, with HTTP 201 and no error. Anchored comments must go
  through `POST .../discussions` with the same `body` + `position` object;
  that stores the position. The tools handle this: an anchored
  `gitlab_mr_comment` always opens a thread.
- A reply is `POST .../discussions/:discussion_id/notes` with `{"body": ...}`.
- `position` is `{position_type: "text", base_sha, start_sha, head_sha,
  new_path, old_path, new_line?, old_line?}`. A wrong line or path is
  rejected; a correct one comes back stored verbatim.
- Server-side filters (`state=`, `author_username=`) work here, unlike the
  Plane instance; `query` matching for `gitlab_mr_list` is still done
  locally over iid/title/description/author.
- Discussion threads group notes; each note has `system` (approvals, pushes —
  filtered out by `gitlab_mr_comments`), `resolvable` and `resolved`.

## Suggestion format

A review suggestion is a comment anchored to a diff line whose body contains
a ` ```suggestion ` fence:

````markdown
Нужно исправить условие:

```suggestion
    return a - b
```
````

- The fence content replaces **exactly** the line(s) the comment is anchored
  to. Keep the original indentation inside the fence — GitLab aligns it with
  the target line on apply.
- One anchored comment carries one suggestion. For several changes, post
  several anchored comments, each on its own line.
- Before proposing, read the surrounding code: `gitlab_mr_diff` for the
  change and the local checkout for context. A suggestion that does not
  compile is worse than a question.
- Multi-line replacements (anchoring a whole range via `line_range`) are not
  supported by the tools yet — for those, describe the change in a reply
  instead.

## Rules

1. **Writes need an explicit go-ahead.** `gitlab_mr_comment` writes to a
   shared review thread. Show the exact comment text (and the anchor or
   reply target) and wait for the user to confirm in the conversation before
   calling it. This gate is prompt-level; it is the agent's job to ask.
2. **Russian for what people read.** MR comments and replies go in Russian
   (AGENTS.md rule 7). Code, commands, fences and identifiers stay as they
   are. Quote an existing Russian text verbatim instead of translating it.
3. **Never print `GITLAB_TOKEN`.** Not in a file, not in a command line, not
   in a comment.
4. **Use the tools, not hand-rolled `curl`/`fetch`.** They already handle
   pagination, path encoding, the notes-vs-discussions position quirk and
   the canonical MR URL.
5. **Read before you write.** `gitlab_mr_comments` first: never answer a
   point another comment already settled, and never repeat a suggestion
   that was applied.

## Workflow

1. `gitlab_mr_list` to find the MR (project from the task context).
2. `gitlab_mr_get` + `gitlab_mr_diff` to understand the change; read the
   project's local checkout for the full picture.
3. `gitlab_mr_comments` to read every thread, including replies and anchors.
4. For each point: reply with the analysis, or propose a fix — a reply plus
   an anchored ` ```suggestion ` on the exact line.
5. Show the user every text before posting; one confirmed
   `gitlab_mr_comment` per point, then link the MR URL in the summary.
