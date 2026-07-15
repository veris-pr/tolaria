# @tolaria/pi-second-brain

A [pi](https://github.com/badlogic/pi-mono) extension that gives the agent a **persistent, per-project second brain**: a plain-markdown knowledge base of diary captures, typed objects, and living documentation that evolves with the project across sessions.

The knowledge base follows the **[Portent spec](./PORTENT.md)** — typed objects connected by explicit relationships with a captured/organized/archived lifecycle — and is written in Tolaria's note format (frontmatter `type:`, `aliases:`/`belongs_to:`/`related_to:` wikilinks), so you can open the agent's brain directly in Tolaria and browse it like any other vault.

## The model (Portent)

- **Types** — PORT (actionable): `Project`, `Operation`, `Responsibility`, `Task` · ENTP (records): `Event`, `Note`, `Topic`, `Person`. Subtypes (til, devdoc, userdoc, …) are a `kind` property, not new types.
- **Relationships** — `belongs_to` (one primary parent) and `related_to` (secondary links).
- **Lifecycle** — *captured* (diary inbox, optimistic) → *organized* (title + type + relationships explain future use, pessimistic) → *archived* (hidden from active views, still searchable; archive instead of deleting).

## What the agent gets

- **Diary = capture inbox** — `diary/YYYY-MM-DD.md`, timestamped bullets under **TIL / Mistakes / Bugs / Decisions / Progress / Notes**. Captured Events; the evolving history of the work.
- **Durable objects** — `object_write` promotes knowledge into typed files (`event-*`, `note-*`, `topic-*`, `person-*`, `project-*`, …). Objects without relationships stay *captured* until linked.
- **`BRAIN.md`** — the index: one hook line per active object, grouped by type, with an **Archived** section; auto-maintained on every write.
- **Guaranteed recall** — the Portent policy, index, and two most recent diaries are injected into the system prompt every turn; the agent doesn't have to remember to look.
- **Docs as objects** — dev/user documentation are Notes (`kind: devdoc` / `kind: userdoc`) that belong to their project or responsibility.

## Tolaria integration

pi has no MCP support — this package is a **native pi extension** (tool + hooks + skills), which is exactly what Tolaria's app-managed pi runs load. Tolaria seeds its transient pi agent dir from `~/.pi/agent`, so a **globally installed** pi-second-brain is active inside the app's AI panel automatically. When the extension detects it is running under Tolaria (via the transient agent dir's `mcp.json`), it upgrades itself:

- **Visible brain** — the vault lives at `<vault>/brain/` instead of `.pi/brain` (Tolaria skips dot-directories), so the agent's knowledge base is browsable in the app: types, icons, wikilinks, Properties panel.
- **Live UI updates** — every write pings Tolaria's UI WebSocket bridge with `vault_changed`, so new diary entries and objects appear in the app as the agent works.
- **`show` action** — the agent can open any brain note as a tab in the app (`second_brain show name=...`) when you should look at something.
- **Native archive** — Portent's `archived: true` is the same flag Tolaria's views filter on, so archived objects disappear from active views in the app exactly as the spec intends.
- **Icons** — every object carries a Phosphor `_icon` (target for projects, calendar for events, notebook for diaries, brain for the index, …) so the vault looks native, not generated.

Outside Tolaria nothing changes: dot-folder brain, no sockets, same behavior.

> Install with an **absolute path** (or `npm:` once published). pi stores relative install paths relative to its agent dir, which breaks resolution inside Tolaria's transient agent dir.

## Install

```bash
# per project (recommended — the brain is per-project anyway)
cd your-project && pi install /path/to/tolaria/integrations/pi-second-brain -l

# or globally
pi install /path/to/tolaria/integrations/pi-second-brain
```

Commit `.pi/brain/` to give the brain durable, reviewable history — or gitignore it for a local-only brain.

## Use

The agent maintains the brain autonomously via the `second_brain` tool (`diary_add`, `object_write`, `read`, `list`, `search`, `index`, `archive`, `show`). The brain scaffolds itself on the first write — no setup step needed.

| Command | Effect |
|---|---|
| `/brain` | Status: object counts by type, captured/archived counts, latest diary |
| `/brain-init` | Scaffold the vault explicitly |
| `/til <text>` | Quick TIL capture |
| `/oops <text>` | Quick mistake capture |
| `/brain-garden` | Agent turn that organizes captured objects, distills the diary into durable objects, merges duplicates, archives stale entries, and refreshes the index |

The bundled `second-brain-docs` skill guides deeper documentation passes.

## Configuration

| Env var | Effect |
|---|---|
| `PI_BRAIN_DIR` | Vault location (default `.pi/brain`, resolved against the project cwd) |
| `PI_BRAIN_DISABLE=1` | Disable the extension for a run |

## Development

```bash
pnpm install
pnpm test        # vitest
pnpm typecheck
```

No build step: pi loads `src/entry.ts` directly.
