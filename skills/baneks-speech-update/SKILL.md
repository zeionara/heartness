---
name: baneks-speech-update
description: Updating the baneks-speech dataset on HuggingFace with the marude project — generating speech for the anecdotes fetched by baneks-update, repacking them into batch archives, bumping the dataset version and pushing to the zeio/baneks-speech repo. Use when the user asks to update the baneks-speech dataset, generate speech for the new aneks, or refresh the speech dataset.
---

# Updating the baneks-speech dataset

The baneks-speech dataset lives at
`https://huggingface.co/datasets/zeio/baneks-speech`. It holds one MP3 per
anecdote from the [baneks](https://huggingface.co/datasets/zeio/baneks) dataset,
packed into archives of 1000 files.

This skill is the **second half of a two-step pipeline**:

1. `baneks-update` — fetch the anecdotes, publish the text dataset;
2. `baneks-speech-update` — this skill — turn the published anecdotes into
   speech and publish it.

This skill pulls the text dataset as-is and never re-fetches the anecdotes —
that is the `baneks-update` skill's job. Run it first only when the anecdotes
themselves need refreshing.

## Where things live

| What | Path |
|---|---|
| Project | `/opt/marude` |
| Virtualenv | `/opt/marude/.venv` — shared with the `rr` speech stack, **Python 3.11** (see step 0) |
| Speech stack requirements | `/opt/marude/submodules/raconteur/requirements.txt` |
| Source anecdotes | `/tmp/baneks/default.tsv` (pulled from the text dataset) |
| Text clone | `/tmp/baneks` — disposable, removed in step 13 |
| Speech clone | `/tmp/baneks-speech` — disposable, removed in step 13 |
| Extracted audio | `/tmp/baneks-speech/speech-extracted` |
| Dataset repo | `https://huggingface.co/datasets/zeio/baneks-speech`, branch `main` |

## Preconditions

- `HF_TOKEN` — a HuggingFace write token, read from the environment. **Never
  print it, never write it into a file, never echo the clone URL.**
- `VK_CLOUD_CLIENT_ID` and `VK_CLOUD_CLIENT_SECRET` — the `-e vk` engine reads
  them from the environment. Without them the engine cannot authenticate.
- **VK Cloud credits** — the `-e vk` engine bills every synthesis. A `503` from
  the TTS endpoint means the balance is exhausted; it does not recover on its
  own. Check the balance before starting a long run.
- `MARUDE_VK_API_KEY` — read at import time by `marude/Anecdote.py`.
- `.vk-cloud-refresh-token` — optional file in the **current directory**; the
  engine looks it up by that relative path, so run the generator from
  `/opt/marude`. Absent means a plain client-credentials OAuth flow.
- `git-lfs` and `git-xet` — the archives are LFS objects (`*.tar.xz
  filter=lfs`). See the notes in the `baneks-update` skill: never run
  `git lfs env`, it prints the token.

If a variable is missing, stop and tell the user which one — do not guess a
value and do not create credentials.

## Iron rules

1. **The version is the run date**, formatted `DD.MM.YYYY` (`date +%d.%m.%Y`),
   and it is the same date the `baneks-update` run used.
2. **The text dataset is pulled as-is.** The generator reads
   `/tmp/baneks/default.tsv` from the published text dataset. Refreshing the
   anecdotes is the `baneks-update` skill's job — do not re-fetch them here.
3. **A batch never exceeds 1000 files** (`_N_BATCH` in `baneks-speech.py`).
   Archive ranges are contiguous and the last range ends exactly at the new
   `_N_TOTAL`.
4. **Ordinal order is creation order.** The trailing batch keeps the oldest
   files; every new batch holds progressively newer ones.
5. **The old trailing archive is replaced, not kept.** Its range grows to a
   full batch and the old archive is deleted from the repo.
6. **Never push an LFS pointer.** Every archive must contain real content.
7. **Never print `HF_TOKEN`** and never run `git lfs env`.
8. **Commit only in the disposable clone** — `/tmp/baneks-speech`. The
   `/opt/marude` working tree is never touched by git.
9. **Remove `/tmp/baneks` and `/tmp/baneks-speech` when the job is done.** They
   are disposable. Keeping them is an exception the user grants for a
   particular run — not the default. See step 13.
10. **Partial generation is normal.** The engine stops at the first
    `GenerationException`; re-running resumes where it stopped.
11. **A `503` from the TTS endpoint means the account is out of credits.** Stop
    and ask the user to top up — retrying does not help. Do not confuse it with
    an authentication failure, which the OAuth endpoint reports differently.

## Workflow

### 0. Preflight

```sh
command -v git-xet >/dev/null || { echo "git-xet is missing: the dataset transfers go through the xet CAS"; exit 1; }
git lfs version
git xet --version
```

The virtualenv is the shared Python 3.11 one described in the `baneks-update`
skill — the same file, the same rules: never recreate it with another Python,
never `pip install -r requirements.txt` against it, install missing packages
with `--no-deps`. The speech stack comes from
`submodules/raconteur/requirements.txt`.

```sh
cd /opt/marude
[ -x .venv/bin/python ] || python3.11 -m venv .venv
.venv/bin/python --version          # must be 3.11.x
.venv/bin/python -m rr handle-aneks --help > /dev/null && echo "rr OK"
```

The `rr` package lives in the `raconteur` submodule and is imported from the
working directory — if `--help` fails, the submodule is not checked out:

```sh
cd /opt/marude
git submodule update --init --recursive
```

### 1. Pull the text dataset

The generator reads the anecdotes from the published text dataset. Pull it
as-is — do not re-fetch the anecdotes, that is the `baneks-update` skill's job
and it is a separate, slow step:

```sh
rm -rf /tmp/baneks
git clone "https://zeio:${HF_TOKEN}@huggingface.co/datasets/zeio/baneks" /tmp/baneks
cd /tmp/baneks
head -c 20 default.tsv | grep -q "^version https://git-lfs" && { echo "default.tsv: LFS POINTER"; exit 1; }
wc -l < default.tsv
grep -n "VERSION = Version" baneks.py
```

`/tmp/baneks/default.tsv` is the generator input. If the text dataset needs
refreshing for today, run the `baneks-update` skill first and pull it again.

### 2. Pull the speech dataset

```sh
rm -rf /tmp/baneks-speech
git clone "https://zeio:${HF_TOKEN}@huggingface.co/datasets/zeio/baneks-speech" /tmp/baneks-speech
```

Confirm the archives contain real data, not LFS pointers:

```sh
cd /tmp/baneks-speech
for archive in speech/*.tar.xz; do
  if head -c 20 "$archive" | grep -q "^version https://git-lfs"; then
    echo "$archive: LFS POINTER — the clone is broken"
  fi
done
ls speech/*.tar.xz | wc -l
```

Capture the baseline before touching anything:

```sh
cd /tmp/baneks-speech
grep -E "^_N_TOTAL|^_N_BATCH|^    VERSION" baneks-speech.py
ls speech/*.tar.xz | tail -1
```

The **trailing archive** is the last one by name — the archive whose range ends
at `_N_TOTAL`. Today that is `speech/044001-044788.tar.xz`. Its first index
(`044001`) stays the same after the update; only its end grows.

### 3. Extract every archive

```sh
cd /tmp/baneks-speech
mkdir speech-extracted
for file in ./speech/*.tar.xz; do tar -xJvf "$file" -C ./speech-extracted; done
ls speech-extracted | wc -l
```

The count must equal `_N_TOTAL`. This extraction is what makes the generator's
`-k` (skip-if-exists) work: only files that are genuinely new get generated.
Skipping this step regenerates the whole dataset.

### 4. Snapshot the file list

```sh
cd /tmp/baneks-speech
find ./speech-extracted -maxdepth 1 -type f -printf '%f\n' | sort > /tmp/speech-manifest-before.txt
wc -l < /tmp/speech-manifest-before.txt
```

Keep a **published baseline** — the list of files the dataset on the hub
already contains. A run that stops on a `503` and is resumed later accumulates
clips across several runs, and the next publish must add *all* of them, not
just the last run's:

```sh
cp /tmp/speech-manifest-before.txt /tmp/speech-manifest-published.txt
```

If `/tmp/speech-manifest-published.txt` already exists, keep it — it is the
baseline from the last publish. When publishing, the clips to add are:

```sh
comm -13 /tmp/speech-manifest-published.txt /tmp/speech-manifest-ondisk.txt > /tmp/speech-unpublished.txt
```

### 5. Generate the speech

```sh
cd /opt/marude
.venv/bin/python -m rr handle-aneks \
  -s /tmp/baneks/default.tsv \
  -d /tmp/baneks-speech/speech-extracted \
  -e vk -rkv
```

Run it in the background — generating thousands of clips takes hours, and the
run may stop early on a `GenerationException`. The last line of the output is
the authoritative count:

```
Handled 2051 aneks in 7321.44 seconds (3.57 seconds per anek in average)
```

If it stops early, run the same command again: `-k` skips everything that
already exists, so the second run continues where the first stopped — but only
after the cause is fixed. A `503` means the VK Cloud balance is empty: stop and
ask the user to top it up, then re-run.

When credit arrives in small lots, a single run is not enough — wrap the
generator in a retry loop so every lot gets used and the loop ends by itself
when the set is complete:

```sh
# /tmp/generate-remaining.sh
cd /opt/marude
PY=/opt/marude/.venv/bin/python
while true; do
  missing="$($PY -c "
import os, pandas as pd
df = pd.read_csv('/tmp/baneks/default.tsv', sep='\t')
d = '/tmp/baneks-speech/speech-extracted'
print(sum(1 for _, r in df.iterrows() if not os.path.isfile(os.path.join(d, f'{r[\"id\"]:08d}.{r[\"source\"]}.mp3'))))
")"
  [ "$missing" = "0" ] && break
  $PY -m rr handle-aneks -s /tmp/baneks/default.tsv -d /tmp/baneks-speech/speech-extracted -e vk -rkv
  sleep 180
done
```

The loop generates but never publishes — publishing stays a deliberate step.

Two failure families look alike but need different fixes:

| Message | Endpoint | Cause |
|---|---|---|
| `Unexpected response status: 503 (b'503: Service Unavailable')` | TTS (`voice.mcs.mail.ru/tts`) | No credits left on the account |
| `Unexpected get token response status: …` / `Unexpected refresh token response status: …` | OAuth (`mcs.mail.ru/auth/oauth/v1/token`) | Bad or expired `VK_CLOUD_CLIENT_ID` / `VK_CLOUD_CLIENT_SECRET` |

### 6. Identify the new files

```sh
cd /tmp/baneks-speech
find ./speech-extracted -maxdepth 1 -type f -printf '%f\n' | sort > /tmp/speech-manifest-ondisk.txt
comm -13 /tmp/speech-manifest-before.txt /tmp/speech-manifest-ondisk.txt > /tmp/speech-new-files.txt
wc -l < /tmp/speech-new-files.txt
```

The count **must** equal the `Handled N aneks` number from step 5. If it does
not, something else wrote into the directory — stop and report, do not
continue.

When the run is a **resume** of an earlier one that stopped on a `503`, the
clips to publish are the ones missing from the published baseline, not just
this run's:

```sh
comm -13 /tmp/speech-manifest-published.txt /tmp/speech-manifest-ondisk.txt > /tmp/speech-new-files.txt
wc -l < /tmp/speech-new-files.txt
```

### 7. Repack the trailing batch

The trailing archive is extracted separately, then topped up with the new
files, so that its range grows instead of leaving a short archive behind:

```sh
cd /tmp/baneks-speech
TRAILING="$(ls speech/*.tar.xz | tail -1)"
FIRST="$(basename "$TRAILING" .tar.xz | cut -d- -f1)"
LAST="$(basename "$TRAILING" .tar.xz | cut -d- -f2)"
echo "trailing archive: $TRAILING ($FIRST-$LAST)"

# clear the batch directories first — a previous publish left its own files
# behind, and extracting into a populated directory mixes them into the batch
rm -rf speech-extracted-trailing-batch speech-extracted-next-batch-*
mkdir speech-extracted-trailing-batch
tar -xJvf "$TRAILING" -C ./speech-extracted-trailing-batch
ls speech-extracted-trailing-batch | wc -l
```

The count after the extraction must equal the trailing archive's range width
(`LAST - FIRST + 1`). Anything else means stale files got mixed in — start
this step over.

Copy the new files into it. **Use `cp -p`** — it preserves the creation times,
and the split in the next step is ordered by exactly those. A plain `cp` gives
every copied file the same mtime, and the batch boundary then falls on the file
names instead of the generation order.

```sh
cd /tmp/baneks-speech
while IFS= read -r name; do cp -p "./speech-extracted/$name" ./speech-extracted-trailing-batch/; done < /tmp/speech-new-files.txt
ls speech-extracted-trailing-batch | wc -l
```

Order the batch by creation time, newest first, with the file name as a
deterministic tie-break (several new files can share an mtime):

```sh
cd /tmp/baneks-speech
find ./speech-extracted-trailing-batch -maxdepth 1 -type f -printf '%T@ %f\n' \
  | sort -k1,1nr -k2,2 | cut -d' ' -f2- > /tmp/trailing-newest-first.txt
wc -l < /tmp/trailing-newest-first.txt
```

The files that were already in the trailing archive keep their original
timestamps (`tar` restores them), so they sort older than everything the
generator just produced.

### 8. Split the overflow into new batches

`TOTAL` is the number of files now in the trailing batch. The oldest 1000 stay
in the trailing archive; everything newer moves into new batches of 1000.

```sh
cd /tmp/baneks-speech
TOTAL="$(wc -l < /tmp/trailing-newest-first.txt)"
KEEP=1000
if [ "$TOTAL" -gt "$KEEP" ]; then
  # the newest (TOTAL - KEEP) files leave the trailing batch, oldest first
  head -n $((TOTAL - KEEP)) /tmp/trailing-newest-first.txt | tac > /tmp/overflow-oldest-first.txt
  mkdir speech-extracted-next-batch-01
  while IFS= read -r name; do mv "./speech-extracted-trailing-batch/$name" ./speech-extracted-next-batch-01/; done < /tmp/overflow-oldest-first.txt
fi
```

Then split each overflow batch: it keeps its oldest 1000 files, the rest carry
over into the next batch. Repeat until the remainder is smaller than 1000.

```sh
cd /tmp/baneks-speech
# example: batch-01 holds 1476 files -> it keeps the oldest 1000, the newest 476 move to batch-02
find ./speech-extracted-next-batch-01 -maxdepth 1 -type f -printf '%T@ %f\n' \
  | sort -k1,1n -k2,2 | cut -d' ' -f2- > /tmp/batch-01-oldest-first.txt
COUNT="$(wc -l < /tmp/batch-01-oldest-first.txt)"
if [ "$COUNT" -gt 1000 ]; then
  mkdir speech-extracted-next-batch-02
  tail -n +1001 /tmp/batch-01-oldest-first.txt | while IFS= read -r name; do
    mv "./speech-extracted-next-batch-01/$name" ./speech-extracted-next-batch-02/
  done
fi
ls speech-extracted-next-batch-01 | wc -l   # 1000
ls speech-extracted-next-batch-02 | wc -l   # 476
```

**Check the arithmetic before archiving.** With `OLD_TOTAL` = `_N_TOTAL` before
the update and `N` = number of new files:

- new `_N_TOTAL` = `OLD_TOTAL + N`
- the trailing archive holds `min(OLD_TRAILING + N, 1000)` files
- every other archive holds exactly 1000, except the last one, which holds the
  remainder
- the ranges are contiguous: trailing starts at its old first index, and each
  following archive starts where the previous one ended

`_N_TOTAL` counts the **files in the dataset**, not the rows of the text
dataset. The speech dataset may hold a few clips for anecdotes the text
dataset no longer has (its dedup drops rows between versions), so the file
count can exceed the row count. Trust the file count.

### 9. Create the archives

The archives are built with `tar -C <dir> .`, so their entries are `./` plus
`./<filename>` — the same layout the published archives use, and what the
dataset loader expects.

```sh
cd /tmp/baneks-speech
TRAILING_COUNT="$(ls speech-extracted-trailing-batch | wc -l)"
LAST_IN_TRAILING="$(printf '%06d' $((10#$FIRST + TRAILING_COUNT - 1)))"
tar -cJvf "speech/${FIRST}-${LAST_IN_TRAILING}.tar.xz" -C speech-extracted-trailing-batch .
```

Every overflow batch follows the trailing one, each covering its own range:

```sh
cd /tmp/baneks-speech
NEXT="$((10#$FIRST + TRAILING_COUNT))"
for dir in speech-extracted-next-batch-*; do
  count="$(ls "$dir" | wc -l)"
  last="$((NEXT + count - 1))"
  echo "$dir -> $(printf '%06d-%06d.tar.xz' "$NEXT" "$last") ($count files)"
  tar -cJvf "speech/$(printf '%06d-%06d.tar.xz' "$NEXT" "$last")" -C "$dir" .
  NEXT="$((last + 1))"
done
```

The last range must end exactly at the new `_N_TOTAL`:

```sh
cd /tmp/baneks-speech
ls -l speech/*.tar.xz | tail -3
```

Each archive keeps the per-file timestamps of its contents, so the creation
order survives a repack and the next run can order by it again.

### 10. Update the dataset meta

`baneks-speech.py` — `_N_TOTAL` and `VERSION`:

```python
_N_TOTAL = 46_839
_N_BATCH = 1_000
```

```python
    VERSION = datasets.Version("DD.MM.YYYY")
```

`README.md` — one line:

```markdown
- **Dataset version:** `DD.MM.YYYY`
```

Use the `edit` tool with the old values as `oldString`. Keep the underscore
formatting of `_N_TOTAL` (`46_839`, not `46839`).

### 11. Verify before committing

```sh
cd /tmp/baneks-speech
git status --short
grep -E "^_N_TOTAL|^_N_BATCH|^    VERSION" baneks-speech.py
grep -n "Dataset version" README.md
```

`git status` must show exactly: the deleted old trailing archive, the new
archives, `README.md` and `baneks-speech.py`. Nothing else. Then check that
the ranges line up:

```sh
cd /tmp/baneks-speech
ls speech/*.tar.xz | tail -3
```

The last archive's end must equal the new `_N_TOTAL`, and every archive must
hold at most 1000 files.

### 12. Commit and push

```sh
cd /tmp/baneks-speech
git add -A speech README.md baneks-speech.py
git commit -m 'feat(data): added more data'
git push
```

`git add -A speech` stages the deletion of the replaced trailing archive
together with the new archives. The message matches this repo's own history.

The push moves hundreds of megabytes through the xet CAS — run it in the
background.

### 13. Clean up

The clones are disposable — remove them once the dataset is published:

```sh
du -sh /tmp/baneks /tmp/baneks-speech
rm -rf /tmp/baneks /tmp/baneks-speech
rm -f /tmp/speech-manifest-before.txt /tmp/speech-manifest-ondisk.txt \
      /tmp/speech-manifest-published.txt /tmp/speech-new-files.txt \
      /tmp/speech-unpublished.txt /tmp/trailing-newest-first.txt \
      /tmp/overflow-oldest-first.txt /tmp/batch-01-oldest-first.txt
```

Keeping them is an **exception the user grants for a particular run**, not the
default. Two reasons it comes up: the run stopped on a `503` and more credit
is expected, so the next attempt should resume from the extracted audio
instead of cloning and extracting several gigabytes again; or the user wants
to inspect the result before it is deleted. Ask before keeping them, and say
how much disk they hold.

## Report

State the version, how many anecdotes were generated, the old and new
`_N_TOTAL`, the archive ranges that changed, the commit hash, and anything
that was skipped or failed. If a step was skipped because its precondition was
already met, say so.

## Troubleshooting

| Symptom | Cause | Action |
|---|---|---|
| `LFS POINTER` on an archive | The clone ran without the LFS smudge filter, or the token is invalid. | Install git-lfs and git-xet, check the token, re-clone. Never push a pointer — it replaces a 70 MB archive with a 130-byte stub. |
| `Clone succeeded, but checkout failed` | The token is invalid or expired; the public repo clones, only the LFS download fails. | Stop and ask the user for a fresh `HF_TOKEN`. |
| `KeyError: 'VK_CLOUD_CLIENT_ID'` | The engine credentials are not in the environment. | Export them; never hardcode them into a file in the repo. |
| `Failed generation due to exception: Unexpected response status: 503 (b'503: Service Unavailable')` | The VK Cloud account has no credits left. The token is fine — the synthesis endpoint refuses the billable call. | Stop. Ask the user to top up the VK Cloud balance; retrying without a top-up fails identically. If credit arrives in small lots, run the retry loop above. Afterwards re-run the same command: `-k` resumes at the anecdote that failed. |
| The balance tops up but only a handful of clips go through per attempt | The allowance is metered in characters or has a per-period cap — the API exposes no balance or quota endpoint to confirm it (`/api/v1/{account,usage,quota,billing,balance,limits}` all 404), so the console is the only source of truth. | Use the retry loop: each attempt consumes whatever credit is available and the next attempt picks up where it stopped. |
| `Failed generation due to exception: Unexpected response status: 403 …` | The credentials are valid but the model is not allowed for this account. | Check the model (`katherine-hifigan` by default) and the account's access to it. |
| The generator regenerates thousands of files | The archives were not extracted into the destination before the run. | Extract everything into `speech-extracted` first, then generate. |
| The manifest count differs from `Handled N aneks` | Something else wrote into the extraction directory, or the run was interrupted mid-write. | Stop and report; do not repack on a mismatch. |
| The batch split lands on file names instead of generation order | The new files were copied without `cp -p`, so they all carry the copy time and the mtime tie-break decides the boundary. | Recopy with `cp -p` and redo the ordering. |
| The new archives hold fewer or more files than expected | The overflow was split by a plain `ls -t`, whose ties are arbitrary. | Re-split with the `find -printf '%T@ %f\n' | sort -k1,1n -k2,2` ordering, which breaks ties by name. |
| `ModuleNotFoundError` on `import rr` | The `raconteur` submodule is not checked out. | `git submodule update --init --recursive` from `/opt/marude`. |
| `No module named 'pymorphy3'` and friends | The shared venv is missing marude-side packages. | See the `baneks-update` skill: install with `--no-deps` at the pins from marude's `requirements.txt`. |
