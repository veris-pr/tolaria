import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import secondBrainExtension from "../src/entry.ts";
import { executeBrainAction } from "../src/tools.ts";
import { buildStatus, portentSpecPath } from "../src/commands.ts";
import { buildBrainContext } from "../src/prompt.ts";
import { appendDiary } from "../src/diary.ts";
import { writeObject } from "../src/notes.ts";

let tmp: string;
const NOW = new Date(2026, 6, 14, 9, 5);

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-brain-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

interface FakePi {
  tools: any[];
  commands: Map<string, any>;
  handlers: Map<string, any[]>;
  messages: any[];
  api: any;
}

function fakePi(): FakePi {
  const state: FakePi = { tools: [], commands: new Map(), handlers: new Map(), messages: [], api: null };
  state.api = {
    registerTool: (t: any) => state.tools.push(t),
    registerCommand: (name: string, cmd: any) => state.commands.set(name, cmd),
    sendMessage: (msg: any, opts?: any) => state.messages.push({ msg, opts }),
    on: (event: string, handler: any) => {
      const list = state.handlers.get(event) ?? [];
      list.push(handler);
      state.handlers.set(event, list);
    },
  };
  return state;
}

async function fire(pi: FakePi, event: string, payload: any, ctx?: any): Promise<any> {
  let result: any;
  for (const handler of pi.handlers.get(event) ?? []) {
    result = (await handler(payload, ctx)) ?? result;
  }
  return result;
}

describe("extension wiring", () => {
  it("registers the tool, commands, and lifecycle handlers", () => {
    const pi = fakePi();
    secondBrainExtension(pi.api);

    expect(pi.tools.map((t) => t.name)).toEqual(["second_brain"]);
    expect([...pi.commands.keys()].sort()).toEqual(["brain", "brain-garden", "brain-init", "oops", "til"]);
    expect(pi.handlers.has("session_start")).toBe(true);
    expect(pi.handlers.has("before_agent_start")).toBe(true);
  });

  it("injects bootstrap guidance when no brain exists, full context once it does", async () => {
    const pi = fakePi();
    secondBrainExtension(pi.api);
    await fire(pi, "session_start", {}, { cwd: tmp });

    const before = await fire(pi, "before_agent_start", { systemPrompt: "BASE" });
    expect(before.systemPrompt).toContain("BASE");
    expect(before.systemPrompt).toContain("No second brain exists");

    appendDiary(path.join(tmp, ".pi/brain"), "til", "first entry", NOW);
    const after = await fire(pi, "before_agent_start", { systemPrompt: "BASE" });
    expect(after.systemPrompt).toContain("# Brain Index");
    expect(after.systemPrompt).toContain("Portent");
    expect(after.systemPrompt).toContain("first entry");
  });

  it("stays inert when PI_BRAIN_DISABLE=1", () => {
    process.env.PI_BRAIN_DISABLE = "1";
    try {
      const pi = fakePi();
      secondBrainExtension(pi.api);
      expect(pi.tools).toHaveLength(0);
      expect(pi.commands.size).toBe(0);
    } finally {
      delete process.env.PI_BRAIN_DISABLE;
    }
  });
});

