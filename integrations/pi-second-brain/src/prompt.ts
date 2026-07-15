import { readIndex, brainExists } from "./vault.ts";
import { brainPaths } from "./paths.ts";
import { recentDiaries } from "./diary.ts";

export const BRAIN_POLICY = `<second-brain>
This project has a persistent second brain that YOU own and maintain across sessions: a Portent-model markdown knowledge base — typed objects, explicit relationships, and a captured/organized/archived lifecycle. It is the project's evolving history and documentation.

Capture optimistically, in the moment, with second_brain diary_add — the diary is the inbox. Kinds: til (something non-obvious learned), mistake (a failed approach and why), bug (found or fixed), decision, progress, note.

Organize pessimistically with second_brain object_write using Portent types:
- PORT, actionable: project (bounded effort with an output), operation (recurring work), responsibility (long-running accountability over an outcome), task (one-off; may live in the issue tracker instead)
- ENTP, records: event (what happened: decisions, incidents, meetings), note (durable knowledge: docs, references, lessons, decision records), topic (interest area or lens), person (human or agent actor)
Use "kind" for subtypes (til, devdoc, userdoc, ...) instead of inventing types. Relationships: belongs_to = one primary parent; related_to = secondary links. An object is organized when title + type + relationships explain its future use; without relationships it stays captured — attach it or reconsider writing it.

Recall before re-deriving: the index and recent diary are injected below; use second_brain search/read when the task smells like something already learned. Archive (never delete) objects that still have historical value. Keep devdoc/userdoc notes current when behavior changes. Never store secrets, tokens, or personal data.
</second-brain>`;

export const BRAIN_BOOTSTRAP = `<second-brain>
No second brain exists in this project yet (default location: .pi/brain). Once it exists you own it: a Portent-model markdown knowledge base of diary captures (TIL, mistakes, bugs, decisions, progress) and typed objects (project, operation, responsibility, task, event, note, topic, person), persisted across sessions.

For any non-trivial session, initialize it simply by writing: call second_brain diary_add with your first entry (the scaffold is created automatically). Skip it for trivial one-off questions.
</second-brain>`;

export function buildGardenProtocol(specPath?: string): string {
  const spec = specPath ? `The full Portent spec is at ${specPath} — consult it when a modeling call is unclear.\n\n` : "";
  return `<second-brain-gardening>
Run a gardening pass over this project's second brain (the Portent-model markdown vault whose index was injected as BRAIN.md). ${spec}Work through it now:

1. Read BRAIN.md and skim every object and recent diary files.
2. Organize the captured: every object with organized: false either gets a clear title, right type, and enough relationships to explain its future use (then set organized: true) — or, if it cannot attach to any project, responsibility, operation, or topic, delete it. Capture optimistically, organize pessimistically.
3. Distill the diary: recurring TILs, mistakes, bug patterns, and decisions that appear more than once deserve a durable object (object_write — usually a note or event, linked via belongs_to/related_to). After distilling a diary file, set its organized: true. Do not delete diary files — they are the historical record.
4. Merge near-duplicate objects; keep the better slug, fold content in, delete the loser, and fix wikilinks that pointed at it.
5. Archive stale objects (second_brain archive) instead of deleting when they retain historical, audit, or reference value.
6. Refresh BRAIN.md: every active object has exactly one line with a sharp hook in its type's section; remove lines for deleted objects.
7. Update stale docs: if devdoc/userdoc notes contradict the current code, fix them.
8. Report what changed — organized, distilled, merged, archived, refreshed — as a short list.

Use the second_brain tool for writes so the index stays consistent; use your normal file tools for reading, edits to frontmatter, and deleting.
</second-brain-gardening>`;
}

const MAX_CONTEXT_CHARS = 12_000;
const RECENT_DIARY_COUNT = 2;

/**
 * Build the per-turn context block: policy plus the index and recent diary so
 * recall is guaranteed instead of depending on the agent to call the tool.
 */
export function buildBrainContext(root: string): string {
  const paths = brainPaths(root);
  if (!brainExists(paths)) return BRAIN_BOOTSTRAP;

  const parts = [BRAIN_POLICY];
  const index = readIndex(paths).trim();
  if (index) parts.push(`<brain-index path="BRAIN.md">\n${index}\n</brain-index>`);

  for (const diary of recentDiaries(root, RECENT_DIARY_COUNT)) {
    parts.push(`<brain-diary date="${diary.date}">\n${diary.content.trim()}\n</brain-diary>`);
  }

  const combined = parts.join("\n\n");
  return combined.length > MAX_CONTEXT_CHARS
    ? combined.slice(0, MAX_CONTEXT_CHARS) + "\n[brain context truncated]"
    : combined;
}
