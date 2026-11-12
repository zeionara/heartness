import { Plugin } from "@opencode/plugin"

type Json = Record<string, any>

// One limit for read truncation in get and the write cap in set_description,
// so a description written through the tools always displays in full.
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

function unescapeHtml(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

// Renders stored HTML back to the Markdown the tools accept, so issue text
// written through the tools reads back in the shape it was written.
function stripHtml(html: string | null | undefined): string {
  if (!html) return ""
  const fences: string[] = []
  const text = html
    .replace(/<image-component[^>]*>/g, " [image] ")
    .replace(
      /<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/gi,
      (_, attrs: string, code: string) => {
        const lang = (attrs.match(/class="language-([^"]*)"/) ?? [])[1]
        fences.push(`\`\`\`${lang ?? ""}\n${unescapeHtml(code)}\n\`\`\``)
        return `\x00fence${fences.length - 1}\x00`
      },
    )
    .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner: string) =>
      inner.replace(/<li[^>]*>/gi, "- ").replace(/<\/li>\s*/gi, "\n") + "\n",
    )
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner: string) => {
      let n = 0
      return inner.replace(/<li[^>]*>/gi, () => `${++n}. `).replace(/<\/li>\s*/gi, "\n") + "\n"
    })
    .replace(/<h([1-6])[^>]*>/gi, (_, level: string) => `${"#".repeat(Number(level))} `)
    .replace(/<\/h[1-6]>\s*/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*/gi, "\n\n")
    .replace(/<hr\s*\/?>/gi, "\n---\n\n")
    .replace(/<\/?(blockquote|strong|em|s|a)(\s[^>]*)?>/gi, "")
    .replace(/<\/?code[^>]*>/gi, "`")
    .replace(/<[^>]+>/g, "")
  const collapsed = unescapeHtml(text).replace(/\n{3,}/g, "\n\n").trim()
  return collapsed.replace(/\x00fence(\d+)\x00/g, (_, i: string) => fences[Number(i)])
}

