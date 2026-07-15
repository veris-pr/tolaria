import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { brainPaths, objectSlug, resolveBrainRoot, slugify } from "../src/paths.ts";
import { buildFrontmatter, parseNote } from "../src/frontmatter.ts";
import { archiveIndexLine, brainExists, ensureBrain, readIndex, updateIndex } from "../src/vault.ts";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-brain-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("paths", () => {
  it("defaults the brain root to .pi/brain under the cwd", () => {
    expect(resolveBrainRoot("/proj", {})).toBe("/proj/.pi/brain");
  });

  it("honors PI_BRAIN_DIR relative and absolute overrides", () => {
    expect(resolveBrainRoot("/proj", { PI_BRAIN_DIR: "brain" })).toBe("/proj/brain");
    expect(resolveBrainRoot("/proj", { PI_BRAIN_DIR: "/elsewhere" })).toBe("/elsewhere");
  });

  it("slugifies titles into stable kebab-case", () => {
    expect(slugify("Vite HMR loses editor state!")).toBe("vite-hmr-loses-editor-state");
    expect(slugify("  Émigré Café #2 ")).toBe("emigre-cafe-2");
    expect(slugify("!!!")).toBe("untitled");
  });

  it("prefixes object slugs by Portent type", () => {
    expect(objectSlug("responsibility", "Release Quality")).toBe("responsibility-release-quality");
    expect(objectSlug("note", "Sync Engine")).toBe("note-sync-engine");
  });
});

describe("frontmatter", () => {
  it("round-trips scalars and wikilink lists", () => {
    const fm = buildFrontmatter({
      type: "Event",
      aliases: ["[[Broken Sync]]"],
      organized: "true",
      belongs_to: "[[project-sync-rewrite]]",
    });
    const parsed = parseNote(`${fm}\n\n# Broken Sync\n\nBody here.\n`);
    expect(parsed.fields.type).toBe("Event");
    expect(parsed.fields.aliases).toEqual(["[[Broken Sync]]"]);
    expect(parsed.fields.organized).toBe("true");
    expect(parsed.fields.belongs_to).toBe("[[project-sync-rewrite]]");
    expect(parsed.body).toContain("# Broken Sync");
  });

  it("tolerates notes without frontmatter", () => {
    expect(parseNote("just text").fields).toEqual({});
  });
});

describe("vault index", () => {
  it("scaffolds BRAIN.md with a section per Portent type plus Archived", () => {
    const paths = brainPaths(tmp);
    expect(brainExists(paths)).toBe(false);
    ensureBrain(paths);
    ensureBrain(paths);
    const index = readIndex(paths);
    expect(index).toContain("# Brain Index");
    for (const section of [
      "Projects",
      "Operations",
      "Responsibilities",
      "Tasks",
      "Events",
      "Notes",
      "Topics",
      "People",
      "Archived",
    ]) {
      expect(index).toContain(`## ${section}`);
    }
  });

  it("inserts index lines under the right section and replaces on re-write", () => {
    const paths = brainPaths(tmp);
    updateIndex(paths, "event", "event-sync-outage", "sync dropped offline edits");
    updateIndex(paths, "note", "note-wkwebview-keys", "WKWebView eats keystrokes");
    updateIndex(paths, "event", "event-sync-outage", "root-caused: last-write-wins");

    const lines = readIndex(paths).split("\n");
    const eventLine = lines.findIndex((l) => l.includes("[[event-sync-outage]]"));
    const noteLine = lines.findIndex((l) => l.includes("[[note-wkwebview-keys]]"));

    expect(eventLine).toBeGreaterThan(lines.indexOf("## Events"));
    expect(noteLine).toBeGreaterThan(lines.indexOf("## Notes"));
    expect(lines.filter((l) => l.includes("[[event-sync-outage]]"))).toHaveLength(1);
    expect(lines[eventLine]).toContain("root-caused");
  });

  it("moves archived lines to the Archived section keeping the hook", () => {
    const paths = brainPaths(tmp);
    updateIndex(paths, "topic", "topic-crdts", "merge strategies research");
    archiveIndexLine(paths, "topic-crdts");

    const lines = readIndex(paths).split("\n");
    const line = lines.findIndex((l) => l.includes("[[topic-crdts]]"));
    expect(line).toBeGreaterThan(lines.indexOf("## Archived"));
    expect(lines[line]).toContain("merge strategies research");
    expect(lines.filter((l) => l.includes("[[topic-crdts]]"))).toHaveLength(1);
  });
});
