import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { appendDiary, recentDiaries } from "../src/diary.ts";
import { archiveObject, listObjects, readObjectByName, writeObject } from "../src/notes.ts";
import { parseNote } from "../src/frontmatter.ts";
import { brainPaths } from "../src/paths.ts";
import { readIndex } from "../src/vault.ts";
import { formatHits, searchBrain } from "../src/search.ts";

let tmp: string;
const T1 = new Date(2026, 6, 14, 9, 5);
const T2 = new Date(2026, 6, 15, 16, 40);

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-brain-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("objects", () => {
  it("creates a Portent-shaped object with relationships and indexes it", () => {
    const result = writeObject({
      root: tmp,
      type: "event",
      title: "Sync drops offline edits",
      content: "Repro: edit offline, reconnect.\n\nRoot cause: last-write-wins.",
      kind: "bug",
      belongsTo: "project-sync-rewrite",
      related: ["person-alice-example"],
      now: T1,
    });

    expect(result.created).toBe(true);
    expect(result.organized).toBe(true);
    expect(result.slug).toBe("event-sync-drops-offline-edits");

    const parsed = parseNote(fs.readFileSync(result.file, "utf8"));
    expect(parsed.fields.type).toBe("Event");
    expect(parsed.fields.kind).toBe("bug");
    expect(parsed.fields.aliases).toEqual(["[[Sync drops offline edits]]"]);
    expect(parsed.fields.created).toBe("2026-07-14");
    expect(parsed.fields.organized).toBe("true");
    expect(parsed.fields.archived).toBe("false");
    expect(parsed.fields.belongs_to).toBe("[[project-sync-rewrite]]");
    expect(parsed.fields.related_to).toEqual(["[[person-alice-example]]"]);
    expect(parsed.body).toContain("# Sync drops offline edits");

    expect(readIndex(brainPaths(tmp))).toContain("[[event-sync-drops-offline-edits]] — Repro: edit offline, reconnect.");
  });

  it("leaves relationship-less objects captured unless organized is forced", () => {
    const captured = writeObject({ root: tmp, type: "note", title: "Loose thought", content: "hm", now: T1 });
    expect(captured.organized).toBe(false);

    const forced = writeObject({ root: tmp, type: "topic", title: "CRDTs", content: "lens", organized: true, now: T1 });
    expect(forced.organized).toBe(true);
  });

  it("updates in place, preserving created and bumping updated", () => {
    writeObject({ root: tmp, type: "note", title: "Tauri menus", content: "v1", now: T1 });
    const result = writeObject({
      root: tmp,
      type: "note",
      title: "Tauri menus",
      content: "v2",
      hook: "menus replace whole bar",
      now: T2,
    });

    expect(result.created).toBe(false);
    const parsed = parseNote(fs.readFileSync(result.file, "utf8"));
    expect(parsed.fields.created).toBe("2026-07-14");
    expect(parsed.fields.updated).toBe("2026-07-15");
    expect(parsed.body).toContain("v2");
    expect(readIndex(brainPaths(tmp))).toContain("menus replace whole bar");
  });

  it("lists by type with lifecycle flags and reads fuzzily", () => {
    writeObject({ root: tmp, type: "note", title: "Sync engine", content: "How sync works.", kind: "devdoc", belongsTo: "project-sync-rewrite", now: T1 });
    writeObject({ root: tmp, type: "person", title: "Alice Example", content: "reviewer", now: T1 });

    expect(listObjects(tmp, "note").map((o) => o.slug)).toEqual(["note-sync-engine"]);
    expect(listObjects(tmp)).toHaveLength(2);
    expect(listObjects(tmp, "person")[0]?.organized).toBe(false);
    expect(readObjectByName(tmp, "sync engine")?.ref.slug).toBe("note-sync-engine");
    expect(readObjectByName(tmp, "nope-missing")).toBeNull();
  });

  it("archives instead of deleting: flips frontmatter and moves the index line", () => {
    writeObject({ root: tmp, type: "topic", title: "CRDTs", content: "merge research", organized: true, now: T1 });
    const archived = archiveObject(tmp, "topic-crdts", T2);

    expect(archived?.archived).toBe(true);
    const parsed = parseNote(fs.readFileSync(archived!.file, "utf8"));
    expect(parsed.fields.archived).toBe("true");
    expect(parsed.fields.updated).toBe("2026-07-15");
    expect(parsed.body).toContain("merge research");

    const lines = readIndex(brainPaths(tmp)).split("\n");
    expect(lines.findIndex((l) => l.includes("[[topic-crdts]]"))).toBeGreaterThan(lines.indexOf("## Archived"));
    expect(archiveObject(tmp, "missing", T2)).toBeNull();
  });
});

describe("diary (capture inbox)", () => {
  it("creates today's file as a captured Event and appends under sections", () => {
    appendDiary(tmp, "til", "WKWebView blocks synthetic keystrokes", T1);
    appendDiary(tmp, "mistake", "Assumed osascript works in editor", T1);
    appendDiary(tmp, "til", "Use e.code for Option shortcuts", new Date(2026, 6, 14, 11, 30));

    const [diary] = recentDiaries(tmp, 5);
    expect(diary?.date).toBe("2026-07-14");
    const parsed = parseNote(diary!.content);
    expect(parsed.fields.type).toBe("Event");
    expect(parsed.fields.kind).toBe("diary");
    expect(parsed.fields.organized).toBe("false");

    const lines = diary!.content.split("\n");
    const til = lines.indexOf("## TIL");
    const mistakes = lines.indexOf("## Mistakes");
    expect(lines[til + 1]).toBe("- 09:05 WKWebView blocks synthetic keystrokes");
    expect(lines[til + 2]).toBe("- 11:30 Use e.code for Option shortcuts");
    expect(lines[mistakes + 1]).toContain("Assumed osascript");
  });

  it("returns recent diaries chronologically, capped", () => {
    appendDiary(tmp, "progress", "day one", T1);
    appendDiary(tmp, "progress", "day two", T2);
    const recents = recentDiaries(tmp, 1);
    expect(recents.map((d) => d.date)).toEqual(["2026-07-15"]);
  });
});

describe("search", () => {
  it("finds matches across objects and diary with file:line refs", () => {
    writeObject({ root: tmp, type: "event", title: "Ghost cursor", content: "Cursor jumps after paste.", kind: "bug", now: T1 });
    appendDiary(tmp, "bug", "ghost cursor reproduced on macOS 26", T1);

    const hits = searchBrain(tmp, "ghost cursor");
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(formatHits(hits)).toMatch(/diary\/2026-07-14\.md:\d+/);
    expect(searchBrain(tmp, "")).toEqual([]);
    expect(formatHits([])).toBe("No matches.");
  });
});
