# opencode-mem: deeper diagnostics

Reference for the failure modes behind `SKILL.md`. Everything here was
verified on a host where a VPN/filtering middlebox silently dropped the
embedded installer's TLS handshakes.

## Where things live

| Thing | Path |
|---|---|
| OpenCode config (plugins) | `~/.config/opencode/opencode.jsonc` |
| Plugin config | `~/.config/opencode/opencode-mem.jsonc` |
| Plugin cache (seeded packages) | `~/.cache/opencode/packages/<pkg>@<version>/` |
| Plugin runtime (as loaded) | `~/.cache/opencode/npm/<pkg>@<version>/<epoch-ms>/node_modules/<pkg>/` |
| Memory store, model cache, token | `~/.opencode-mem/data/`, `~/.opencode-mem/data/.cache/`, `~/.opencode-mem/.auth-token` |
| OpenCode logs | `~/.local/share/opencode/log/opencode.log` (`role=cli` / `role=server`) |
| Plugin log | `~/.opencode-mem/opencode-mem.log` |
| Web UI | `http://127.0.0.1:4747` (or `0.0.0.0` + auth) |

## Diagnosing a hung install

1. **Confirm the hang is the install, not the CLI.**
   `grep "cli starting" ~/.local/share/opencode/log/opencode.log | tail` —
   a hung `plugin add` shows exactly one `cli starting` line for its run id
   and no `plugin reconciliation` lines.

2. **Prove the network is fine from the shell.**
   ```sh
   curl -s -o /dev/null -w "%{size_download} bytes in %{time_total}s\n" \
     https://registry.npmjs.org/opencode-mem
   npm view opencode-mem version
   ```
   If both are fast, the problem is the embedded runtime, not the link.

3. **Look at the sockets.** `ss` may be absent; use `/proc/net/tcp`:
   ```sh
   python3 - << 'EOF'
   import glob, os
   pid = <pid of the opencode plugin add process>
   inodes = {os.readlink(fd)[8:-1] for fd in glob.glob(f'/proc/{pid}/fd/*')
             if os.readlink(fd).startswith('socket:[')}
   for f in ('/proc/net/tcp', '/proc/net/tcp6'):
       for line in open(f).read().strip().split('\n')[1:]:
           p = line.split()
           if p[9] in inodes and int(p[3], 16) == 1:
               print(f, p[1], '->', p[2], 'tx:rx', p[4])
   EOF
   ```
   `state=1` (ESTABLISHED) with a **non-zero tx queue and zero rx** means
   the request was sent and never acknowledged — the path is eating the
   bytes. A few hundred bytes stuck is the TLS ClientHello.

4. **Compare stacks.** `curl` (OpenSSL) and npm (OpenSSL) pass; OpenCode's
   embedded Bun/BoringSSL client does not. That combination means
   TLS-fingerprint based filtering, not IPv6, MTU, DNS, or bandwidth.
   (IPv6 was ruled out in the same session: DNS returned AAAA records, but
   the sockets were IPv4 and established. ECH was ruled out by reading the
   HTTPS DNS record — it advertised only `alpn`/`ipv4hint`/`ipv6hint`.)

5. **Do not keep retrying `plugin add`.** It resolves the npm spec online
   before it looks at any cache, so it hangs forever regardless of what is
   already on disk.

## Why enabling the plugin breaks chat

An unpinned plugin entry makes the server do a background install/update
check at startup. If that network call hangs, plugin activation never
completes and every command that needs the service fails with
`ServiceUnavailableError: Location plugins did not finish activating` —
including chat. Pinning the version removes the network call entirely:
pinned entries load from `~/.cache/opencode/packages/<pkg>@<version>/`.

Recovery when chat is already broken: comment the `plugins` entry out,
`opencode service restart`, fix the install, then re-enable.

## Embedding model cache layout

`@huggingface/transformers` (v4) resolves cache keys as
`<cacheDir>/<publisher>/<model>/<file>`, i.e.

```
~/.opencode-mem/data/.cache/Xenova/nomic-embed-text-v1/
├── config.json
├── tokenizer.json
├── tokenizer_config.json
└── onnx/model.onnx        # or model_quantized.onnx for q8
```

The library is cache-first (`checkCachedResource` → `tryCache`), so a
complete cache works fully offline. A partially populated cache is the
trap: the plugin fetched the 547 MB ONNX file successfully and died on
`tokenizer.json`, so every later call failed while the big file sat there
looking fine.

The mirror case: the whole cache directory was deleted (e.g. wiped while
resetting the data dir), so `onnx/model.onnx` is missing too and the
plugin's own re-download dies mid-flight, leaving an empty `onnx/`
directory. Symptom is an empty `onnx/` folder plus `tokenizer.json`
absent. Re-fetch both with curl (~30 s for the model on a decent link),
then restart the service:

```sh
D=~/.opencode-mem/data/.cache/Xenova/nomic-embed-text-v1
B=https://huggingface.co/Xenova/nomic-embed-text-v1/resolve/main
mkdir -p $D/onnx
curl -fL --retry 3 -o $D/tokenizer.json $B/tokenizer.json
curl -fL --retry 3 -o $D/onnx/model.onnx $B/onnx/model.onnx
```

Verify each file against the remote size:
```sh
curl -sIL "https://huggingface.co/Xenova/nomic-embed-text-v1/resolve/main/onnx/model.onnx" \
  | grep -i content-length
stat -c%s ~/.opencode-mem/data/.cache/Xenova/nomic-embed-text-v1/onnx/model.onnx
```

Reference sizes: `tokenizer.json` = 711396 bytes,
`onnx/model.onnx` = 547552426 bytes.

### Memoized warmup failures

The plugin memoizes the embedding-model initialization promise. The first
failure (e.g. the missing `tokenizer.json`) is cached as a rejection, so
every subsequent `memory` call fails instantly with the identical error and
**the plugin log stops writing new lines** — the classic "I fixed the cache
but nothing changed" moment. `opencode service restart` clears it.

## Memory semantics worth knowing

- `memory({ mode: "search", query })` uses vector similarity with a recall
  threshold; a vague query returns 0 hits while a query close to the stored
  text hits (a 70% similarity match was observed). Lower
  `similarityThreshold` / use `recall: "both"` if recall feels too strict.
- `add` embeds and stores; `list` is a plain DB read; `profile` is the
  cross-project user summary.
- Auto-capture needs a provider that can return tool-call/structured
  output; without one the log says `Auto-capture disabled by configuration`
  and capture/profile learning stay off, while manual `memory` operations
  still work.
- Profile learning needs ~10 analyzed prompts
  (`userProfileAnalysisInterval`) before it has anything to summarize.

## Multi-instance and migration notes

- Turso store is shared across OpenCode sessions via
  `tursoMultiprocessWal` on Linux/macOS; on Windows only one session may
  own the databases. `tursoMultiprocessWal: false` switches to
  single-owner mode (others fail with `database is locked` instead of
  corrupting state).
- Do not run multiple OpenCode instances against one `storagePath` during
  a migration — a lock file (`<database>.turso-migrate.lock`) prevents
  concurrent migration, and interrupted migrations resume on next start.
- Shard databases are keyed by project identity (git repo by default). Use
  an empty `.opencode-mem-project` marker file at a workspace root to share
  one store across nested repos.

## Upstream-worthy bug reports

Two behaviors deserve an upstream issue:

1. The plugin installer has **no timeout** on a stalled TLS handshake, so a
   black-holed connection hangs the command forever with no output.
2. A **hanging plugin activation blocks the entire server** (no chat, no
   models), rather than degrading gracefully: the plugin should fail with a
   clear error and let the server continue.