describe("second_brain tool actions", () => {
  it("scaffolds lazily on first capture and supports the full loop", () => {
    const added = executeBrainAction(tmp, { action: "diary_add", kind: "til", content: "lazy scaffold works" }, NOW);
    expect(added.content[0]!.text).toContain("Captured to diary (til)");
    expect(fs.existsSync(path.join(tmp, "BRAIN.md"))).toBe(true);

    executeBrainAction(
      tmp,
      {
        action: "object_write",
        type: "event",
        title: "Adopt CRDT",
        content: "Because merges.",
        kind: "decision",
        hook: "why CRDT",
        belongs_to: "project-sync-rewrite",
      },
      NOW,
    );

    expect(executeBrainAction(tmp, { action: "list" }, NOW).content[0]!.text).toContain("event-adopt-crdt (event)");
    expect(executeBrainAction(tmp, { action: "read", name: "adopt crdt" }, NOW).content[0]!.text).toContain("Because merges.");
    expect(executeBrainAction(tmp, { action: "search", query: "scaffold" }, NOW).content[0]!.text).toContain("diary/");
    expect(executeBrainAction(tmp, { action: "index" }, NOW).content[0]!.text).toContain("[[event-adopt-crdt]] — why CRDT");

    const archived = executeBrainAction(tmp, { action: "archive", name: "event-adopt-crdt" }, NOW);
    expect(archived.content[0]!.text).toContain("Archived [[event-adopt-crdt]]");
    expect(executeBrainAction(tmp, { action: "list" }, NOW).content[0]!.text).toContain("[archived]");
  });

  it("marks relationship-less writes as captured in the tool reply", () => {
    const result = executeBrainAction(tmp, { action: "object_write", type: "note", title: "Loose", content: "x" }, NOW);
    expect(result.content[0]!.text).toContain("captured — add belongs_to/related to organize");
  });

  it("rejects missing or invalid params with a clear error", () => {
    expect(() => executeBrainAction(tmp, { action: "diary_add" }, NOW)).toThrow(/"kind" is required/);
    expect(() => executeBrainAction(tmp, { action: "diary_add", kind: "banana", content: "x" }, NOW)).toThrow(/must be one of/);
    expect(() => executeBrainAction(tmp, { action: "object_write", type: "note" }, NOW)).toThrow(/"title" is required/);
  });
});

describe("status + garden command", () => {
  it("reports uninitialized and initialized states with lifecycle counts", () => {
    expect(buildStatus(tmp)).toContain("No second brain yet");
    writeObject({ root: tmp, type: "event", title: "Ghost cursor", content: "jumps", kind: "bug", belongsTo: "project-editor", now: NOW });
    writeObject({ root: tmp, type: "note", title: "Loose", content: "x", now: NOW });
    appendDiary(tmp, "progress", "fixed it", NOW);

    const status = buildStatus(tmp);
    expect(status).toContain("1 Event");
    expect(status).toContain("1 Note");
    expect(status).toContain("1 captured");
    expect(status).toContain("2026-07-14");
  });

  it("arms the gardening protocol as a hidden turn-triggering message with the spec path", async () => {
    const pi = fakePi();
    secondBrainExtension(pi.api);
    await fire(pi, "session_start", {}, { cwd: tmp });

    appendDiary(path.join(tmp, ".pi/brain"), "til", "seed", NOW);
    await pi.commands.get("brain-garden").handler("", { ui: { notify: () => {} } });

    const hidden = pi.messages.find((m) => m.opts?.triggerTurn);
    expect(hidden.msg.content).toContain("gardening pass");
    expect(hidden.msg.content).toContain("PORTENT.md");
    expect(hidden.msg.display).toBe(false);
  });

  it("refuses to garden an uninitialized brain", async () => {
    const pi = fakePi();
    secondBrainExtension(pi.api);
    await fire(pi, "session_start", {}, { cwd: tmp });

    const warnings: string[] = [];
    await pi.commands.get("brain-garden").handler("", { ui: { notify: (m: string) => warnings.push(m) } });
    expect(warnings[0]).toContain("No second brain");
    expect(pi.messages.some((m) => m.opts?.triggerTurn)).toBe(false);
  });

  it("finds the bundled Portent spec", () => {
    expect(portentSpecPath()).toMatch(/PORTENT\.md$/);
  });
});

describe("context budget", () => {
  it("truncates oversized context", () => {
    const root = path.join(tmp, ".pi/brain");
    for (let i = 0; i < 400; i++) appendDiary(root, "note", `entry ${i} ${"x".repeat(60)}`, NOW);
    const context = buildBrainContext(root);
    expect(context.length).toBeLessThan(13_000);
    expect(context).toContain("[brain context truncated]");
  });
});
