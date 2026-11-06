---
name: Env example
description: Writing a `.env.example` file — Russian comments, no real values, required variables marked. Use when a project needs a `.env.example`, or when the set of environment variables changed.
---

# The `.env.example` file

A template of the environment variables. It is read by whoever deploys the
project, so **the file you write is in Russian** (AGENTS.md rule 7) — the
instructions here stay in English.

## Format

```bash
# Порт HTTP-сервера. Обязательная переменная.
API_PORT=8080

# Токен доступа к внешнему сервису. Обязательная переменная.
# Значение берётся у администратора, в репозиторий не попадает.
EXTERNAL_API_TOKEN=

# Включает режим отладки. Необязательная переменная, по умолчанию false.
DEBUG=false
```

## Rules

1. **No real values.** Tokens, passwords, keys and URLs with credentials stay
   empty. Only non-secret defaults are allowed: ports, timeouts, flags, paths.
2. **A comment above every variable** — what it is and whether it is required.
   In Russian, one or two lines.
3. **Order by purpose**, not alphabetically: application first, then external
   services, then the database, then development settings. Alphabetical inside
   a group.
4. **Names exactly as in the code.** Take them from the code (`os.environ`,
   `Settings`, `BaseSettings`); do not invent them.
5. **Mark the required ones** with `# Обязательная переменная.` For an
   optional one, state the default instead.
6. **File format** — `KEY=value`, one variable per line, no quotes around
   values, no `export`.
7. **The template is committed; the real `.env` is not.** If a real `.env` is
   already tracked in the repository, say so — that is a leak and a separate
   conversation.

## Procedure

1. Find every place the code reads an environment variable and compare it with
   the existing `.env.example`. The differences are usually the point of the
   task.
2. Update the template: add what is new, remove what the code no longer reads.
3. Check that no real value slipped in.
4. Show the result to the user before they commit it.
