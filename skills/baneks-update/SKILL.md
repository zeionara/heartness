---
name: baneks-update
description: Updating the baneks dataset on HuggingFace with the marude project — fetching fresh anecdotes, regenerating the censored/default/inflated TSVs, bumping the dataset version and pushing the new files to the zeio/baneks repo. Use when the user asks to update the baneks dataset, add more aneks, or refresh the HuggingFace dataset.
---

# Updating the baneks dataset

The baneks dataset lives at `https://huggingface.co/datasets/zeio/baneks`. It is
a text dataset built from VK communities by the `marude` project: each update
fetches the anecdotes again, rebuilds three TSV files and pushes them.

This skill covers the **text dataset only**. Generating speech from the
anekdots (`python -m rr handle-aneks`) is a separate procedure that needs the
`raconteur` submodule and an `ffmpeg` binary — out of scope here.

## Where things live

| What | Path |
|---|---|
| Project | `/opt/marude` |
| Virtualenv | `/opt/marude/.venv` — shared with the `rr` speech stack, **Python 3.11** (see step 0) |
| Speech stack requirements | `/opt/marude/submodules/raconteur/requirements.txt` |
| Fetched anecdotes | `/opt/marude/assets/baneks/<DD.MM.YYYY>/` |
| Dataset clone | `/tmp/baneks` (disposable, removed at the end) |
| Dataset repo | `https://huggingface.co/datasets/zeio/baneks`, branch `main` |

## Preconditions

- `HF_TOKEN` — a HuggingFace write token, read from the environment. **Never
  print it, never write it into a file, never echo the clone URL.**
- `MARUDE_VK_API_KEY` — read at import time by `marude/Anecdote.py`, so
  `python -m marude` dies with `KeyError` without it. The anecdote fetch does
  not use the key, but it must exist in the environment.
- `git-lfs` — the dataset TSVs are LFS objects (`*.tsv filter=lfs`). Without
  the smudge filter the clone yields pointer stubs instead of the data.
- `git-xet` — the global git config registers it as a custom LFS transfer
  adapter (`lfs.customtransfer.xet.path=git-xet`), and HuggingFace serves the
  dataset files through the xet CAS. With it installed the transfer is chunked
  and deduplicated; without it git-lfs silently falls back to the slower basic
  LFS transfer, and on a repo that only speaks xet the transfer fails outright.

If a variable is missing, stop and tell the user which one — do not guess a
value and do not create a token.

## Iron rules

1. **The version is the run date**, formatted `DD.MM.YYYY` (`date +%d.%m.%Y`).
   The same string goes into the folder name, `baneks.py` and `README.md`.
2. **Never shrink the dataset.** A new version with fewer rows than the
   previous one is a failed fetch, not an update. Abort and report.
3. **The working tree of `/opt/marude` is never touched by git.** The fetch
   writes into `assets/`, which is gitignored. Only `/tmp/baneks` is committed
   and pushed — this is the one scoped exception to the no-commit rule in
   AGENTS.md, and it applies to that disposable clone only.
4. **Commit exactly five files**: `censored.tsv`, `default.tsv`,
   `inflated.tsv`, `README.md`, `baneks.py`. Nothing else goes into the commit.
5. **Never print `HF_TOKEN`** — not in command output, not in an error message.
   In particular, never run `git lfs env`: it prints the authenticated LFS
   endpoint with the token in plaintext.
6. **Never install the project into the venv.** Run `python -m marude` from
   `/opt/marude`, so the source tree is what executes. An editable install
   shadows it and leaves an egg-info directory behind.
7. **Remove `/tmp/baneks` when the job is done**, successful or not.
8. **The shared venv's numpy and pandas belong to the speech stack.** Never
   upgrade them, and never install marude's `requirements.txt` wholesale.

## Workflow

### 0. Preflight — heal the environment if needed

Check the transfer tools — both are needed for the dataset clone:

```sh
command -v git-xet >/dev/null || { echo "git-xet is missing: the dataset transfers go through the xet CAS"; exit 1; }
git lfs version
git xet --version
```

#### The virtualenv is shared, and it is Python 3.11

`/opt/marude/.venv` serves two toolchains at once:

- the **marude text toolchain** — what this skill's fetch uses;
- the **`rr` / `raconteur` speech stack** — installed from
  `submodules/raconteur/requirements.txt`, which the user keeps as a frozen
  snapshot of the venv.

