import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Tolaria app integration. When Tolaria runs pi from its AI panel it sets
 * PI_CODING_AGENT_DIR to a transient agent dir containing an mcp.json with a
 * "tolaria" server entry whose env carries the active vault path and the UI
 * WebSocket bridge port. That file is the definitive "running inside Tolaria"
 * signal — and it tells us where the vault is, so the brain can live in a
 * visible folder of the open vault instead of an invisible dot-directory
 * (Tolaria skips paths with dot components).
 */
export interface TolariaContext {
  vaultPath: string;
  uiPort: number;
}

const DEFAULT_UI_PORT = 9711;

export function detectTolaria(env: NodeJS.ProcessEnv = process.env): TolariaContext | null {
  const agentDir = env.PI_CODING_AGENT_DIR?.trim();
  if (!agentDir) return null;

  try {
    const raw = fs.readFileSync(path.join(agentDir, "mcp.json"), "utf8");
    const config = JSON.parse(raw) as { mcpServers?: Record<string, { env?: Record<string, string> }> };
    const tolariaEnv = config.mcpServers?.tolaria?.env;
    const vaultPath = tolariaEnv?.VAULT_PATH?.trim();
    if (!vaultPath) return null;
    const uiPort = Number.parseInt(tolariaEnv?.WS_UI_PORT ?? "", 10);
    return { vaultPath, uiPort: Number.isFinite(uiPort) ? uiPort : DEFAULT_UI_PORT };
  } catch {
    return null;
  }
}

/** Callbacks fired after brain writes so a host app can react (e.g. rescan, open a tab). */
export interface UiNotifier {
  /** A note was created or updated on disk. */
  changed(file: string): void;
  /** The user (or agent) wants the note visible — open it as a tab. */
  open(file: string): void;
}

function sendUiAction(uiPort: number, action: string, payload: Record<string, string>): void {
  const WebSocketCtor = (globalThis as { WebSocket?: new (url: string) => WebSocket }).WebSocket;
  if (!WebSocketCtor) return;

  try {
    const socket = new WebSocketCtor(`ws://localhost:${uiPort}`);
    const close = (): void => {
      try {
        socket.close();
      } catch {
        // already closed
      }
    };
    socket.onopen = () => {
      try {
        socket.send(JSON.stringify({ type: "ui_action", action, ...payload }));
      } finally {
        setTimeout(close, 100);
      }
    };
    socket.onerror = close;
    setTimeout(close, 2000);
  } catch {
    // Tolaria not running or bridge unavailable — writes still land on disk.
  }
}

/**
 * Fire-and-forget notifier over Tolaria's UI WebSocket bridge. The bridge
 * relays client messages to the app frontend, which handles vault_changed
 * (rescan so new notes appear live) and open_tab (open a note as a tab).
 */
export function createUiNotifier(ctx: TolariaContext): UiNotifier {
  return {
    changed: (file) => sendUiAction(ctx.uiPort, "vault_changed", { path: file }),
    open: (file) => sendUiAction(ctx.uiPort, "open_tab", { path: file }),
  };
}
