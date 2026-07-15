import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBrainCommands } from "./commands.ts";
import { buildBrainContext } from "./prompt.ts";
import { resolveBrainRoot } from "./paths.ts";
import { createUiNotifier, detectTolaria, type TolariaContext } from "./tolaria.ts";
import { registerBrainTool } from "./tools.ts";

/**
 * Where the brain lives. Default is `.pi/brain` under the project — but when
 * pi runs inside the Tolaria app (detected via the transient agent dir's
 * mcp.json), the brain moves to a visible `brain/` folder of the open vault:
 * Tolaria skips dot-directories, and a visible folder makes the brain
 * browsable in the app with types, icons, and wikilinks. PI_BRAIN_DIR always
 * wins when set.
 */
export function resolveRoot(cwd: string, tolaria: TolariaContext | null, env: NodeJS.ProcessEnv = process.env): string {
  if (!env.PI_BRAIN_DIR?.trim() && tolaria) return path.join(tolaria.vaultPath, "brain");
  return resolveBrainRoot(cwd, env);
}

/**
 * Second Brain extension: gives the agent a persistent, per-project Portent
 * knowledge base (diary inbox + typed objects + docs, Tolaria-compatible) and
 * injects its index and recent diary into every turn so recall is guaranteed.
 *
 * Disable per-run with PI_BRAIN_DISABLE=1; relocate with PI_BRAIN_DIR.
 */
export default function secondBrainExtension(pi: ExtensionAPI): void {
  if (process.env.PI_BRAIN_DISABLE === "1") return;

  const tolaria = detectTolaria();
  const notifier = tolaria ? createUiNotifier(tolaria) : undefined;

  let root = resolveRoot(process.cwd(), tolaria);
  const getRoot = (): string => root;

  registerBrainTool(pi, getRoot, notifier);
  registerBrainCommands(pi, getRoot, notifier);

  pi.on("session_start", async (_event, ctx) => {
    if (ctx?.cwd) root = resolveRoot(ctx.cwd, tolaria);
  });

  pi.on("before_agent_start", async (event) => {
    const context = buildBrainContext(root);
    return {
      systemPrompt: `${event.systemPrompt ?? ""}\n\n${context}`,
    };
  });
}