// Inline Markdown → HTML. Code spans and links are extracted first so their
// content never meets the emphasis rules; \x00 atoms hold the finished HTML.
function inlineMarkdown(text: string): string {
  const atoms: string[] = []
  let s = text.replace(/`([^`]+)`/g, (_, code: string) => {
    atoms.push(`<code>${escapeHtml(code)}</code>`)
    return `\x00atom${atoms.length - 1}\x00`
  })
  s = s.replace(/\[([^\]]+)\]\(([^()\s]+)\)/g, (_, label: string, url: string) => {
    atoms.push(`<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`)
    return `\x00atom${atoms.length - 1}\x00`
  })
  s = escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^\s*][^*]*?)\*/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
  return s.replace(/\x00atom(\d+)\x00/g, (_, i: string) => atoms[Number(i)])
}

// Markdown → the HTML dialect the Plane editor keeps (verified live: h1–h6,
// strong/em/s, code, pre>code, ul/ol items, a[href], blockquote, hr).
// Supported source: # headings, blank-line paragraphs, `code`, **bold**,
// *italic*, ~~strike~~, fenced code blocks, - / 1. lists, > quotes,
// [links](url) and --- rules.
function markdownToPlaneHtml(text: string): string {
  const out: string[] = []
  let para: string[] = []
  let quote: string[] = []
  let list: { tag: "ul" | "ol"; items: string[] } | null = null
  let fence: { lang: string; body: string[] } | null = null

  const flush = () => {
    if (para.length) out.push(`<p>${para.map((line) => inlineMarkdown(line)).join("<br>")}</p>`)
    para = []
    if (list) {
      out.push(`<${list.tag}>${list.items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</${list.tag}>`)
      list = null
    }
    if (quote.length) {
      out.push(`<blockquote><p>${quote.map((line) => inlineMarkdown(line)).join("<br>")}</p></blockquote>`)
      quote = []
    }
  }

  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (fence) {
      if (/^\s*```/.test(raw)) {
        const attrs = fence.lang ? ` class="language-${escapeHtml(fence.lang)}"` : ""
        out.push(`<pre><code${attrs}>${escapeHtml(fence.body.join("\n"))}</code></pre>`)
        fence = null
      } else {
        fence.body.push(raw)
      }
      continue
    }
    const fenceStart = raw.match(/^\s*```(\S*)\s*$/)
    if (fenceStart) {
      flush()
      fence = { lang: fenceStart[1], body: [] }
      continue
    }
    if (!raw.trim()) {
      flush()
      continue
    }
    const heading = raw.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      flush()
      const level = heading[1].length
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
      continue
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) {
      flush()
      out.push("<hr>")
      continue
    }
    const bullet = raw.match(/^\s*[-*]\s+(.+)$/)
    if (bullet) {
      if (!list || list.tag !== "ul") {
        flush()
        list = { tag: "ul", items: [] }
      }
      list.items.push(bullet[1])
      continue
    }
    const numbered = raw.match(/^\s*\d+[.)]\s+(.+)$/)
    if (numbered) {
      if (!list || list.tag !== "ol") {
        flush()
        list = { tag: "ol", items: [] }
      }
      list.items.push(numbered[1])
      continue
    }
    const quoted = raw.match(/^>\s?(.*)$/)
    if (quoted) {
      if (!quote.length) flush()
      quote.push(quoted[1])
      continue
    }
    flush()
    para.push(raw.trimEnd())
  }
  if (fence) {
    const attrs = fence.lang ? ` class="language-${escapeHtml(fence.lang)}"` : ""
    out.push(`<pre><code${attrs}>${escapeHtml(fence.body.join("\n"))}</code></pre>`)
    fence = null
  }
  flush()
  return out.join("")
}

function displayName(person: any): string {
  if (!person) return ""
  if (typeof person === "string") return person
  const full = [person.first_name, person.last_name].filter(Boolean).join(" ").trim()
  // Prefer the real name: on some instances display_name is the email local part.
  return full || person.display_name || person.email || person.id
}

// Workspace member id → display name; ids outside the workspace stay raw.
async function fetchMemberNames(cfg: PlaneConfig, signal?: AbortSignal): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  const members = await api(cfg, `/workspaces/${cfg.workspace}/members/`, {}, signal)
  for (const member of Array.isArray(members) ? members : []) {
    names.set(String(member.id), displayName(member))
  }
  return names
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

          const memberNames = matches.some((issue) => Array.isArray(issue.assignees) && issue.assignees.length)
            ? await fetchMemberNames(cfg, context?.signal)
            : new Map<string, string>()

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
          `Get one Plane issue by key (${keyHint}), sequence number (123) or UUID. Returns the title, state, priority, assignees, labels, the description converted back to Markdown and the canonical issue URL. Use it before changing anything.`,
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
        name: "list_comments",
        description:
          `List all comments on a Plane issue by key (${keyHint}), sequence number (123) or UUID, oldest first. ` +
          "Each comment shows the author, creation time and the body converted back to Markdown. Read-only, use it to catch up on a discussion before writing.",
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

          const comments: Json[] = []
          let cursor: string | undefined
          for (let page = 0; page < SEARCH_MAX_PAGES; page++) {
            const params = new URLSearchParams({ per_page: String(SEARCH_PAGE_SIZE) })
            if (cursor) params.set("cursor", cursor)
            const data = await api(
              cfg,
              `/workspaces/${cfg.workspace}/projects/${cfg.project}/work-items/${issue.id}/comments/?${params}`,
              {},
              context?.signal,
            )
            const results: Json[] = data?.results ?? []
            comments.push(...results)
            cursor = data?.next_cursor ?? undefined
            // This endpoint emits next_cursor even on the last page;
            // next_page_results === false marks it and skips a wasted fetch.
            if (!cursor || results.length === 0 || data?.next_page_results === false) break
          }

          const key = `${prefix}-${issue.sequence_id}`
          const url = issueUrl(cfg, prefix, issue.sequence_id)
          if (!comments.length) return { content: `No comments on ${key}: ${url}` }

          comments.sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))
          const memberNames = await fetchMemberNames(cfg, context?.signal)

          const blocks = comments.map((comment, i) => {
            const actor = comment.actor
            const author = typeof actor === "string" ? (memberNames.get(actor) ?? actor) : displayName(actor)
            const when = String(comment.created_at ?? "unknown time")
            const body = stripHtml(comment.comment_html)
            const shown = body.length > MAX_DESCRIPTION ? `${body.slice(0, MAX_DESCRIPTION)}\n…[truncated]` : body
            return `[${i + 1}] ${author}, ${when}\n${shown}`
          })
          return { content: `${key} — ${comments.length} comment(s): ${url}\n\n${blocks.join("\n\n")}` }
        },
      })

      editor.add({
        name: "comment",
        description:
          "Post a comment on a Plane issue. This writes to a shared tracker — confirm the exact text with the user before calling it. " +
          "The body is Markdown (`##` headings, `code` for field names, fenced code blocks, **bold**, lists). " +
          "Write the comment in Russian unless the user asks otherwise.",
        input: {
          type: "object",
          properties: {
            issue: {
              type: "string",
              description: `Issue key (${keyHint}), sequence number (123) or issue UUID.`,
            },
            body: {
              type: "string",
              description:
                "Comment body in Markdown. Blank lines separate paragraphs; `##` headings, `code` for field names, fenced code blocks, **bold** and lists are rendered.",
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

          const paragraphs = markdownToPlaneHtml(body)

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
        name: "set_description",
        description:
          "Replace the description of a Plane issue. This replaces the whole description, not appends to it, and an empty text is rejected. " +
          "The body is Markdown (`##` headings, `code` for field names, fenced code blocks, **bold**, lists). This writes to a shared tracker — " +
          "confirm the exact text with the user before calling it. Write the description in Russian unless the user asks otherwise.",
        input: {
          type: "object",
          properties: {
            issue: {
              type: "string",
              description: `Issue key (${keyHint}), sequence number (123) or issue UUID.`,
            },
            description: {
              type: "string",
              description:
                "New description body in Markdown. Blank lines separate paragraphs; `##` headings, `code` for field names, fenced code blocks, **bold** and lists are rendered. Replaces the existing description entirely.",
            },
          },
          required: ["issue", "description"],
          additionalProperties: false,
        },
        options: { codemode: true },
        execute: async (input: any, context: any) => {
          const cfg = config()
          const body = String(input.description ?? "").trim()
          if (!body) throw new Error("Plane: the description is empty")
          if (body.length > MAX_DESCRIPTION) {
            throw new Error(`Plane: the description is ${body.length} characters, the limit is ${MAX_DESCRIPTION}`)
          }
          const { issue, prefix } = await resolveIssue(cfg, String(input.issue), context?.signal)

          await api(
            cfg,
            `/workspaces/${cfg.workspace}/projects/${cfg.project}/work-items/${issue.id}/`,
            { method: "PATCH", body: JSON.stringify({ description_html: markdownToPlaneHtml(body) }) },
            context?.signal,
          )
          const key = `${prefix}-${issue.sequence_id}`
          return {
            content: `Description replaced on ${key}: ${issueUrl(cfg, prefix, issue.sequence_id)}`,
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
