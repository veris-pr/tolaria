import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { appendDiary } from "./diary.ts";
import { archiveObject, listObjects, readObjectByName, writeObject } from "./notes.ts";
import { brainPaths } from "./paths.ts";
import { formatHits, searchBrain } from "./search.ts";
import { readIndex } from "./vault.ts";
import type { UiNotifier } from "./tolaria.ts";
import { DIARY_KINDS, PORTENT_TYPES, type DiaryKind, type PortentType } from "./types.ts";

export interface BrainToolParams {
  action: "diary_add" | "object_write" | "read" | "list" | "search" | "index" | "archive" | "show";
  kind?: DiaryKind | string;
  type?: PortentType;
  title?: string;
  content?: string;
  hook?: string;
  belongs_to?: string;
  related?: string[];
  organized?: boolean;
  name?: string;
  query?: string;
}

export interface BrainToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: { changedFile?: string; openFile?: string };
}

function text(value: string, details: BrainToolResult["details"] = {}): BrainToolResult {
  return { content: [{ type: "text", text: value }], details };
}

function requireParam<T>(value: T | undefined, field: string, action: string): T {
  if (value === undefined || value === "") {
    throw new Error(`"${field}" is required for action "${action}"`);
  }
  return value;
}

function lifecycleBadge(o: { organized: boolean; archived: boolean }): string {
  if (o.archived) return " [archived]";
  return o.organized ? "" : " [captured]";
}

/** Execute one second_brain action against the vault at `root`. Pure of pi APIs for testability. */
export function executeBrainAction(root: string, params: BrainToolParams, now: Date) {
  switch (params.action) {
    case "diary_add": {
      const kind = requireParam(params.kind, "kind", "diary_add") as DiaryKind;
      if (!DIARY_KINDS.includes(kind)) {
        throw new Error(`"kind" must be one of: ${DIARY_KINDS.join(", ")}`);
      }
      const content = requireParam(params.content, "content", "diary_add");
      const file = appendDiary(root, kind, content, now);
      return text(`Captured to diary (${kind}): ${file}`, { changedFile: file });
    }
    case "object_write": {
      const result = writeObject({
        root,
        type: requireParam(params.type, "type", "object_write"),
        title: requireParam(params.title, "title", "object_write"),
        content: requireParam(params.content, "content", "object_write"),
        kind: typeof params.kind === "string" ? params.kind : undefined,
        hook: params.hook,
        belongsTo: params.belongs_to,
        related: params.related,
        organized: params.organized,
        now,
      });
      const lifecycle = result.organized ? "organized" : "captured — add belongs_to/related to organize";
      return text(
        `${result.created ? "Created" : "Updated"} [[${result.slug}]] (${lifecycle}); index refreshed. ${result.file}`,
        { changedFile: result.file },
      );
    }
    case "read": {
      const found = readObjectByName(root, requireParam(params.name, "name", "read"));
      return text(found ? found.content : `No object matching "${params.name}".`);
    }
    case "list": {
      const objects = listObjects(root, params.type);
      if (objects.length === 0) return text("No objects yet.");
      return text(objects.map((o) => `${o.slug} (${o.type})${lifecycleBadge(o)}`).join("\n"));
    }
    case "search": {
      return text(formatHits(searchBrain(root, requireParam(params.query, "query", "search"))));
    }
    case "index": {
      const index = readIndex(brainPaths(root));
      return text(index || "Brain not initialized yet — any diary_add or object_write will scaffold it.");
    }
    case "archive": {
      const archived = archiveObject(root, requireParam(params.name, "name", "archive"), now);
      if (!archived) return text(`No object matching "${params.name}".`);
      return text(`Archived [[${archived.slug}]] — hidden from active views, still searchable.`, { changedFile: archived.file });
    }
    case "show": {
      const found = readObjectByName(root, requireParam(params.name, "name", "show"));
      if (!found) return text(`No object matching "${params.name}".`);
      return text(`Requested Tolaria to open [[${found.ref.slug}]] as a tab.`, { openFile: found.ref.file });
    }
  }
}

