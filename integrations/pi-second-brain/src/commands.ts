import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { appendDiary, recentDiaries } from "./diary.ts";
import { listObjects } from "./notes.ts";
import { brainPaths } from "./paths.ts";
import { buildGardenProtocol } from "./prompt.ts";
import { brainExists, ensureBrain } from "./vault.ts";
import type { UiNotifier } from "./tolaria.ts";
import { PORTENT_TYPES, TYPE_SPECS } from "./types.ts";

export function buildStatus(root: string): string {
  const paths = brainPaths(root);
  if (!brainExists(paths)) {
    return `**No second brain yet** at \`${root}\` — run \`/brain-init\`, or just let the agent capture its first diary entry.`;
  }

  const objects = listObjects(root);
  const counts = PORTENT_TYPES.map((t) => ({ t, n: objects.filter((o) => o.type === t && !o.archived).length }))
    .filter((x) => x.n > 0)
    .map((x) => `${x.n} ${TYPE_SPECS[x.t].frontmatterType}`);
  const captured = objects.filter((o) => !o.organized && !o.archived).length;
  const archived = objects.filter((o) => o.archived).length;
  if (captured > 0) counts.push(`${captured} captured`);
  if (archived > 0) counts.push(`${archived} archived`);

  const lines = [`**Second brain** · \`${root}\``];
  lines.push(counts.length > 0 ? counts.join(" · ") : "No objects yet — only the index.");
  const latest = recentDiaries(root, 1)[0];
  if (latest) lines.push("", `Latest diary — ${latest.date}:`, "", latest.content.trim());
  return lines.join("\n");
}

/** Absolute path of the bundled Portent spec, if present next to the package root. */
export function portentSpecPath(): string | undefined {
  try {
    const spec = fileURLToPath(new URL("../PORTENT.md", import.meta.url));
    return fs.existsSync(spec) ? spec : undefined;
  } catch {
    return undefined;
  }
}

export function registerBrainCommands(pi: ExtensionAPI, getRoot: () => string, notifier?: UiNotifier): void {
  const feedback = (customType: string, content: string): void => {
    pi.sendMessage({ customType, content, display: true });
  };

  const quickDiary = (kind: "til" | "mistake", usage: string) =>
    async (args: string, ctx: ExtensionCommandContext) => {
      const entry = args?.trim();
      if (!entry) {
        ctx.ui.notify(usage, "warning");
        return;
      }
      const file = appendDiary(getRoot(), kind, entry, new Date());
      notifier?.changed(file);
      feedback(`brain-${kind}`, `**Captured ${kind === "til" ? "TIL" : "mistake"}** — ${entry}`);
    };

  pi.registerCommand("brain", {
    description: "Second brain status: object counts by Portent type and the latest diary",
    handler: async () => {
      feedback("brain-status", buildStatus(getRoot()));
    },
  });

  pi.registerCommand("brain-init", {
    description: "Scaffold this project's second brain (.pi/brain)",
    handler: async () => {
      const paths = brainPaths(getRoot());
      const existed = brainExists(paths);
      ensureBrain(paths);
      if (!existed) notifier?.changed(paths.indexFile);
      feedback(
        "brain-init",
        existed ? `**Second brain already exists** at \`${paths.root}\`.` : `**Second brain created** at \`${paths.root}\` — BRAIN.md index and diary/ inbox are ready.`,
      );
    },
  });

  pi.registerCommand("til", {
    description: "Capture a TIL to today's diary inbox",
    handler: quickDiary("til", "Usage: /til <what you learned>"),
  });

  pi.registerCommand("oops", {
    description: "Capture a mistake to today's diary inbox",
    handler: quickDiary("mistake", "Usage: /oops <what went wrong and why>"),
  });

  pi.registerCommand("brain-garden", {
    description: "Gardening pass: organize captured objects, distill the diary, merge duplicates, archive stale, refresh the index",
    handler: async (_args, ctx) => {
      if (!brainExists(brainPaths(getRoot()))) {
        ctx.ui.notify("No second brain to garden yet — run /brain-init first.", "warning");
        return;
      }
      pi.sendMessage(
        { customType: "brain-garden", content: buildGardenProtocol(portentSpecPath()), display: false },
        { triggerTurn: true },
      );
      feedback("brain-garden", "**Gardening** — organizing captured objects, distilling the diary into durable objects, merging duplicates, archiving stale entries, and refreshing the index. I'll report what changed.");
    },
  });
}
