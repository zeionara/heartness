---
name: subtitle-translation
description: How subtitle files (SRT, WebVTT) are translated — splitting a file into cue-sized chunks, translating dialogue, lyrics and sound cues while keeping the source register, copying cue indices and timecodes byte-for-byte, and validating the result against the source. Use whenever translating, re-timing, repairing or checking subtitles, or when a user asks to translate a movie's subtitles.
---

# Translating subtitles

A subtitle file is a timeline with text attached. Translating it changes only
the text; everything else (cue order, cue count, indices, timecodes) is the
source's contract with the player and with the next person who edits it.

## Iron rules
1. **Indices and timecodes are copied, never retyped.** The only thing that
   changes between the source and the translation is the cue text.
2. **Never merge, split, drop or reorder cues.** The output has exactly the
   cue count of the source. A cue that was too long to translate stays one cue
   with two lines — not two cues.
3. **Validate before reporting.** `scripts/srt_tool.py validate OUT --against SRC`
   must print `OK`. No «готово» without it in this turn.
4. **Output encoding**: UTF-8 without BOM, LF line endings, exactly one blank
   line between cues, no blank line inside a cue, file ends with exactly one
   newline, no trailing whitespace.
5. **Never modify the source file.** The translation is a new file next to it
   (`movie.en.srt` → `movie.ru.srt`).
6. **Faithful register**: vulgar stays vulgar, jokes stay jokes, mangled speech
   stays mangled. A translation that flattens the tone is a bad translation,
   not a safe one.

## Workflow
1. **Survey** the source: `scripts/srt_tool.py info SRC` — cue count, duration,
   format problems, overlapping cues, longest line.
2. **Split** at cue boundaries: `scripts/srt_tool.py split SRC --out-dir WORK --cues 150`.
   Chunks keep the original indices, so they can be merged back in any order.
3. **Translate** the chunks with parallel subagents — one agent per chunk, each
   writing one file. Give every agent the same style sheet and the hard format
   rules, and tell it to copy the index and timecode lines verbatim from its
   input. The agent sees only its own chunk, so the sheet must be complete.
4. **Assemble**: `scripts/srt_tool.py assemble OUT WORK/part*.srt`. It checks
   that the indices of the parts form one continuous sequence.
5. **Validate**: `scripts/srt_tool.py validate OUT --against SRC` — cue count,
   indices and every timecode line must match the source exactly.
6. **Review leftovers**: `scripts/srt_tool.py compare SRC OUT` lists cues whose
   line count differs and cues that still contain Latin words. Latin words are
   usually fine (names, brands, quoted titles) — check them, do not blanket-replace.
7. **Report**: the output files, cue counts, what was preserved, and every
   judgement call (ambiguous source line, a cue you rebalanced).

### Where to put the work directory
Inside the project, not `/tmp`: a container restart wipes `/tmp` and `/root`,
but the project mount survives. `.work/` next to the subtitles is fine — delete
it when the job is done.

### Chunk size and parallelism
120–150 cues per chunk, 4–6 agents per batch. Bigger chunks drift (dropped
cues, retyped timecodes); wider batches lose everything in flight when the
session is interrupted. Each agent verifies its own chunk before finishing.

## Style
Full sheet with the glossary: `references/style.md`. Short version:

- Spoken Russian, not translated-English word order. Match the register of the
  source: profanity, slang, stutters and broken sentences carry over.
- Names transliterated consistently, and consistently *between tracks of the
  same film* — two subtitle files of one movie must use the same wording for
  the same line.
- Markup is structure, not text: keep `-` dialogue dashes, `♪` music marks,
  `[...]` sound descriptions and speaker tags where they are, and translate
  only what is inside them.
- 1–2 lines per cue, lines ≤ 45 characters. Two short lines read better than
  one long one.
- Keep brands, sites and quoted titles as they are (`YTS.BZ`, `GWAR`,
  `«Как это устроено»`).

## Format pitfalls
`references/formats.md` — the SubRip spec, what real players tolerate, and the
ways a translation job quietly breaks a file (BOM, CRLF, a stray blank line,
an index that skips a number, a watermark cue overlapping the first line).

## Tooling
`scripts/srt_tool.py` (Python 3, no dependencies):

| Command | What it does |
|---|---|
| `info FILE` | cue count, duration, encoding problems, overlaps, longest line |
| `split FILE --out-dir DIR [--cues N] [--prefix P]` | cut into chunks at cue boundaries |
| `assemble OUT PART...` | merge chunks, check the index sequence is continuous |
| `validate FILE [--against SRC]` | strict format check + cue/index/timecode diff against the source (exit 1 on failure) |
| `compare SRC TRANSLATED` | line-count drift and remaining Latin words |
