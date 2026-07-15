import * as path from "node:path";
import { TYPE_SPECS, type BrainPaths, type PortentType } from "./types.ts";

export const DEFAULT_BRAIN_DIR = ".pi/brain";

/**
 * Resolve the brain root for a project. `PI_BRAIN_DIR` overrides the default
 * `.pi/brain` location; relative overrides are resolved against the project cwd.
 */
export function resolveBrainRoot(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.PI_BRAIN_DIR?.trim();
  const dir = override || DEFAULT_BRAIN_DIR;
  return path.resolve(cwd, dir);
}

export function brainPaths(root: string): BrainPaths {
  return {
    root,
    indexFile: path.join(root, "BRAIN.md"),
    diaryDir: path.join(root, "diary"),
  };
}

/** Turn a free-form title into a stable kebab-case slug (without type prefix). */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

/** Full object slug (= file name without extension), e.g. `note-vite-hmr-gotcha`. */
export function objectSlug(type: PortentType, title: string): string {
  return TYPE_SPECS[type].prefix + slugify(title);
}

export function objectFile(root: string, type: PortentType, title: string): string {
  return path.join(root, `${objectSlug(type, title)}.md`);
}

/** ISO date (YYYY-MM-DD) in local time. */
export function isoDate(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** HH:MM in local time. */
export function clockTime(now: Date): string {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

export function diaryFile(paths: BrainPaths, date: string): string {
  return path.join(paths.diaryDir, `${date}.md`);
}
