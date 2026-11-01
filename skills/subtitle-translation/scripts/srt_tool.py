#!/usr/bin/env python3
"""SubRip (SRT) tooling for subtitle translation.

Subcommands:
  info      FILE                          — quick survey of a subtitle file
  split     FILE --out-dir DIR [--cues N] — cut into chunks at cue boundaries
  assemble  OUT PART [PART ...]           — merge chunks into one file
  validate  FILE [--against SOURCE]       — strict format + structural check
  compare   SOURCE TRANSLATED             — what changed between two tracks

Exit code is 1 when a check fails, so it can gate a pipeline.
"""

from __future__ import annotations

import argparse
import os
import re
import sys

TIMECODE = re.compile(r"^(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})$")
INDEX = re.compile(r"^\d+$")
LATIN_WORD = re.compile(r"[A-Za-z]{3,}")


class Cue:
    __slots__ = ("index", "timecode", "start", "end", "lines")

    def __init__(self, index: str, timecode: str, lines: list[str]):
        self.index = index
        self.timecode = timecode
        self.start, self.end = to_milliseconds(timecode)
        self.lines = lines

    @property
    def text(self) -> str:
        return " ".join(self.lines)


def to_milliseconds(timecode: str) -> tuple[int, int]:
    start, end = timecode.split(" --> ")
    values = []
    for stamp in (start, end):
        hours, minutes, rest = stamp.split(":")
        seconds, millis = rest.split(",")
        values.append(
            ((int(hours) * 60 + int(minutes)) * 60 + int(seconds)) * 1000 + int(millis)
        )
    return values[0], values[1]


def read_file(path: str) -> tuple[bytes, list[str]]:
    """Return raw bytes and the list of file-level format problems."""
    with open(path, "rb") as handle:
        raw = handle.read()
    problems: list[str] = []
    if raw.startswith(b"\xef\xbb\xbf"):
        problems.append("file starts with a UTF-8 BOM")
    if b"\r" in raw:
        problems.append("file contains CR characters (CRLF line endings)")
    if not raw:
        problems.append("file is empty")
        return raw, problems
    if not raw.endswith(b"\n"):
        problems.append("file does not end with a newline")
    elif raw.endswith(b"\n\n"):
        problems.append("file ends with a blank line")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        problems.append(f"file is not valid UTF-8: {error}")
        return raw, problems
    if "\n\n\n" in text:
        problems.append("file contains consecutive blank lines")
    if re.search(r"[ \t]+\n", text):
        problems.append("file contains trailing whitespace")
    return raw, problems


def parse_cues(text: str) -> tuple[list[Cue], list[str]]:
    """Split a subtitle file into cues, reporting every structural problem."""
    problems: list[str] = []
    cues: list[Cue] = []
    chunks = text.strip("\n").split("\n\n")
    for position, chunk in enumerate(chunks, start=1):
        lines = chunk.split("\n")
        if len(lines) < 3:
            problems.append(f"cue #{position}: expected 3+ lines, got {len(lines)}: {lines}")
            continue
        index, timecode = lines[0].strip(), lines[1].strip()
        if not INDEX.match(index):
            problems.append(f"cue #{position}: index is not a number: {index!r}")
        match = TIMECODE.match(timecode)
        if not match:
            problems.append(f"cue #{position}: bad timecode line: {timecode!r}")
            continue
        body = lines[2:]
        if not any(line.strip() for line in body):
            problems.append(f"cue #{position} (index {index}): empty text")
        cues.append(Cue(index, timecode, body))
    return cues, problems


def load(path: str) -> tuple[list[Cue], list[str]]:
    _, file_problems = read_file(path)
    with open(path, "rb") as handle:
        raw = handle.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return [], file_problems + ["file is not valid UTF-8"]
    cues, cue_problems = parse_cues(text)
    return cues, file_problems + cue_problems


def report(label: str, problems: list[str], limit: int = 20) -> None:
    """Print at most `limit` problems, then a summary line."""
    if not problems:
        return
    for problem in problems[:limit]:
        print(f"  - {problem}")
    if len(problems) > limit:
        print(f"  ... and {len(problems) - limit} more")


def format_duration(milliseconds: int) -> str:
    seconds, millis = divmod(milliseconds, 1000)
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{millis:03d}"


def command_info(args: argparse.Namespace) -> int:
    cues, problems = load(args.file)
    print(f"file      : {args.file}")
    print(f"size      : {os.path.getsize(args.file)} bytes")
    print(f"cues      : {len(cues)}")
    if cues:
        print(f"range     : {cues[0].index} .. {cues[-1].index}")
        print(f"duration  : {format_duration(cues[-1].end)}")
        widths = [len(line) for cue in cues for line in cue.lines]
        print(f"max line  : {max(widths)} chars")
        latin = [cue for cue in cues if LATIN_WORD.search(cue.text)]
        print(f"cues with latin words: {len(latin)}")
        overlaps = [
            (a.index, b.index)
            for a, b in zip(cues, cues[1:])
            if b.start < a.end
        ]
        print(f"overlapping cues: {len(overlaps)}" + (f" {overlaps[:10]}" if overlaps else ""))
    print(f"format problems: {len(problems)}")
    report("format", problems)
    return 0


