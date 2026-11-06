---
name: Software design
description: A design bar for code that has to survive the next change — smallest design that works, explicit interfaces, no speculative generality, errors handled where they can be handled. Use when designing a module, choosing an abstraction, or deciding how pieces fit together.
---

# Software design

Not a style guide. A set of decisions that keep a change small and reviewable.

## Start from the contract

Write down what the thing does before how it does it: the inputs, the outputs,
the guarantees and the failure modes. If the contract cannot be stated in a
sentence, the design is not ready yet.

Design against the contract, not against a guess about the future. A second
real caller is evidence for an abstraction; a hypothetical one is not.

## Choose the smallest thing that works

- Prefer the straightforward thing that works now over the flexible thing that
  might work later.
- One obvious way to do it. Two ways to do it is a decision waiting to be made
  by someone who has no context.
- Do not build a layer that contains no logic — a pass-through wrapper, a base
  class with one implementation, a factory that always returns the same type.
- Keep the module boundary where the responsibility changes, not where the file
  happens to end.

## Make the interface explicit

- Name things after what they do, not after how they are implemented.
- Pass what is needed; return what is needed. A function that returns a
  seven-field tuple is a type that has not been written down yet.
- Keep the public surface of a module small. Everything else is free to
  change.
- Depend on interfaces, not on concrete classes, when the difference is
  likely to matter — not everywhere by default.

## Handle errors where they can be handled

- Fail fast on a programmer error: an invalid argument, a broken invariant.
- Handle an expected external failure at the boundary that can do something
  about it — a retry, a fallback, a clear message.
- Do not invent error types for every failure. Reuse the project's exceptions
  unless the caller must handle this case differently.
- Never hide an error behind a default value that looks like success.

## Keep it reversible

- Small steps, each independently reviewable.
- A change that is hard to undo is a change that needs a plan and a gate —
  which is what the SDD flow is for.
- Leave the codebase easier to read than you found it, but only within the
  scope of the task. Unrelated cleanup is a separate change.

## When the design grows

When a module passes a hundred lines of logic, a dozen parameters or a second
responsibility, that is the signal to split it — not a reason to add a
framework. Extract the part with the clearest name, keep the rest working, and
stop there.

## In review

Ask of every new piece: what does this remove? If the answer is "nothing", it
is not pulling its weight, and the simpler version that replaces it is better.
