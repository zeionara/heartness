# Subtitle formats and how they break

## SubRip (`.srt`) — the format this skill assumes

```text
1
00:00:31,161 --> 00:00:32,814
Текст первой строки
вторая строка

2
00:00:32,815 --> 00:00:34,338
Одна строка
```

- Cue number, then the timecode line, then one or more text lines, then one
  blank line. The blank line before the last cue is optional in the wild but
  write it anyway; the file ends with exactly one newline.
- Timecodes: `HH:MM:SS,mmm` — two digits each, comma before milliseconds.
  Hours may exceed 99 in theory, but keep two digits.
- The index is a counter, not an identifier. Players mostly ignore it, but
  tools (and `srt_tool.py`) rely on it: keep it sequential and matching the
  source.
- Text is plain UTF-8. Markup conventions (`-`, `♪`, `[]`) are not part of the
  spec but are understood by every player and by humans.

## WebVTT (`.vtt`)
Same idea, different wrapper: `WEBVTT` header, optional cue identifiers
instead of numbers, `HH:MM:SS.mmm` with a **dot** and optional hours
(`MM:SS.mmm`). Cue settings (`align:start position:10%`) follow the timecode.
Converting SRT → VTT: drop the indices, change `,` to `.`, add the header.
Converting back: renumber, change `.` to `,`, drop the header.

## Advanced SubStation Alpha (`.ass`)
A script format, not a cue list: `Events:` sections with `Dialogue:` lines of
`Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text`. Translation
touches only the last field; the timings are `H:MM:SS.cc` (centiseconds).
Styled tags (`{\i1}`, `{\pos(...)})` live inside the text and must survive
untouched.

## How a translation job quietly breaks a file
| Symptom | Cause | Fix |
|---|---|---|
| First cue missing in some players | UTF-8 BOM before the first index | strip the BOM |
| Whole file on one line | CRLF endings | convert to LF |
| Player stops at cue 40 | a timecode line lost its `,` or a digit | validate against the source |
| Cues shifted by one | an index skipped a number, or a cue was dropped | compare cue counts and indices |
| Two cues on the same line | the blank separator is missing | one blank line between cues |
| Trailing garbage at the end | file ends with `\n\n` or a stray cue | exactly one trailing newline |
| Text merged into the timecode line | a missing line break after the timecode | timecode line stands alone |
| Invisible first character | a non-breaking space or a zero-width joiner | plain spaces |

## Source quirks that are not bugs to fix
Real subtitle files from the internet carry their own damage:
- a watermark cue (`Downloaded from YTS.BZ`) overlapping the first line of the
  film;
- two consecutive blank lines or a trailing blank line;
- cues that overlap by a few milliseconds;
- a `[Beep]` cue where a sound should be;
- inconsistent spacing in speaker tags (`-Sam:` vs `- Sam:`).

The translation keeps the source's quirks. Timecodes are copied verbatim, so
overlaps and odd spacing survive into the output exactly as they were. Fix the
source separately if the user asks for it — never as a side effect of
translation.

## Reading the source before translating
Run `srt_tool.py info FILE` first. It tells you the cue count, the duration,
the encoding problems, the overlapping cues and the longest line — the facts
you need to size the job and to tell the user what the file contains.
