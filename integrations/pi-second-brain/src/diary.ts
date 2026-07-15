import * as fs from "node:fs";
import * as path from "node:path";
import { buildFrontmatter } from "./frontmatter.ts";
import { brainPaths, clockTime, diaryFile, isoDate } from "./paths.ts";
import { ensureBrain } from "./vault.ts";
import { DIARY_ICON, DIARY_SECTIONS, type DiaryKind } from "./types.ts";

/**
 * Daily diaries are the brain's capture inbox (Portent: capture optimistically).
 * Each file is an Event in the captured state; a gardening pass later distills
 * durable entries into organized objects and flips the diary to organized.
 */
function diarySkeleton(date: string): string {
  const head = buildFrontmatter({
    type: "Event",
    kind: "diary",
    date,
    _icon: DIARY_ICON,
    organized: "false",
    archived: "false",
  });
  return `${head}\n\n# ${date}\n`;
}

/**
 * Append one timestamped bullet to today's diary under the section for `kind`,
 * creating the diary file and section on demand.
 */
export function appendDiary(root: string, kind: DiaryKind, text: string, now: Date): string {
  const paths = brainPaths(root);
  ensureBrain(paths);

  const date = isoDate(now);
  const file = diaryFile(paths, date);
  const section = `## ${DIARY_SECTIONS[kind]}`;
  const entry = `- ${clockTime(now)} ${text.trim()}`;

  const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : diarySkeleton(date);
  const lines = content.replace(/\s+$/, "").split("\n");

  const header = lines.findIndex((l) => l.trim() === section);
  if (header < 0) {
    lines.push("", section, entry);
  } else {
    let insertAt = header + 1;
    while (insertAt < lines.length && !lines[insertAt]!.startsWith("## ")) insertAt++;
    while (insertAt > header + 1 && lines[insertAt - 1]!.trim() === "") insertAt--;
    lines.splice(insertAt, 0, entry);
  }

  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
  return file;
}

/** Contents of the `count` most recent diary files, newest last (chronological). */
export function recentDiaries(root: string, count: number): Array<{ date: string; content: string }> {
  const paths = brainPaths(root);
  if (!fs.existsSync(paths.diaryDir)) return [];
  return fs
    .readdirSync(paths.diaryDir)
    .filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n))
    .sort()
    .slice(-count)
    .map((n) => ({
      date: n.slice(0, -3),
      content: fs.readFileSync(path.join(paths.diaryDir, n), "utf8"),
    }));
}