The speech stack requires **Python 3.11**. `scipy==1.16.3` and
`scikit-learn==1.8.0` declare `Requires-Python: >=3.11`, and `numpy==1.25.2`
has no distribution for 3.12 at all (PyPI starts that line at 1.26.0). The
venv is therefore built with `python3.11` and its `numpy 1.25.2` / `pandas
2.3.3` pins are the speech stack's — **not** marude's own `requirements.txt`,
which pins `numpy==2.4.4` and `pandas==3.0.2`.

Three consequences:

1. **Never recreate the venv with another Python.** Use `python3.11`.
2. **Never run `pip install -r requirements.txt`** against this venv. It would
   upgrade numpy and pandas underneath the speech stack.
3. **Install missing marude-side packages with `--no-deps`**, at the pins from
   marude's `requirements.txt`. The shared venv keeps its own numpy and pandas.

```sh
cd /opt/marude
[ -x .venv/bin/python ] || python3.11 -m venv .venv
.venv/bin/python --version   # must be 3.11.x
```

If the venv exists but the speech stack is missing (no `torch`), restore it
from the submodule:

```sh
cd /opt/marude
.venv/bin/python -m pip install -r submodules/raconteur/requirements.txt
```

Check that the fetch toolchain imports — `fetch.sh` needs `marude`, `tastier`,
`nltk`, `pytaglib`, `ffmpeg`, `webrtcvad` and `pymorphy3`:

```sh
cd /opt/marude
.venv/bin/python - <<'EOF'
import importlib
modules = ['tasty', 'nltk', 'taglib', 'ffmpeg', 'webrtcvad', 'pymorphy3', 'dawg_python', 'pandas', 'requests', 'click', 'tqdm', 'scipy', 'pydub']
missing = []
for module in modules:
    try:
        importlib.import_module(module)
    except ImportError:
        missing.append(module)
print('missing:', missing or 'none')
EOF
```

If anything is missing, install it **without touching the versions already in
the venv** — see consequence 3 above:

```sh
cd /opt/marude
.venv/bin/python -m pip install --no-deps \
  nltk==3.9.4 tastier==0.1.0 pytaglib==3.2.0 ffmpeg==1.4 webrtcvad-wheels==2.0.14 \
  pymorphy3==2.0.6 pymorphy3-dicts-ru==2.4.417150.4580142 DAWG2-Python==0.9.0
```

Take the pins from marude's `requirements.txt` — the list above is the current
one.

The nltk tokenizers must be present — `marude/util/string.py` calls
`sent_tokenize`:

```sh
cd /opt/marude
.venv/bin/python -c "
import nltk
for resource in ('punkt', 'punkt_tab'):
    try:
        nltk.data.find(f'tokenizers/{resource}')
        print(resource, 'present')
    except LookupError:
        nltk.download(resource)
"
```

Check the `fuck` submodule — `fetch.sh` ends with `python -m fuck stats`, which
needs `fuck/profane-words.txt`. The submodule URLs in `.gitmodules` are SSH, so
the HTTPS rewrite is the fallback when no SSH key is available:

```sh
cd /opt/marude
[ -f fuck/profane-words.txt ] || \
  git -c url."https://github.com/".insteadOf=git@github.com: submodule update --init fuck
```

`fetch.sh` resolves `fuck/...` through the symlink `fuck -> submodules/fuck/fuck`,
so run it from the project root.

### 1. Fetch the anecdotes

```sh
cd /opt/marude
source .venv/bin/activate
VERSION="$(date +%d.%m.%Y)"
./fetch.sh "$VERSION"
```

`fetch.sh` writes into `assets/baneks/$VERSION/`:

| File | Content |
|---|---|
| `anekdotikategoriib.tsv`, `baneks.tsv`, `baneksbest.tsv` | raw posts per community |
| `inflated.tsv` | merged, one row per post |
| `censored.tsv` | deduplicated, same texts aggregated |
| `default.tsv` | censored, with profanity restored from the dictionary |

Only the last three are published.

### 2. Pull the dataset

```sh
rm -rf /tmp/baneks
git clone "https://zeio:${HF_TOKEN}@huggingface.co/datasets/zeio/baneks" /tmp/baneks
```

Confirm the clone contains real data, not LFS pointers:

