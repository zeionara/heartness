---
name: README
description: Writing a README — the project's language, short, runnable, no marketing. Use when a project needs a README, or when an existing one has drifted from the code.
---

# The README

The first thing a new person sees. It answers four questions: what is this,
what does it need, how do I run it, where do I look when it breaks.

It is written in **Russian for an enterprise project** (GitLab remote) and in
**English for an experimental one** (any other remote) — see AGENTS.md rule 7.
The instructions here stay in English.

The example below shows the enterprise case; an experimental project gets the
same structure with English headings and prose.

## Structure

```markdown
# Название сервиса

Одно предложение о том, что делает сервис.

## Требования

- Python 3.12
- Переменные окружения из `.env.example`

## Быстрый старт

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m service
```

## Переменные окружения

Короткий список; подробности — в `.env.example`.

## Разработка

```bash
pytest
ruff check .
```

## Структура проекта

- `src/` — код сервиса
- `tests/` — тесты

## Если что-то не работает

На что смотреть в первую очередь.
```

## Rules

1. **One language throughout.** Headings, prose, comments in code blocks. In an
   enterprise project that is Russian, in an experimental one English.
   Identifiers and paths stay as they are in the code.
2. **The first line says what it is** — one sentence, no adjective.
3. **Every command must work.** Copy the project's real commands from its
   config, not from memory. A README with a command that fails is worse than
   no README.
4. **No marketing.** No "powerful", "seamless", "modern", "enterprise".
5. **Length is a feature.** If a section does not answer a question the reader
   has, cut it. A long README is not read; the section that matters is buried.
6. **Do not duplicate the reference material.** Environment variables live in
   `.env.example`, the API in the OpenAPI schema, the changelog in the history.
   The README points at them.
7. **Keep it true.** When the code changes — a command, a port, a path — update
   the README in the same change. A stale README costs more time than no
   README.
8. **No secrets, ever.** Tokens, passwords and private hosts do not go into a
   README.

## Procedure

1. Read the code: entry point, dependencies, configuration, tests, the lint and
   format commands. The README follows the code, not the other way round.
2. Check whether an existing README already covers most of it, and edit that
   instead of starting over.
3. Write it, then run every command in it once, exactly as written.
4. Show the result to the user before they commit it.