def command_split(args: argparse.Namespace) -> int:
    cues, problems = load(args.file)
    if problems:
        print("source has problems, splitting anyway:")
        for problem in problems:
            print(f"  - {problem}")
    os.makedirs(args.out_dir, exist_ok=True)
    size = max(1, args.cues)
    written: list[str] = []
    for start in range(0, len(cues), size):
        group = cues[start : start + size]
        first = int(group[0].index)
        last = int(group[-1].index)
        name = f"{args.prefix}_part{first:05d}-{last:05d}.srt"
        path = os.path.join(args.out_dir, name)
        body = "\n\n".join(
            "\n".join([cue.index, cue.timecode] + cue.lines) for cue in group
        )
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(body + "\n")
        written.append(path)
    print(f"{len(cues)} cues -> {len(written)} files in {args.out_dir}")
    for path in written:
        print(f"  {path}")
    return 0


def command_assemble(args: argparse.Namespace) -> int:
    parts = sorted(args.parts)
    merged: list[Cue] = []
    problems: list[str] = []
    for part in parts:
        cues, part_problems = load(part)
        problems.extend(f"{os.path.basename(part)}: {problem}" for problem in part_problems)
        if not cues:
            continue
        if merged:
            expected = int(merged[-1].index) + 1
            actual = int(cues[0].index)
            if actual != expected:
                problems.append(
                    f"{os.path.basename(part)}: first index {actual} breaks the sequence "
                    f"(expected {expected})"
                )
        merged.extend(cues)
    body = "\n\n".join(
        "\n".join([cue.index, cue.timecode] + cue.lines) for cue in merged
    )
    with open(args.out, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(body + "\n")
    print(f"{len(parts)} parts -> {args.out} ({len(merged)} cues)")
    report("assemble", problems)
    return 1 if problems else 0


def command_validate(args: argparse.Namespace) -> int:
    cues, problems = load(args.file)
    indexes = [cue.index for cue in cues]
    if indexes != [str(number) for number in range(1, len(cues) + 1)]:
        problems.append("cue indices are not sequential 1..N")
    for cue in cues:
        if cue.start >= cue.end:
            problems.append(f"cue {cue.index}: start is not before end")

    if args.against:
        source_cues, source_problems = load(args.against)
        if len(source_cues) != len(cues):
            problems.append(
                f"cue count differs from source: {len(cues)} vs {len(source_cues)}"
            )
        for source_cue, cue in zip(source_cues, cues):
            if source_cue.index != cue.index:
                problems.append(
                    f"index mismatch: source {source_cue.index} vs translated {cue.index}"
                )
            if source_cue.timecode != cue.timecode:
                problems.append(
                    f"cue {cue.index}: timecode differs: "
                    f"source {source_cue.timecode!r} vs translated {cue.timecode!r}"
                )
        if source_problems:
            print("note: the source file itself has problems:")
            report("source", source_problems)

    print(f"{args.file}: {len(cues)} cues, {len(problems)} problems")
    report("validate", problems)
    print("OK" if not problems else "FAILED")
    return 0 if not problems else 1


def command_compare(args: argparse.Namespace) -> int:
    source_cues, _ = load(args.source)
    translated_cues, translated_problems = load(args.translated)
    print(f"source     : {len(source_cues)} cues")
    print(f"translated : {len(translated_cues)} cues")
    report("translated", translated_problems)

    if len(source_cues) == len(translated_cues):
        timecode_drift = [
            (source.index, source.timecode, cue.timecode)
            for source, cue in zip(source_cues, translated_cues)
            if source.timecode != cue.timecode
        ]
        print(f"timecode drift: {len(timecode_drift)}")
        report("timecode", [f"cue {item[0]}: {item[1]} vs {item[2]}" for item in timecode_drift])

    line_drift = [
        (source.index, len(source.lines), len(cue.lines))
        for source, cue in zip(source_cues, translated_cues)
        if len(source.lines) != len(cue.lines)
    ]
    print(f"cues with a different line count: {len(line_drift)}")
    report("line count", [f"cue {item[0]}: {item[1]} -> {item[2]} lines" for item in line_drift])

    leftovers = [
        (cue.index, LATIN_WORD.findall(cue.text))
        for cue in translated_cues
        if LATIN_WORD.search(cue.text)
    ]
    print(f"cues that still contain latin words: {len(leftovers)}")
    report("latin", [f"cue {index}: {words}" for index, words in leftovers])
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    info = subparsers.add_parser("info", help="survey a subtitle file")
    info.add_argument("file")
    info.set_defaults(func=command_info)

    split = subparsers.add_parser("split", help="cut a file into chunks")
    split.add_argument("file")
    split.add_argument("--out-dir", required=True)
    split.add_argument("--cues", type=int, default=150)
    split.add_argument("--prefix", default="part")
    split.set_defaults(func=command_split)

    assemble = subparsers.add_parser("assemble", help="merge chunks")
    assemble.add_argument("out")
    assemble.add_argument("parts", nargs="+")
    assemble.set_defaults(func=command_assemble)

    validate = subparsers.add_parser("validate", help="strict format and structure check")
    validate.add_argument("file")
    validate.add_argument("--against", help="source file to compare cue count, indices and timecodes with")
    validate.set_defaults(func=command_validate)

    compare = subparsers.add_parser("compare", help="diff two tracks")
    compare.add_argument("source")
    compare.add_argument("translated")
    compare.set_defaults(func=command_compare)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