```sh
cd /tmp/baneks
for f in censored default inflated; do
  if head -c 20 "$f.tsv" | grep -q "^version https://git-lfs"; then
    echo "$f.tsv: LFS POINTER — the clone is broken"
  else
    echo "$f.tsv: real content"
  fi
done
```

Every file must report `real content`. A missing file means the checkout failed
— see [Troubleshooting](#troubleshooting).

Capture the row counts of the **current** dataset before overwriting anything:

```sh
cd /tmp/baneks
for f in censored default inflated; do echo "$f $(wc -l < $f.tsv)"; done
```

### 3. Copy the new files

Each command below runs in its own shell, so the version is derived again
rather than inherited. It must come out the same as in step 1 — if the run
crossed midnight, use the version of the folder that actually exists.

```sh
cd /opt/marude
VERSION="$(date +%d.%m.%Y)"
SRC="assets/baneks/$VERSION"
[ -d "$SRC" ] || { echo "no such folder: $SRC"; exit 1; }
for f in censored default inflated; do cp "$SRC/$f.tsv" /tmp/baneks/; done
```

### 4. Bump the version

Same `DD.MM.YYYY` string in both files.

`/tmp/baneks/baneks.py` — one line; the three `BuilderConfig` entries already
reference `VERSION`:

```python
VERSION = Version('DD.MM.YYYY')
```

`/tmp/baneks/README.md` — one line:

```markdown
- **Dataset version:** `DD.MM.YYYY`
```

Use the `edit` tool with the old date as `oldString`. The old date is the
version string in the file as cloned.

### 5. Verify before committing

```sh
cd /tmp/baneks
for f in censored default inflated; do echo "$f $(wc -l < $f.tsv)"; done
git status --short
```

Compare with the counts from step 2. If any file has fewer rows now than
before, the fetch lost data — abort, report, do not commit. `git status` must
list exactly the five files.

### 6. Commit and push

```sh
cd /tmp/baneks
git add censored.tsv default.tsv inflated.tsv README.md baneks.py
git commit -m 'update(aneks): added more aneks'
git push
```

The commit message is the established convention on the dataset repo.

### 7. Clean up

```sh
rm -rf /tmp/baneks
```

## Report

State the version, the old and new row counts for the three files, the commit
hash, and anything that was skipped or failed. If a step was skipped because
its precondition was already met, say so.

## Troubleshooting

| Symptom | Cause | Action |
|---|---|---|
| `warning: current Git remote contains credentials` | git ≥ 2.30 warns about the token in the clone URL | Harmless — git does not print the token itself. Ignore it. |
| `Clone succeeded, but checkout failed` / `smudge filter lfs failed` | The token is invalid or expired. The clone itself succeeds on the public repo; only the LFS download fails. | Stop. Ask the user for a fresh `HF_TOKEN`. Never continue with an incomplete checkout and never retry with a placeholder token. |
| A `.tsv` file reports `LFS POINTER` | The clone ran without the LFS smudge filter (`GIT_LFS_SKIP_SMUDGE=1`, or `git-lfs` missing). | Run `git lfs install`, then re-clone. A pointer file must never be pushed back — it would replace the dataset with a 130-byte stub. |
| `xet transfer failed` / `custom transfer adapter 'xet' not found` | `git-xet` is missing or off `PATH` while the global git config registers it as the LFS transfer adapter. | Install git-xet and re-clone. git-lfs may silently fall back to the basic transfer, which is slower but still correct — check the row counts before trusting it. |
| `KeyError: 'MARUDE_VK_API_KEY'` | `marude/Anecdote.py` reads the variable at import time. | Export it in the environment; the fetch does not use the key, but the import needs it to exist. |
| `ModuleNotFoundError: No module named 'pymorphy3'` (or `tastier`, `nltk`, `taglib`) | The venv lacks part of the fetch toolchain — `fuck stats` imports `pymorphy3`, `marude` imports `nltk`/`tastier`/`taglib`. | Run the dependency check in step 0 and install the missing packages with `--no-deps`. Everything the fetch already wrote to `assets/baneks/<version>/` is still valid — only the failed step needs re-running, so there is no need to fetch again. |
| `python -m fuck` not found | The `fuck` submodule is not checked out, so the `fuck` symlink dangles. | Run the submodule init from step 0. |
| `FileNotFoundError` for `assets/baneks/<date>/` | `fetch.sh` was run from another directory — it uses relative paths. | Run it from `/opt/marude`. |