export function registerBrainTool(pi: ExtensionAPI, getRoot: () => string, notifier?: UiNotifier): void {
  pi.registerTool({
    name: "second_brain",
    label: "Second Brain",
    description:
      "Your persistent per-project second brain: a Portent-model markdown knowledge base of typed objects (project, operation, responsibility, task, event, note, topic, person) with belongs_to/related_to relationships and a captured/organized/archived lifecycle. diary_add captures to the daily inbox; object_write creates/updates durable objects (auto-updates the BRAIN.md index); search/read/list/index recall; archive hides without deleting.",
    promptSnippet: "Per-project Portent second brain: diary inbox, typed objects, docs",
    promptGuidelines: [
      "Capture with diary_add in the moment: a til when you learn something non-obvious, a mistake when an approach fails, a bug when found or fixed, a decision when made, progress at milestones",
      "Promote durable knowledge with object_write using Portent types — PORT (project, operation, responsibility, task) for actionable work, ENTP (event, note, topic, person) for records; use the kind property for subtypes (til, devdoc, userdoc) instead of inventing types",
      "Give objects relationships: belongs_to for the one primary parent, related for secondary links — an object without relationships stays captured",
      'Recall proactively: "search" or "read" before re-deriving anything this project may have already learned',
      "Archive instead of deleting when an object still has historical value; keep devdoc/userdoc notes current when behavior changes",
      'When running inside the Tolaria app, use "show" to open a brain note as a tab when the user should look at it',
      "Never store secrets, tokens, or personal data in the brain",
    ],
    parameters: Type.Object({
      action: StringEnum(["diary_add", "object_write", "read", "list", "search", "index", "archive", "show"] as const, {
        description:
          'Operation: "diary_add" (append a timestamped capture to today\'s diary inbox), "object_write" (create/update a durable Portent object and its index line), "read" (fetch one object by slug or title), "list" (enumerate objects with lifecycle badges, optionally by type), "search" (substring search across the whole brain), "index" (return BRAIN.md), "archive" (set archived: true and move the index line to Archived), "show" (open the note as a tab in the Tolaria app when running inside it).',
      }),
      kind: Type.Optional(
        Type.String({
          description:
            'For "diary_add": the inbox section — til, mistake, bug, decision, progress, or note. For "object_write": optional subtype property (e.g. "til", "devdoc", "userdoc", "decision-record").',
        }),
      ),
      type: Type.Optional(
        StringEnum(PORTENT_TYPES, {
          description:
            'Portent type — required for "object_write", optional filter for "list". PORT (actionable): project, operation, responsibility, task. ENTP (records): event, note, topic, person.',
        }),
      ),
      title: Type.Optional(
        Type.String({ description: 'Human title for "object_write", e.g. "Vite HMR loses editor state". Becomes the slug.' }),
      ),
      content: Type.Optional(
        Type.String({ description: 'Markdown text: the diary entry for "diary_add", or the object body for "object_write".' }),
      ),
      hook: Type.Optional(
        Type.String({ description: 'One-line index hook for "object_write" (defaults to the first line of content).' }),
      ),
      belongs_to: Type.Optional(
        Type.String({ description: 'Slug of the single primary parent for "object_write" (Portent belongs_to), e.g. "project-sync-rewrite".' }),
      ),
      related: Type.Optional(
        Type.Array(Type.String(), {
          description: 'Slugs of secondary associations for "object_write" (Portent related_to).',
        }),
      ),
      organized: Type.Optional(
        Type.Boolean({
          description: 'Lifecycle override for "object_write". Default: true when belongs_to/related are given, else the object stays captured.',
        }),
      ),
      name: Type.Optional(Type.String({ description: 'Object slug, file name, or title for "read", "archive", and "show".' })),
      query: Type.Optional(Type.String({ description: 'Search text for "search" (case-insensitive substring).' })),
    }),
    async execute(_toolCallId, params) {
      const result = executeBrainAction(getRoot(), params as BrainToolParams, new Date());
      if (result.details.changedFile) notifier?.changed(result.details.changedFile);
      if (result.details.openFile) {
        if (!notifier) return text("Not running inside Tolaria — cannot open app tabs. Use read instead.");
        notifier.open(result.details.openFile);
      }
      return result;
    },
  });
}
