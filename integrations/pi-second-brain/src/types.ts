export const PORTENT_TYPES = [
  "project",
  "operation",
  "responsibility",
  "task",
  "event",
  "note",
  "topic",
  "person",
] as const;

export type PortentType = (typeof PORTENT_TYPES)[number];

/** Diary capture labels — properties on entries, not object types (Portent: prefer properties before root types). */
export const DIARY_KINDS = [
  "til",
  "mistake",
  "bug",
  "decision",
  "progress",
  "note",
] as const;

export type DiaryKind = (typeof DIARY_KINDS)[number];

export interface TypeSpec {
  /** File name prefix, e.g. `note-` -> `note-vite-hmr-gotcha.md`. */
  prefix: string;
  /** Frontmatter `type:` value. */
  frontmatterType: string;
  /** Section heading in BRAIN.md this type indexes under. */
  indexSection: string;
  /** Phosphor icon name Tolaria renders for the note (frontmatter `_icon`). */
  icon: string;
}

export const TYPE_SPECS: Record<PortentType, TypeSpec> = {
  project: { prefix: "project-", frontmatterType: "Project", indexSection: "Projects", icon: "target" },
  operation: { prefix: "operation-", frontmatterType: "Operation", indexSection: "Operations", icon: "arrows-clockwise" },
  responsibility: { prefix: "responsibility-", frontmatterType: "Responsibility", indexSection: "Responsibilities", icon: "shield" },
  task: { prefix: "task-", frontmatterType: "Task", indexSection: "Tasks", icon: "check-circle" },
  event: { prefix: "event-", frontmatterType: "Event", indexSection: "Events", icon: "calendar" },
  note: { prefix: "note-", frontmatterType: "Note", indexSection: "Notes", icon: "note" },
  topic: { prefix: "topic-", frontmatterType: "Topic", indexSection: "Topics", icon: "lightbulb" },
  person: { prefix: "person-", frontmatterType: "Person", indexSection: "People", icon: "user" },
};

/** Index section for objects hidden from active work (Portent: archived stays searchable, not visible). */
export const ARCHIVED_SECTION = "Archived";

/** Phosphor icon names for the two special notes. */
export const DIARY_ICON = "notebook";
export const INDEX_ICON = "brain";

export const DIARY_SECTIONS: Record<DiaryKind, string> = {
  til: "TIL",
  mistake: "Mistakes",
  bug: "Bugs",
  decision: "Decisions",
  progress: "Progress",
  note: "Notes",
};

export interface BrainPaths {
  /** Absolute path of the brain vault root. */
  root: string;
  /** Absolute path of BRAIN.md, the index note. */
  indexFile: string;
  /** Absolute path of the diary (capture inbox) directory. */
  diaryDir: string;
}

export interface ObjectRef {
  slug: string;
  type: PortentType;
  title: string;
  /** Absolute file path. */
  file: string;
}

export interface SearchHit {
  /** Path relative to the brain root. */
  file: string;
  line: number;
  text: string;
}
