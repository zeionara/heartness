import { Plugin } from "@opencode/plugin"

type Json = Record<string, any>

const MAX_DESCRIPTION = 4000
const MAX_BODY = 10000
const MAX_DIFF = 4000
const MAX_DIFF_TOTAL = 20000
const LIST_PAGE_SIZE = 100
const LIST_MAX_PAGES = 10

interface GitlabConfig {
  url: string
  token: string
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new Error(
      `GitLab: environment variable ${name} is not set. Set it before using the gitlab tools (see the gitlab skill).`,
    )
  }
  return value.trim()
}

function config(): GitlabConfig {
  return {
    // GITLAB_URL carries no trailing slash: the API base is ${GITLAB_URL}/api/v4.
    url: requireEnv("GITLAB_URL").replace(/\/+$/, ""),
    token: requireEnv("GITLAB_TOKEN"),
  }
}

async function api(cfg: GitlabConfig, path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<any> {
  const headers: Record<string, string> = {
    "PRIVATE-TOKEN": cfg.token,
    Accept: "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  }
  if (init.body) headers["Content-Type"] = "application/json"

  const response = await fetch(`${cfg.url}/api/v4${path}`, { ...init, headers, signal })

  const text = await response.text()
  if (!response.ok) {
    let detail = text.slice(0, 300)
    try {
      const parsed = JSON.parse(text)
      detail = parsed.message ?? parsed.error ?? parsed.error_description ?? detail
    } catch {}
    if (response.status === 401) detail = "the token was rejected (check GITLAB_TOKEN)"
    if (response.status === 404) detail = `${detail} (not found or no access)`
    throw new Error(`GitLab API ${response.status} on ${path}: ${detail}`)
  }
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// "group/sub/project" path (URL-encoded with %2F, as GitLab requires for
// path-based ids) or a numeric project id, passed through as is.
function projectRef(project: string): string {
  const value = project.trim().replace(/^\/+|\/+$/g, "")
  if (/^\d+$/.test(value)) return value
  if (!value) throw new Error("GitLab: the project is empty. Use the group/project path or the numeric project id.")
  return encodeURIComponent(value)
}

// MR iid: "42" or "!42".
function mrIid(mr: string): number {
  const match = mr.trim().match(/^!?(\d+)$/)
  if (!match) throw new Error(`GitLab: cannot parse merge request reference "${mr}". Use the MR iid (42 or !42).`)
  return Number(match[1])
}

// Bare-array endpoints paginate with the page parameter and carry no
// pagination envelope, so the loop stops on a short page.
async function listAll(
  cfg: GitlabConfig,
  path: string,
  params: URLSearchParams,
  signal?: AbortSignal,
): Promise<Json[]> {
  const out: Json[] = []
  for (let page = 1; page <= LIST_MAX_PAGES; page++) {
    const query = new URLSearchParams({ per_page: String(LIST_PAGE_SIZE), page: String(page), ...params })
    const data = await api(cfg, `${path}?${query}`, {}, signal)
    if (!Array.isArray(data)) break
    out.push(...data)
    if (data.length < LIST_PAGE_SIZE) break
  }
  return out
}

function displayName(person: any): string {
  if (!person) return "unknown"
  if (typeof person === "string") return person
  const name = person.name ?? person.username ?? String(person.id ?? "")
  return person.username && person.username !== name ? `${name} (@${person.username})` : name
}

function truncate(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}\n…[truncated]` : text
}

// Frames the diff ref triple used to anchor comments to diff lines.
function diffRefs(issue: Json): Json {
  const refs = issue.diff_refs
  if (!refs?.base_sha || !refs?.head_sha || !refs?.start_sha) {
    throw new Error("GitLab: the merge request carries no diff_refs, cannot anchor a comment to a line")
  }
  return refs
}

export default Plugin.define({
  id: "gitlab",
  async setup(ctx: any) {
    await ctx.tool.transform((editor: any) => {
      editor.namespace({
        name: "gitlab",
        description: "Work with merge requests on the GitLab instance through the GitLab REST API.",
      })

      editor.add({
        name: "mr_list",
        description:
          "List merge requests in a GitLab project. Returns one compact line per MR: iid, state, title, author, URL. " +
          "Use it to find an MR iid before calling gitlab.mr_get.",
        input: {
          type: "object",
          properties: {
            project: {
              type: "string",
              description: 'Project: the "group/project" path (nested groups allowed) or the numeric project id.',
            },
            state: {
              type: "string",
              description: "Filter by state: opened (default), merged, closed or all.",
            },
            author: {
              type: "string",
              description: "Keep only MRs authored by this username (exact match).",
            },
            query: {
              type: "string",
              description:
                "Text to match against iid, title, description or author (case-insensitive substring). Omit to list all.",
            },
            limit: {
              type: "number",
              description: "Maximum number of MRs to return. Default 20, maximum 100.",
            },
          },
          required: ["project"],
          additionalProperties: false,
        },
        options: { codemode: true },
        execute: async (input: any, context: any) => {
          const cfg = config()
          const ref = projectRef(String(input.project))
          const limit = Math.min(Math.max(Number(input.limit ?? 20), 1), 100)
          const query = (input.query ?? "").toString().trim().toLowerCase()
          const state = (input.state ?? "opened").toString().trim() || "opened"

          const params = new URLSearchParams({ state, order_by: "updated_at" })
          if (input.author) params.set("author_username", String(input.author).replace(/^@/, ""))

          const all = await listAll(cfg, `/projects/${ref}/merge_requests`, params, context?.signal)
          const matches = all.filter((mr) => {
            if (!query) return true
            const haystack =
              `${mr.iid} ${mr.title ?? ""} ${mr.description ?? ""} ${mr.author?.username ?? ""} ${mr.author?.name ?? ""}`.toLowerCase()
            return haystack.includes(query)
          })

          if (!matches.length) {
            return {
              content:
                `No merge requests matched` +
                (query ? ` query "${query}"` : "") +
                (input.author ? ` by @${String(input.author).replace(/^@/, "")}` : "") +
                ` in state "${state}" (scanned ${all.length}).`,
            }
          }

          const lines = matches.slice(0, limit).map((mr: Json) => {
            const who = mr.author ? ` — ${displayName(mr.author)}` : ""
            return `!${mr.iid} [${mr.state}] ${mr.title ?? "(untitled)"}${who} — ${mr.web_url}`
          })
          const note = matches.length > limit ? ` (showing ${limit} of ${matches.length})` : ""
          return { content: `${lines.join("\n")}${note}` }
        },
      })

      editor.add({
        name: "mr_get",
        description:
          "Get one GitLab merge request by project and iid. Returns the title, state, author, source→target branches, description, " +
          "CI status, conflict flag, diff refs and the canonical URL. Use it before reading the diff or writing a comment.",
        input: {
          type: "object",
          properties: {
            project: {
              type: "string",
              description: 'Project: the "group/project" path or the numeric project id.',
            },
            mr: {
              type: "string",
              description: "Merge request iid (42 or !42).",
            },
          },
          required: ["project", "mr"],
          additionalProperties: false,
        },
        options: { codemode: true },
        execute: async (input: any, context: any) => {
          const cfg = config()
          const ref = projectRef(String(input.project))
          const iid = mrIid(String(input.mr))
          const mr = await api(cfg, `/projects/${ref}/merge_requests/${iid}`, {}, context?.signal)

          const lines = [
            `!${mr.iid} — ${mr.title ?? "(untitled)"}`,
            `state: ${mr.state}${mr.draft ? " [draft]" : ""}   conflicts: ${mr.has_conflicts ? "yes" : "no"}`,
            `author: ${displayName(mr.author)}   created: ${mr.created_at}`,
            `branches: ${mr.source_branch} → ${mr.target_branch}`,
          ]
          if (mr.labels?.length) lines.push(`labels: ${mr.labels.join(", ")}`)
          if (mr.head_pipeline?.status) lines.push(`pipeline: ${mr.head_pipeline.status}`)
          if (mr.merge_status) lines.push(`merge status: ${mr.merge_status}`)
          lines.push(`url: ${mr.web_url}`)
          const refs = mr.diff_refs
          if (refs?.head_sha) lines.push(`diff refs: base ${refs.base_sha} / start ${refs.start_sha} / head ${refs.head_sha}`)

          const description = String(mr.description ?? "").trim()
          if (description) {
            lines.push("", "description:", truncate(description, MAX_DESCRIPTION))
          }
          if (mr.merge_commit_sha) lines.push(``, `merged as ${mr.merge_commit_sha}`)
          return { content: lines.join("\n") }
        },
      })

      editor.add({
        name: "mr_diff",
        description:
          "Read the code changes of a GitLab merge request: per-file unified diffs. " +
          "Use it with the project's local checkout to understand and discuss the change.",
        input: {
          type: "object",
          properties: {
            project: {
              type: "string",
              description: 'Project: the "group/project" path or the numeric project id.',
            },
            mr: {
              type: "string",
              description: "Merge request iid (42 or !42).",
            },
          },
          required: ["project", "mr"],
          additionalProperties: false,
        },
        options: { codemode: true },
        execute: async (input: any, context: any) => {
          const cfg = config()
          const ref = projectRef(String(input.project))
          const iid = mrIid(String(input.mr))
          const files: Json[] = await api(cfg, `/projects/${ref}/merge_requests/${iid}/diffs`, {}, context?.signal)

          if (!Array.isArray(files) || !files.length) {
            return { content: `Merge request !${iid} has no file changes (maybe empty or already merged).` }
          }

          let total = 0
          const blocks: string[] = []
          for (const file of files) {
            let header = file.new_path ?? "(unknown path)"
            if (file.new_file) header += " [new file]"
            if (file.deleted_file) header += " [deleted]"
            if (file.renamed_file) header += ` [renamed from ${file.old_path}]`

            const diff = String(file.diff ?? "")
            if (!diff.trim()) {
              blocks.push(`--- ${header}\n[binary or no textual diff]`)
              continue
            }
            const shown = truncate(diff, MAX_DIFF)
            total += shown.length
            blocks.push(`--- ${header}\n${shown}`)
            if (total >= MAX_DIFF_TOTAL) {
              blocks.push(`…[diff truncated at ${MAX_DIFF_TOTAL} characters]`)
              break
            }
          }
          return { content: `!${iid} — ${files.length} file(s):\n\n${blocks.join("\n\n")}` }
        },
      })

      editor.add({
        name: "mr_comments",
        description:
          "Read all discussion threads on a GitLab merge request, oldest first: review comments with their file/line anchors, " +
          "replies and resolution state. System notes (approvals, pushes) are filtered out. Read-only.",
        input: {
          type: "object",
          properties: {
            project: {
              type: "string",
              description: 'Project: the "group/project" path or the numeric project id.',
            },
            mr: {
              type: "string",
              description: "Merge request iid (42 or !42).",
            },
          },
          required: ["project", "mr"],
          additionalProperties: false,
        },
        options: { codemode: true },
        execute: async (input: any, context: any) => {
          const cfg = config()
          const ref = projectRef(String(input.project))
          const iid = mrIid(String(input.mr))
          const threads = await listAll(
            cfg,
            `/projects/${ref}/merge_requests/${iid}/discussions`,
            new URLSearchParams(),
            context?.signal,
          )

          // A thread is human conversation only when at least one note is not
          // a system note; pure system threads (approvals, force pushes) drop out.
          const human = threads.filter((t) => Array.isArray(t.notes) && t.notes.some((n: Json) => !n.system))
          if (!human.length) {
            return { content: `No comments on merge request !${iid}.` }
          }
          human.sort((a, b) =>
            String(a.notes?.[0]?.created_at ?? "").localeCompare(String(b.notes?.[0]?.created_at ?? "")),
          )

          const blocks = human.map((thread, i) => {
            const notes = (thread.notes ?? []).filter((n: Json) => !n.system)
            const anchor: string[] = []
            for (const n of notes) {
              const p = n.position
              if (p?.new_path || p?.old_path) {
                const path = p.new_path || p.old_path
                const line = p.new_line ?? p.old_line
                anchor.push(`${path}${line != null ? `:${line}` : ""}`)
              }
            }
            const head = anchor.length
              ? `[${i + 1}] thread ${thread.id} — ${anchor.join(", ")}${thread.notes?.some((n: Json) => n.resolvable) ? (thread.notes.find((n: Json) => n.resolvable)?.resolved ? " — resolved" : " — unresolved") : ""}`
              : `[${i + 1}] thread ${thread.id}`
            const body = notes
              .map(
                (n: Json) =>
                  `- ${displayName(n.author)}, ${n.created_at}\n${truncate(String(n.body ?? ""), MAX_DESCRIPTION)}`,
              )
              .join("\n")
            return `${head}\n${body}`
          })
          return { content: `!${iid} — ${human.length} thread(s):\n\n${blocks.join("\n\n")}` }
        },
      })

      editor.add({
        name: "mr_comment",
        description:
          "Post a comment on a GitLab merge request: a plain comment, a reply inside a thread, or a review comment anchored " +
          "to a diff line (which makes a ```suggestion block applicable via the Apply suggestion button). " +
          "This writes to a shared code-review surface — confirm the exact text with the user before calling it. " +
          "Write the comment in Russian unless the user asks otherwise.",
        input: {
          type: "object",
          properties: {
            project: {
              type: "string",
              description: 'Project: the "group/project" path or the numeric project id.',
            },
            mr: {
              type: "string",
              description: "Merge request iid (42 or !42).",
            },
            body: {
              type: "string",
              description:
                "Comment body in Markdown. A ```suggestion fence here replaces exactly the line(s) the comment is anchored to.",
            },
            reply_to: {
              type: "string",
              description:
                "Reply inside an existing thread instead of starting a new one: the discussion id (from gitlab.mr_comments) or any note id in it.",
            },
            file: {
              type: "string",
              description:
                "Anchor the comment to a diff line: the file path as it appears in the MR diff (new_path). Requires new_line or old_line.",
            },
            new_line: {
              type: "number",
              description: "Line number in the new version of the file (for added or changed lines).",
            },
            old_line: {
              type: "number",
              description: "Line number in the old version of the file (for removed lines).",
            },
          },
          required: ["project", "mr", "body"],
          additionalProperties: false,
        },
        options: { codemode: true },
        execute: async (input: any, context: any) => {
          const cfg = config()
          const ref = projectRef(String(input.project))
          const iid = mrIid(String(input.mr))
          const body = String(input.body ?? "").trim()
          if (!body) throw new Error("GitLab: the comment body is empty")
          if (body.length > MAX_BODY) {
            throw new Error(`GitLab: the comment body is ${body.length} characters, the limit is ${MAX_BODY}`)
          }

          const anchored = Boolean(input.file || input.new_line != null || input.old_line != null)
          if (anchored && !input.file) {
            throw new Error("GitLab: anchoring requires the file path (new_path in the MR diff)")
          }
          if (input.file && input.new_line == null && input.old_line == null) {
            throw new Error("GitLab: anchoring requires new_line (new version) or old_line (old version)")
          }

          const mr = await api(cfg, `/projects/${ref}/merge_requests/${iid}`, {}, context?.signal)
          const url = String(mr.web_url ?? `${cfg.url}/${decodeURIComponent(ref)}/-/merge_requests/${iid}`)

          // Reply path: resolve the discussion id, then append a note to it.
          if (input.reply_to != null) {
            const wanted = String(input.reply_to).trim()
            const threads = await listAll(
              cfg,
              `/projects/${ref}/merge_requests/${iid}/discussions`,
              new URLSearchParams(),
              context?.signal,
            )
            const thread = threads.find(
              (t) =>
                String(t.id) === wanted ||
                (Array.isArray(t.notes) && t.notes.some((n: Json) => String(n.id) === wanted)),
            )
            if (!thread) {
              throw new Error(
                `GitLab: no discussion matches reply_to "${wanted}" on !${iid}. Take the id from gitlab.mr_comments output.`,
              )
            }
            const note = await api(
              cfg,
              `/projects/${ref}/merge_requests/${iid}/discussions/${thread.id}/notes`,
              { method: "POST", body: JSON.stringify({ body }) },
              context?.signal,
            )
            return {
              content: `Reply posted in thread ${thread.id} on !${iid}: ${url}${note?.id ? `\nnote id: ${note.id}` : ""}`,
            }
          }

          // Anchored path: a review comment bound to a diff line, which turns
          // a ```suggestion fence into an applicable suggestion. This instance
          // silently drops `position` on POST /notes (verified live); only
          // POST /discussions stores it, so anchoring always opens a thread.
          let payload: Json = { body }
          let path = `/projects/${ref}/merge_requests/${iid}/notes`
          if (anchored) {
            const refs = diffRefs(mr)
            const position: Json = {
              position_type: "text",
              base_sha: refs.base_sha,
              head_sha: refs.head_sha,
              start_sha: refs.start_sha,
              new_path: String(input.file),
              old_path: String(input.file),
            }
            if (input.new_line != null) position.new_line = Number(input.new_line)
            if (input.old_line != null) position.old_line = Number(input.old_line)
            payload.position = position
            path = `/projects/${ref}/merge_requests/${iid}/discussions`
          }

          const created = await api(cfg, path, { method: "POST", body: JSON.stringify(payload) })
          const noteId = created?.notes?.[0]?.id ?? created?.id
          const threadId = anchored ? created?.id : undefined
          return {
            content:
              `Comment posted on !${iid}${threadId ? ` (thread ${threadId})` : ""}: ${url}` +
              (noteId ? `\nnote id: ${noteId}` : ""),
          }
        },
      })
    })
  },
})
