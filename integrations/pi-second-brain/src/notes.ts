import * as fs from "node:fs";
import * as path from "node:path";
import { buildFrontmatter, parseNote, wikilink, type Frontmatter } from "./frontmatter.ts";
import { brainPaths, isoDate, objectFile, objectSlug } from "./paths.ts";
import { archiveIndexLine, ensureBrain, updateIndex } from "./vault.ts";
import { PORTENT_TYPES, TYPE_SPECS, type ObjectRef, type PortentType } from "./types.ts";

export interface WriteObjectInput {
  root: string;
  type: PortentType;
  title: string;
  /** Markdown body (without frontmatter or the H1 title). */
  content: string;
  /** Optional subtype property, e.g. "til", "devdoc", "decision-record" (Portent: prefer properties before root types). */
  kind?: string;
  /** One-line hook for the BRAIN.md index. Falls back to the first body line. */
  hook?: string;
  /** Slug of the single primary parent (Portent belongs_to). */
  belongsTo?: string;
  /** Slugs of secondary associations (Portent related_to). */
  related?: string[];
  /** Lifecycle: defaults to true when any relationship is given, else captured. */
  organized?: boolean;
  now: Date;
}

export interface WriteObjectResult {
  file: string;
  slug: string;
  created: boolean;
  organized: boolean;
}

function firstLine(text: string): string {
  return text.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
}

/**
 * Create or update a Portent object and keep its BRAIN.md index line fresh.
 * Updates preserve the original `created` date and bump `updated`.
 */
export function writeObject(input: WriteObjectInput): WriteObjectResult {
  const paths = brainPaths(input.root);
  ensureBrain(paths);

  const slug = objectSlug(input.type, input.title);
  const file = objectFile(input.root, input.type, input.title);
  const today = isoDate(input.now);
  const existing = fs.existsSync(file) ? parseNote(fs.readFileSync(file, "utf8")) : null;

  const hasRelationships = Boolean(input.belongsTo) || Boolean(input.related?.length);
  const organized = input.organized ?? hasRelationships;

  const fields: Frontmatter = {
    type: TYPE_SPECS[input.type].frontmatterType,
    aliases: [wikilink(input.title)],
  };
  if (input.kind) fields.kind = input.kind;
  fields._icon = TYPE_SPECS[input.type].icon;
  fields.created = typeof existing?.fields.created === "string" ? existing.fields.created : today;
  fields.updated = today;
  fields.organized = String(organized);
  fields.archived = "false";
  if (input.belongsTo) fields.belongs_to = wikilink(input.belongsTo);
  if (input.related?.length) fields.related_to = input.related.map(wikilink);

  const body = `\n\n# ${input.title}\n\n${input.content.trim()}\n`;
  fs.writeFileSync(file, buildFrontmatter(fields) + body, "utf8");

  updateIndex(paths, input.type, slug, input.hook?.trim() || firstLine(input.content));
  return { file, slug, created: existing === null, organized };
}

function typeOfFile(name: string): PortentType | null {
  return PORTENT_TYPES.find((t) => name.startsWith(TYPE_SPECS[t].prefix)) ?? null;
}

export interface ObjectStatus extends ObjectRef {
  organized: boolean;
  archived: boolean;
}

export function listObjects(root: string, type?: PortentType): ObjectStatus[] {
  if (!fs.existsSync(root)) return [];
  const refs: ObjectStatus[] = [];
  for (const name of fs.readdirSync(root).sort()) {
    if (!name.endsWith(".md") || name === "BRAIN.md") continue;
    const objectType = typeOfFile(name);
    if (!objectType || (type && objectType !== type)) continue;
    const slug = name.slice(0, -3);
    const { fields } = parseNote(fs.readFileSync(path.join(root, name), "utf8"));
    refs.push({
      slug,
      type: objectType,
      title: slug.slice(TYPE_SPECS[objectType].prefix.length).replace(/-/g, " "),
      file: path.join(root, name),
      organized: fields.organized !== "false",
      archived: fields.archived === "true",
    });
  }
  return refs;
}

/** Read an object by slug (`note-foo`), file name, or fuzzy title match. */
export function readObjectByName(root: string, name: string): { ref: ObjectStatus; content: string } | null {
  const wanted = name.trim().replace(/\.md$/, "").toLowerCase();
  const objects = listObjects(root);
  const ref =
    objects.find((o) => o.slug.toLowerCase() === wanted) ??
    objects.find((o) => o.title.toLowerCase() === wanted) ??
    objects.find((o) => o.slug.toLowerCase().includes(wanted));
  if (!ref) return null;
  return { ref, content: fs.readFileSync(ref.file, "utf8") };
}

/**
 * Archive an object: set `archived: true` in its frontmatter and move its
 * index line to the Archived section. Portent: archive instead of deleting
 * when the object still has historical, audit, or reference value.
 */
export function archiveObject(root: string, name: string, now: Date): ObjectStatus | null {
  const found = readObjectByName(root, name);
  if (!found) return null;

  const { fields, body } = parseNote(found.content);
  fields.archived = "true";
  fields.updated = isoDate(now);
  fs.writeFileSync(found.ref.file, buildFrontmatter(fields) + "\n" + body.replace(/^\n*/, "\n"), "utf8");

  archiveIndexLine(brainPaths(root), found.ref.slug);
  return { ...found.ref, archived: true };
}
