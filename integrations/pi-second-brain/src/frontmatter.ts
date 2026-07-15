/**
 * Minimal YAML-subset frontmatter helpers, matching the Tolaria vault style:
 * scalar `key: value` lines and string-list `key:\n  - "value"` blocks.
 */

export type FrontmatterValue = string | string[];
export type Frontmatter = Record<string, FrontmatterValue>;

export function wikilink(slug: string): string {
  return `[[${slug}]]`;
}

function quoteIfNeeded(value: string): string {
  return /[[\]:#{}]|^\s|\s$/.test(value) ? JSON.stringify(value) : value;
}

export function buildFrontmatter(fields: Frontmatter): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${quoteIfNeeded(item)}`);
    } else {
      lines.push(`${key}: ${quoteIfNeeded(value)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function unquote(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

export interface ParsedNote {
  fields: Frontmatter;
  body: string;
}

/** Parse a note into frontmatter fields and body. Tolerates missing frontmatter. */
export function parseNote(content: string): ParsedNote {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(content);
  if (!match) return { fields: {}, body: content };

  const fields: Frontmatter = {};
  let currentList: string[] | null = null;

  for (const line of match[1]!.split("\n")) {
    const listItem = /^\s+-\s+(.*)$/.exec(line);
    if (listItem && currentList) {
      currentList.push(unquote(listItem[1]!));
      continue;
    }
    const scalar = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!scalar) continue;
    const key = scalar[1]!;
    const rest = scalar[2]!;
    if (rest === "") {
      currentList = [];
      fields[key] = currentList;
    } else {
      currentList = null;
      fields[key] = unquote(rest);
    }
  }

  return { fields, body: content.slice(match[0].length) };
}
