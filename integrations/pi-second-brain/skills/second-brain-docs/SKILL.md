---
name: second-brain-docs
description: Author and maintain developer and user documentation inside the project's Portent-model second brain (.pi/brain). Use when asked to document a feature, write user-facing help, or bring the project's docs up to date from the diary and code history.
---

# Writing docs in the second brain

Dev and user docs are Portent **Note** objects in the project's second brain (default `.pi/brain`), written via the `second_brain` tool with `object_write`, `type: "note"`, and `kind: "devdoc"` or `kind: "userdoc"`. Each doc should `belongs_to` the project or responsibility it primarily supports (Portent: a note belongs to the object it helps advance).

## Sources — mine before you write

1. `second_brain index` — see what docs already exist; update rather than duplicate.
2. The diary (`diary/*.md`) — captured decisions, bugs, and TILs are the raw history of *why* things are the way they are.
3. The code itself — docs must describe current behavior, not remembered behavior. Verify claims against the code before writing them down.

## Dev docs (`kind: devdoc`)

One note per subsystem or cross-cutting concern. Structure: what it is (2–3 sentences), how it works (the non-obvious parts only), gotchas (from mistake/bug events — link them with `related`), and pointers to key files as `path/to/file.ts` references.

## User docs (`kind: userdoc`)

One note per user-facing capability. Write for the user, not the implementer: what they can do, how to do it step by step, and limitations. No internal jargon, no file paths, no architecture.

## Rules

- Every doc note gets a sharp one-line `hook` — it becomes the BRAIN.md index line.
- Docs must be organized objects: give them `belongs_to` (their project/responsibility) and `related` links to the topics, events, and people they draw on, instead of restating that context.
- When behavior changes during a task, update the affected doc note in the same session and capture a `progress` diary entry noting the doc update.
- The full knowledge-base model is in the package's `PORTENT.md` — consult it when a modeling call is unclear.
