import * as fs from "node:fs";
import { buildFrontmatter, wikilink } from "./frontmatter.ts";
import {
  ARCHIVED_SECTION,
  INDEX_ICON,
  PORTENT_TYPES,
  TYPE_SPECS,
  type BrainPaths,
  type PortentType,
} from "./types.ts";

const INDEX_SECTIONS = [
  ...PORTENT_TYPES.map((t) => TYPE_SPECS[t].indexSection),
  ARCHIVED_SECTION,
] as const;

function indexSkeleton(): string {
  const head = buildFrontmatter({ type: "Note", kind: "index", aliases: [wikilink("Brain Index")], _icon: INDEX_ICON });
  const sections = INDEX_SECTIONS.map((s) => `## ${s}\n`).join("\n");
  return [
    head,
    "",
    "# Brain Index",
    "",
    "Map of this project's second brain (Portent model) — one line per object, hooks kept short.",
    "The capture inbox lives in `diary/` (one file per day: TIL, mistakes, bugs, decisions, progress).",
    "",
    sections,
  ].join("\n");
}

export function brainExists(paths: BrainPaths): boolean {
  return fs.existsSync(paths.indexFile);
}

/** Create the brain scaffold (idempotent): root dir, diary dir, BRAIN.md. */
export function ensureBrain(paths: BrainPaths): void {
  fs.mkdirSync(paths.diaryDir, { recursive: true });
  if (!fs.existsSync(paths.indexFile)) {
    fs.writeFileSync(paths.indexFile, indexSkeleton(), "utf8");
  }
}

export function readIndex(paths: BrainPaths): string {
  return fs.existsSync(paths.indexFile) ? fs.readFileSync(paths.indexFile, "utf8") : "";
}

function insertIntoSection(lines: string[], section: string, entry: string): void {
  const header = lines.findIndex((l) => l.trim() === `## ${section}`);
  if (header < 0) {
    lines.push("", `## ${section}`, entry);
    return;
  }
  let insertAt = header + 1;
  while (insertAt < lines.length && !lines[insertAt]!.startsWith("## ")) insertAt++;
  while (insertAt > header + 1 && lines[insertAt - 1]!.trim() === "") insertAt--;
  lines.splice(insertAt, 0, entry);
}

function writeIndexLine(paths: BrainPaths, section: string, slug: string, line: string): void {
  ensureBrain(paths);
  const lines = readIndex(paths).split("\n");
  const existing = lines.findIndex((l) => l.includes(`[[${slug}]]`));
  if (existing >= 0) lines.splice(existing, 1);
  insertIntoSection(lines, section, line);
  fs.writeFileSync(paths.indexFile, lines.join("\n"), "utf8");
}

/**
 * Insert or refresh an object's line in its BRAIN.md type section. Idempotent:
 * an existing line for the same slug is removed first, wherever it was.
 */
export function updateIndex(paths: BrainPaths, type: PortentType, slug: string, hook: string): void {
  writeIndexLine(paths, TYPE_SPECS[type].indexSection, slug, `- ${wikilink(slug)} — ${hook}`);
}

/** Move an object's index line to the Archived section (hidden from active views, still searchable). */
export function archiveIndexLine(paths: BrainPaths, slug: string): void {
  const existing = readIndex(paths)
    .split("\n")
    .find((l) => l.includes(`[[${slug}]]`));
  const line = existing?.trim() ?? `- ${wikilink(slug)}`;
  writeIndexLine(paths, ARCHIVED_SECTION, slug, line);
}
