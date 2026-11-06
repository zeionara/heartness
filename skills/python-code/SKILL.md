---
name: Python code
description: Conventions for writing and changing Python in this setup — project virtualenv at /opt/<project>/.venv, English code and comments, pytest for tests, no new dependencies without asking. Use when writing, editing or reviewing Python.
---

# Python code

The house style for Python in this setup. The project's own conventions win
when they conflict — read `pyproject.toml`, `setup.cfg`, the linter config and
the neighbouring modules before writing code.

## Environment

- The virtualenv lives at `/opt/<project>/.venv`. Use it; do not create one
  elsewhere and do not activate it globally.
- Never install a package as a side effect of a task. If a task needs a new
  dependency, say which one, why, and ask first.
- No secrets in code. Read configuration from the environment.

## Code

- English for everything in the repository: identifiers, comments, docstrings,
  commit messages. The one exception is an **enterprise** project (GitLab
  remote), where the artefacts people read outside the team — README,
  `.env.example`, Plane issues — are in Russian. In an **experimental**
  project (any other remote) everything is English, those artefacts included.
- Type hints on public functions and dataclasses. The project may already have
  a convention — follow it instead of adding a second one.
- Comments explain **why**, not what. If the code says what it does, delete the
  comment.
- Docstrings say what the function guarantees and what it raises, not a
  restatement of the signature.
- Raise a specific exception with a message that says what was expected and
  what was found. Never swallow an exception silently; if it is genuinely
  ignorable, say why in the code.
- No `print` in library code. Use the project's logger.
- No mutable default arguments. No bare `except:`. No swallowed errors.
- Keep functions short enough to read in one screen; extract when a block needs
  a comment to explain it.
- Follow the project's formatter and linter exactly. Run them before saying
  the work is done.

## Tests

- pytest, in the project's layout (`tests/` next to the package, or the
  project's own convention).
- One behaviour per test. The name states the behaviour, not the function.
- Arrange, act, assert — with the arrange part explicit, so a failure points
  at the input.
- Cover the failure paths, not only the happy one: empty input, bad types,
  missing configuration, a dependency that raises.
- A test that cannot fail is a liability. If you cannot write a meaningful
  assertion, do not write the test.

## Before calling it done

1. The tests you touched pass — run them in this turn and read the output.
2. The linter and formatter pass.
3. The diff contains no debugging leftovers, no commented-out code and no
   unrelated changes.
4. Anything you could not verify is stated as unverified, not implied to work.
