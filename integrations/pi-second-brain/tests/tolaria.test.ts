import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { detectTolaria } from "../src/tolaria.ts";
import { resolveRoot } from "../src/entry.ts";
import secondBrainExtension from "../src/entry.ts";
import { executeBrainAction, registerBrainTool } from "../src/tools.ts";
import { parseNote } from "../src/frontmatter.ts";
import { writeObject } from "../src/notes.ts";
import type { UiNotifier } from "../src/tolaria.ts";

let tmp: string;
const NOW = new Date(2026, 6, 14, 9, 5);

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-brain-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.PI_CODING_AGENT_DIR;
});

function writeTolariaAgentDir(vaultPath: string, uiPort = "9711"): string {
  const agentDir = path.join(tmp, "agent");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        tolaria: { command: "node", env: { VAULT_PATH: vaultPath, WS_UI_PORT: uiPort } },
      },
    }),
  );
  return agentDir;
}

describe("Tolaria detection", () => {
  it("detects the vault path and UI port from the transient agent dir's mcp.json", () => {
    const agentDir = writeTolariaAgentDir("/vaults/laputa", "9800");
    const ctx = detectTolaria({ PI_CODING_AGENT_DIR: agentDir });
    expect(ctx).toEqual({ vaultPath: "/vaults/laputa", uiPort: 9800 });
  });

  it("defaults the UI port and returns null without the tolaria marker", () => {
    const agentDir = writeTolariaAgentDir("/vaults/laputa", "");
    expect(detectTolaria({ PI_CODING_AGENT_DIR: agentDir })?.uiPort).toBe(9711);

    expect(detectTolaria({})).toBeNull();
    fs.writeFileSync(path.join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { other: {} } }));
    expect(detectTolaria({ PI_CODING_AGENT_DIR: agentDir })).toBeNull();
    fs.rmSync(path.join(agentDir, "mcp.json"));
    expect(detectTolaria({ PI_CODING_AGENT_DIR: agentDir })).toBeNull();
  });

  it("places the brain in a visible vault folder under Tolaria, dot-dir otherwise", () => {
    const tolaria = { vaultPath: "/vaults/laputa", uiPort: 9711 };
    expect(resolveRoot("/vaults/laputa", tolaria, {})).toBe("/vaults/laputa/brain");
    expect(resolveRoot("/proj", null, {})).toBe("/proj/.pi/brain");
    expect(resolveRoot("/vaults/laputa", tolaria, { PI_BRAIN_DIR: "elsewhere" })).toBe("/vaults/laputa/elsewhere");
  });

  it("routes the extension's brain into the vault when launched by Tolaria", async () => {
    const vault = path.join(tmp, "vault");
    fs.mkdirSync(vault, { recursive: true });
    process.env.PI_CODING_AGENT_DIR = writeTolariaAgentDir(vault);

    const handlers = new Map<string, any>();
    const tools: any[] = [];
    secondBrainExtension({
      registerTool: (t: any) => tools.push(t),
      registerCommand: () => {},
      sendMessage: () => {},
      on: (event: string, handler: any) => handlers.set(event, handler),
    } as any);
    await handlers.get("session_start")({}, { cwd: vault });
    await tools[0]!.execute("id", { action: "diary_add", kind: "til", content: "in the vault" });

    expect(fs.existsSync(path.join(vault, "brain", "BRAIN.md"))).toBe(true);
  });
});

describe("UI notifications", () => {
  function toolWithNotifier(notifier: UiNotifier) {
    const tools: any[] = [];
    registerBrainTool({ registerTool: (t: any) => tools.push(t) } as any, () => tmp, notifier);
    return tools[0]!;
  }

  it("emits vault_changed for writes and open_tab for show", async () => {
    const changed: string[] = [];
    const opened: string[] = [];
    const tool = toolWithNotifier({ changed: (f) => changed.push(f), open: (f) => opened.push(f) });

    await tool.execute("id", { action: "diary_add", kind: "til", content: "hello" });
    await tool.execute("id", { action: "object_write", type: "note", title: "Doc", content: "body" });
    await tool.execute("id", { action: "archive", name: "note-doc" });
    const shown = await tool.execute("id", { action: "show", name: "note-doc" });

    expect(changed).toHaveLength(3);
    expect(changed[1]).toMatch(/note-doc\.md$/);
    expect(opened).toEqual([changed[1]]);
    expect(shown.content[0].text).toContain("Requested Tolaria to open");
  });

  it("degrades show gracefully outside Tolaria", async () => {
    const tools: any[] = [];
    registerBrainTool({ registerTool: (t: any) => tools.push(t) } as any, () => tmp);
    writeObject({ root: tmp, type: "note", title: "Doc", content: "body", now: NOW });

    const result = await tools[0]!.execute("id", { action: "show", name: "note-doc" });
    expect(result.content[0].text).toContain("Not running inside Tolaria");
  });
});

describe("Tolaria-native frontmatter", () => {
  it("stamps Phosphor icons on objects, the diary, and the index", () => {
    const result = writeObject({ root: tmp, type: "person", title: "Alice", content: "reviewer", now: NOW });
    expect(parseNote(fs.readFileSync(result.file, "utf8")).fields._icon).toBe("user");

    executeBrainAction(tmp, { action: "diary_add", kind: "til", content: "x" }, NOW);
    const diary = fs.readFileSync(path.join(tmp, "diary", "2026-07-14.md"), "utf8");
    expect(parseNote(diary).fields._icon).toBe("notebook");
    expect(parseNote(fs.readFileSync(path.join(tmp, "BRAIN.md"), "utf8")).fields._icon).toBe("brain");
  });
});
