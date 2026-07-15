import * as fs from "node:fs";
import * as path from "node:path";
import type { SearchHit } from "./types.ts";

const MAX_HITS = 40;

function* markdownFiles(root: string): Generator<string> {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith(".md")) yield full;
    }
  }
}

/** Case-insensitive substring search across every markdown note in the brain. */
export function searchBrain(root: string, query: string): SearchHit[] {
  if (!fs.existsSync(root)) return [];
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const hits: SearchHit[] = [];
  for (const file of markdownFiles(root)) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]!.toLowerCase().includes(needle)) continue;
      hits.push({ file: path.relative(root, file), line: i + 1, text: lines[i]!.trim() });
      if (hits.length >= MAX_HITS) return hits;
    }
  }
  return hits;
}

export function formatHits(hits: SearchHit[]): string {
  if (hits.length === 0) return "No matches.";
  return hits.map((h) => `${h.file}:${h.line}  ${h.text}`).join("\n");
}
