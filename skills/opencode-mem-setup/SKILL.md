---
name: opencode-mem-setup
description: Installing, configuring, and troubleshooting the opencode-mem plugin (persistent memory for OpenCode). Use when a user asks to install or enable opencode-mem, when `opencode plugin add` hangs, when the server fails with "plugins did not finish activating" or chat stops working after adding a plugin, when the memory tool or the web UI on port 4747 is missing, or when embedding model downloads fail with ECONNRESET / fetch errors.
---

# opencode-mem: install, configure, verify

opencode-mem gives OpenCode persistent memory: a local Turso vector database
under `~/.opencode-mem/data/`, automatic memory capture after sessions,
context injection in new sessions, a web UI on port 4747, and a `memory`
tool. The plugin is heavy (~1.3 GB installed: onnxruntime-node, HF
transformers, Turso native bindings) and phones home twice — once to npm for
the package, once to HuggingFace for the embedding model. Both paths can be
blocked by VPNs / filtering middleboxes, which **hang silently forever**
(there is no timeout). This skill covers the normal path and the verified
workarounds for filtered networks.

## Happy path (normal network)

1. Add to `~/.config/opencode/opencode.jsonc`:
   ```jsonc
   "plugins": ["opencode-mem@latest"]
   ```
   or `opencode plugin add opencode-mem@latest`.
2. First startup auto-creates a commented config template at
   `~/.config/opencode/opencode-mem.jsonc` and installs dependencies.
3. Configure auto-capture in `opencode-mem.jsonc` (without it, capture and
   profile learning stay off — the log says so explicitly):
   ```jsonc
   { "opencodeProvider": "<provider-id>", "opencodeModel": "inherit" }
   ```
   The provider must support structured/tool-call output. `"inherit"` follows
   the session's model.
4. Restart the service (`opencode service restart`) after editing the
   plugin's config — it is read at plugin startup, not hot-reloaded.
5. Verify:
   - `opencode plugin list` → `opencode-mem <version>`
   - Web UI `http://127.0.0.1:4747` answers
   - `~/.opencode-mem/opencode-mem.log` contains
     `Embedding model warmed up: {...}` (healthy) and no
     `Auto-capture disabled by configuration`
   - `memory` tool works: add → list → search

## Filtered-network path (verified on hosts where installs hang)

Symptoms: `plugin add` shows nothing and never finishes; `opencode.log`
shows only `cli starting` for the run; `~/.cache/opencode/packages/` is
never created; enabling the plugin in config makes the whole server fail
with `ServiceUnavailableError: Location plugins did not finish activating`
→ **no chat**. Root cause: the embedded installer's TLS ClientHello is
dropped by the middlebox while `curl` (different TLS stack) works fine.
`plugin add` can NEVER work there, even with a seeded cache, because it
resolves the npm spec online first. Never debug it with `plugin add`; seed
the cache and use a **pinned** config entry instead.

### 1. Seed the package cache with system npm (npm's TLS passes the filter)

Requires `node` + `npm` on the system (the distro's Node 18 is fine —
`EBADENGINE` warnings are harmless, nothing runs on system Node).

```sh
VER=2.39.0   # check `npm view opencode-mem version`
mkdir -p ~/.cache/opencode/packages/opencode-mem@$VER
cd ~/.cache/opencode/packages/opencode-mem@$VER
printf '{"name":"opencode-mem-cache","version":"1.0.0","private":true}\n' > package.json
npm install opencode-mem@$VER --no-audit --no-fund
```

Result layout (verified working): `<dir>/node_modules/opencode-mem/` with
hoisted deps. ~1.3 GB, a couple of minutes.

### 2. Pin the version in `opencode.jsonc`

```jsonc
"plugins": ["opencode-mem@2.39.0"]
```

Pinned entries load from the cache at startup **without any network**.
Unpinned `@latest` triggers background update checks that hang activation
and block the server again.

### 3. Seed the embedding model with curl

The plugin downloads `Xenova/nomic-embed-text-v1` (fp32 ≈ 547 MB) into
`~/.opencode-mem/data/.cache/Xenova/nomic-embed-text-v1/`. Through a
filtering middlebox the fetches die with `ECONNRESET`, often leaving a
**partially filled cache** (e.g. complete `onnx/model.onnx` but missing
`tokenizer.json`). Complete it by hand — curl reaches HuggingFace fine:

```sh
D=~/.opencode-mem/data/.cache/Xenova/nomic-embed-text-v1; mkdir -p $D/onnx
B=https://huggingface.co/Xenova/nomic-embed-text-v1/resolve/main
for f in config.json tokenizer.json tokenizer_config.json onnx/model.onnx; do
  curl -fL --retry 3 -o $D/$f $B/$f
done
```

The dtype decides the ONNX filename: the plugin log line
`Resolved local ONNX dtype ... {"dtype":"fp32"}` → `model.onnx`;
a configured q8 dtype → `model_quantized.onnx`. Check local size vs the
remote `content-length` (`curl -sIL`) — a truncated model.onnx passes
existence checks but fails at load.

Alternative that skips HF entirely: remote embeddings via
`embeddingApiUrl` + `embeddingApiKey` (OpenAI-compatible `/embeddings`) in
`opencode-mem.jsonc`.

### 4. Restart the service — warmup failures are memoized

A failed embedding warmup is cached as a rejection, so every later memory
call fails instantly with the same error even after the cache is complete,
and the plugin log goes quiet. `opencode service restart` clears it. Success
looks like: `Embedding model warmed up: {"model":"Xenova/nomic-embed-text-v1","pooling":"mean",...}`.

## Web UI auth (non-loopback bind)

With `webServerHost` set to `0.0.0.0` + `webServerAuthPassword`:
- UI pages: Basic Auth (`webServerAuthUsername` / password).
- `/api/*`: Basic Auth **plus** token —
  `-H "X-Opencode-Mem-Token: $(cat ~/.opencode-mem/.auth-token)"`.
  The page embeds the same token for the SPA
  (`window.__OPENCODE_MEM_TOKEN__`). `chmod 600 ~/.opencode-mem/.auth-token`.
- Unauthenticated 401s are normal for half the credentials; test with both.

## Skills library

The plugin keeps its own skill store (`~/.opencode-mem/data/skills.db`,
web UI Skills tab at `/skill-library`, REST `/api/skills`). It is separate
from OpenCode's native skills (`~/.config/opencode/skills/`). On V2 the
plugin bridges library skills to agents via `ctx.skill.transform`.
