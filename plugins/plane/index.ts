import { Plugin } from "@opencode/plugin"

type Json = Record<string, any>

const MAX_DESCRIPTION = 4000
const MAX_COMMENT = 10000
const SEARCH_PAGE_SIZE = 200
const SEARCH_MAX_PAGES = 20

interface PlaneConfig {
  url: string
  apiKey: string
  workspace: string
  project: string
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new Error(
      `Plane: environment variable ${name} is not set. Set it before using the plane tools (see the plane skill).`,
    )
  }
  return value.trim()
}

function config(): PlaneConfig {
  return {
    // PLANE_URL carries no trailing slash: a doubled slash breaks the API base.
    url: requireEnv("PLANE_URL").replace(/\/+$/, ""),
    apiKey: requireEnv("PLANE_API_KEY"),
    workspace: requireEnv("PLANE_WORKSPACE_SLUG"),
    project: requireEnv("PLANE_PROJECT_ID"),
  }
}

async function api(cfg: PlaneConfig, path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<any> {
  const headers: Record<string, string> = {
    "X-API-Key": cfg.apiKey,
    Accept: "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  }
  if (init.body) headers["Content-Type"] = "application/json"

  const response = await fetch(`${cfg.url}/api/v1${path}`, { ...init, headers, signal })

  const text = await response.text()
  if (!response.ok) {
    let detail = text.slice(0, 300)
    try {
      const parsed = JSON.parse(text)
      detail = parsed.error ?? parsed.detail ?? detail
    } catch {}
    if (response.status === 401) detail = "the API key was rejected (check PLANE_API_KEY)"
    if (response.status === 404) detail = `${detail} (not found)`
    throw new Error(`Plane API ${response.status} on ${path}: ${detail}`)
  }
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

let prefixCache: string | null = null

async function projectPrefix(cfg: PlaneConfig, signal?: AbortSignal): Promise<string> {
  const fromEnv = process.env.PLANE_PREFIX?.trim()
  if (fromEnv) return fromEnv.toUpperCase()
  if (prefixCache) return prefixCache
  const project = await api(cfg, `/workspaces/${cfg.workspace}/projects/${cfg.project}/`, {}, signal)
  if (!project?.identifier) throw new Error("Plane: could not resolve the project identifier (PLANE_PREFIX is unset)")
  prefixCache = String(project.identifier).toUpperCase()
  return prefixCache
}

function issueUrl(cfg: PlaneConfig, prefix: string, sequenceId: number): string {
  return `${cfg.url}/${cfg.workspace}/browse/${prefix}-${sequenceId}/`
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return ""
  const text = html
    .replace(/<image-component[^>]*>/g, " [image] ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
  return text.replace(/\n{3,}/g, "\n\n").trim()
}

function displayName(person: any): string {
  if (!person) return ""
  if (typeof person === "string") return person
  const full = [person.first_name, person.last_name].filter(Boolean).join(" ").trim()
  // Prefer the real name: on some instances display_name is the email local part.
  return full || person.display_name || person.email || person.id
}

function expandedState(issue: Json): string {
  const state = issue.state
  if (state && typeof state === "object" && state.name) return state.name
  return state ? String(state) : "unknown"
}

function stateNames(issue: Json): string[] {
  const labels = issue.labels
  if (!Array.isArray(labels)) return []
  return labels
    .map((label: any) => (typeof label === "object" && label?.name ? label.name : null))
    .filter(Boolean) as string[]
}

function assigneeNames(issue: Json): string[] {
  const assignees = issue.assignees
  if (!Array.isArray(assignees)) return []
  return assignees.map((person: any) => displayName(person)).filter(Boolean)
}

async function resolveIssue(cfg: PlaneConfig, ref: string, signal?: AbortSignal) {
  const prefix = await projectPrefix(cfg, signal)
  const value = ref.trim()

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    const issue = await api(
      cfg,
      `/workspaces/${cfg.workspace}/projects/${cfg.project}/issues/${value}/?expand=state,assignees,labels`,
      {},
      signal,
    )
    return { issue, prefix }
  }

  const match = value.match(/^([A-Za-z]*)-?(\d+)$/)
  if (!match) {
    throw new Error(
      `Plane: cannot parse issue reference "${ref}". Use the issue key (${prefix}-123), the sequence number (123) or the issue UUID.`,
    )
  }
  const key = match[1] ? `${match[1].toUpperCase()}-${match[2]}` : `${prefix}-${match[2]}`
  const issue = await api(
    cfg,
    `/workspaces/${cfg.workspace}/work-items/${key}/?expand=state,assignees,labels`,
    {},
    signal,
  )
  return { issue, prefix }
}

function formatIssue(cfg: PlaneConfig, issue: Json, prefix: string): string {
  const sequenceId = issue.sequence_id
  const key = `${prefix}-${sequenceId}`
  const lines = [
    `${key} — ${issue.name ?? "(untitled)"}`,
    `state: ${expandedState(issue)}   priority: ${issue.priority ?? "none"}`,
  ]
  const assignees = assigneeNames(issue)
  if (assignees.length) lines.push(`assignees: ${assignees.join(", ")}`)
  const labels = stateNames(issue)
  if (labels.length) lines.push(`labels: ${labels.join(", ")}`)
  if (issue.created_at) lines.push(`created: ${issue.created_at}`)
  if (issue.updated_at) lines.push(`updated: ${issue.updated_at}`)
  lines.push(`url: ${issueUrl(cfg, prefix, sequenceId)}`)

  const description = stripHtml(issue.description_html ?? issue.description)
  if (description) {
    lines.push("")
    lines.push("description:")
    lines.push(description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION)}\n…[truncated]` : description)
  }
  return lines.join("\n")
}

async function listStates(cfg: PlaneConfig, signal?: AbortSignal) {
  const data = await api(cfg, `/workspaces/${cfg.workspace}/projects/${cfg.project}/states/`, {}, signal)
  return (data?.results ?? []) as Json[]
}

function describeStates(states: Json[]): string {
  return states.map((s) => `${s.name} (${s.group ?? "?"})`).join(", ")
}

export default Plugin.define({
  id: "plane",
  async setup(ctx: any) {
    // The issue-key prefix is never written into this file: it is read from
    // PLANE_PREFIX at run time, and falls back to a generic placeholder.
    const prefixHint = process.env.PLANE_PREFIX?.trim() || "<PREFIX>"
    const keyHint = `${prefixHint}-123`

    await ctx.tool.transform((editor: any) => {
      editor.namespace({
        name: "plane",
        description: "Read and update Plane issues through the Plane REST API.",
      })

      editor.add({
        name: "search",
        description:
          "Search issues in the configured Plane project. The API ignores filters, so matching happens locally over the issue list. " +
          "Returns one compact line per issue: key, state, title, assignees, URL. Use it to find an issue key before calling plane_get.",
        input: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Text to match against the issue key, sequence id or title (case-insensitive substring). Omit to list issues.",
            },
            state: {
              type: "string",
              description: "Keep only issues in this state, by state name (case-insensitive) or state id.",
            },
            limit: {
              type: "number",
              description: "Maximum number of issues to return. Default 20, maximum 100.",
            },
          },
          additionalProperties: false,
        },
        options: { codemode: true },
        execute: async (input: any, context: any) => {
          const cfg = config()
          const limit = Math.min(Math.max(Number(input.limit ?? 20), 1), 100)
          const query = (input.query ?? "").toString().trim().toLowerCase()
          const stateFilter = (input.state ?? "").toString().trim().toLowerCase()

          const states = await listStates(cfg, context?.signal)
          const stateById = new Map(states.map((s) => [String(s.id), String(s.name ?? "").toLowerCase()]))
          const prefix = await projectPrefix(cfg, context?.signal)

          const matches: Json[] = []
          let scanned = 0
          let cursor: string | undefined
          for (let page = 0; page < SEARCH_MAX_PAGES; page++) {
            const params = new URLSearchParams({ per_page: String(SEARCH_PAGE_SIZE) })
            if (cursor) params.set("cursor", cursor)
            const data = await api(
              cfg,
              `/workspaces/${cfg.workspace}/projects/${cfg.project}/issues/?${params}`,
              {},
              context?.signal,
            )
            const results: Json[] = data?.results ?? []
            scanned += results.length
            for (const issue of results) {
              const key = `${prefix}-${issue.sequence_id}`
              const stateName = stateById.get(String(issue.state)) ?? ""
              if (query) {
                const haystack = `${key} ${issue.sequence_id} ${issue.name ?? ""}`.toLowerCase()
                if (!haystack.includes(query)) continue
              }
              if (stateFilter && stateName !== stateFilter.toLowerCase() && String(issue.state) !== stateFilter) continue
              matches.push(issue)
              if (matches.length >= limit) break
            }
            if (matches.length >= limit) break
            cursor = data?.next_cursor ?? undefined
            if (!cursor || results.length === 0) break
          }

          if (!matches.length) {
            return {
              content:
                `No issues matched` +
                (query ? ` query "${query}"` : "") +
                (stateFilter ? ` in state "${input.state}"` : "") +
                ` (scanned ${scanned} issues).`,
            }
          }

          const memberNames = new Map<string, string>()
          if (matches.some((issue) => Array.isArray(issue.assignees) && issue.assignees.length)) {
            const members = await api(cfg, `/workspaces/${cfg.workspace}/members/`, {}, context?.signal)
            for (const member of Array.isArray(members) ? members : []) {
              memberNames.set(String(member.id), displayName(member))
            }
          }

          const lines = matches.map((issue) => {
            const key = `${prefix}-${issue.sequence_id}`
            const stateName = stateById.get(String(issue.state)) ?? String(issue.state ?? "unknown")
            const assignees = Array.isArray(issue.assignees)
              ? issue.assignees.map((id: string) => memberNames.get(String(id)) ?? String(id)).filter(Boolean)
              : []
            const who = assignees.length ? ` — ${assignees.join(", ")}` : ""
            return `${key} [${stateName}] ${issue.name ?? "(untitled)"}${who} — ${issueUrl(cfg, prefix, issue.sequence_id)}`
          })

          const scannedNote = matches.length >= limit ? ` (showing ${limit} of ${scanned} scanned)` : ` (scanned ${scanned})`
          return { content: `${lines.join("\n")}${scannedNote}` }
        },
      })

      editor.add({
        name: "get",
        description:
          `Get one Plane issue by key (${keyHint}), sequence number (123) or UUID. Returns the title, state, priority, assignees, labels, description as plain text and the canonical issue URL. Use it before changing anything.`,
        input: {
          type: "object",
          properties: {
            issue: {
              type: "string",
              description: `Issue key (${keyHint}), sequence number (123) or issue UUID.`,
            },
          },
          required: ["issue"],
          additionalProperties: false,
        },
        options: { codemode: true },
        execute: async (input: any, context: any) => {
          const cfg = config()
          const { issue, prefix } = await resolveIssue(cfg, String(input.issue), context?.signal)
          return { content: formatIssue(cfg, issue, prefix) }
        },
      })

      editor.add({
        name: "comment",
        description:
          "Post a comment on a Plane issue. This writes to a shared tracker — confirm the exact text with the user before calling it. Write the comment body in Russian unless the user asks otherwise.",
        input: {
          type: "object",
          properties: {
            issue: {
              type: "string",
              description: `Issue key (${keyHint}), sequence number (123) or issue UUID.`,
            },
            body: {
              type: "string",
              description: "Comment body in plain text. Paragraphs are separated by blank lines.",
            },
          },
          required: ["issue", "body"],
          additionalProperties: false,
        },
        options: { codemode: true },
        execute: async (input: any, context: any) => {
          const cfg = config()
          const body = String(input.body ?? "").trim()
          if (!body) throw new Error("Plane: the comment body is empty")
          if (body.length > MAX_COMMENT) {
            throw new Error(`Plane: the comment body is ${body.length} characters, the limit is ${MAX_COMMENT}`)
          }
          const { issue, prefix } = await resolveIssue(cfg, String(input.issue), context?.signal)

          const paragraphs = body
            .split(/\n{2,}/)
            .map((paragraph) => paragraph.trim())
            .filter(Boolean)
            .map(
              (paragraph) =>
                `<p>${paragraph
                  .replace(/&/g, "&amp;")
                  .replace(/</g, "&lt;")
                  .replace(/>/g, "&gt;")
                  .replace(/\n/g, "<br>")}</p>`,
            )
            .join("")

          const comment = await api(
            cfg,
            `/workspaces/${cfg.workspace}/projects/${cfg.project}/work-items/${issue.id}/comments/`,
            { method: "POST", body: JSON.stringify({ comment_html: paragraphs }) },
            context?.signal,
          )
          const key = `${prefix}-${issue.sequence_id}`
          return {
            content: `Comment posted on ${key}: ${issueUrl(cfg, prefix, issue.sequence_id)}${
              comment?.id ? `\ncomment id: ${comment.id}` : ""
            }`,
          }
        },
      })

      editor.add({
        name: "set_status",
        description:
          "Move a Plane issue to another workflow state. This writes to a shared tracker — confirm the target state with the user before calling it. The state name is resolved against the project's live states.",
        input: {
          type: "object",
          properties: {
            issue: {
              type: "string",
              description: `Issue key (${keyHint}), sequence number (123) or issue UUID.`,
            },
            status: {
              type: "string",
              description:
                "Target state name. Matched exactly (case-insensitive) against the project's live workflow states; an unknown name comes back as an error listing the available states.",
            },
          },
          required: ["issue", "status"],
          additionalProperties: false,
        },
        options: { codemode: true },
        execute: async (input: any, context: any) => {
          const cfg = config()
          const wanted = String(input.status ?? "").trim().toLowerCase()
          if (!wanted) throw new Error("Plane: the target status is empty")

          const states = await listStates(cfg, context?.signal)
          // Exact name match only: a substring match can pick an unintended
          // state (a short fragment of one state name is a substring of another).
          const matches = states.filter((s) => String(s.name ?? "").toLowerCase() === wanted)
          if (!matches.length) {
            throw new Error(`Plane: no state matches "${input.status}". Available states: ${describeStates(states)}`)
          }
          if (matches.length > 1) {
            throw new Error(
              `Plane: "${input.status}" matches ${matches.length} states (${matches
                .map((s) => s.name)
                .join(", ")}). Use the exact name.`,
            )
          }
          const target = matches[0]

          const { issue, prefix } = await resolveIssue(cfg, String(input.issue), context?.signal)
          await api(
            cfg,
            `/workspaces/${cfg.workspace}/projects/${cfg.project}/work-items/${issue.id}/`,
            { method: "PATCH", body: JSON.stringify({ state: target.id }) },
            context?.signal,
          )
          const key = `${prefix}-${issue.sequence_id}`
          return {
            content: `${key} moved to "${target.name}" (${target.group ?? "?"}): ${issueUrl(cfg, prefix, issue.sequence_id)}`,
          }
        },
      })
    })
  },
})
