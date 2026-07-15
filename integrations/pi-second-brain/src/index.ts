export {
  PORTENT_TYPES,
  DIARY_KINDS,
  TYPE_SPECS,
  DIARY_SECTIONS,
  ARCHIVED_SECTION,
} from "./types.ts";
export type { PortentType, DiaryKind, BrainPaths, ObjectRef, SearchHit, TypeSpec } from "./types.ts";

export {
  DEFAULT_BRAIN_DIR,
  resolveBrainRoot,
  brainPaths,
  slugify,
  objectSlug,
  objectFile,
  isoDate,
  clockTime,
  diaryFile,
} from "./paths.ts";

export { buildFrontmatter, parseNote, wikilink } from "./frontmatter.ts";
export type { Frontmatter, ParsedNote } from "./frontmatter.ts";

export { brainExists, ensureBrain, readIndex, updateIndex, archiveIndexLine } from "./vault.ts";
export { writeObject, listObjects, readObjectByName, archiveObject } from "./notes.ts";
export type { WriteObjectInput, WriteObjectResult, ObjectStatus } from "./notes.ts";
export { appendDiary, recentDiaries } from "./diary.ts";
export { searchBrain, formatHits } from "./search.ts";

export { BRAIN_POLICY, BRAIN_BOOTSTRAP, buildGardenProtocol, buildBrainContext } from "./prompt.ts";
export { executeBrainAction, registerBrainTool } from "./tools.ts";
export type { BrainToolParams, BrainToolResult } from "./tools.ts";
export { detectTolaria, createUiNotifier } from "./tolaria.ts";
export type { TolariaContext, UiNotifier } from "./tolaria.ts";
export { registerBrainCommands, buildStatus, portentSpecPath } from "./commands.ts";

export { default as secondBrainExtension } from "./entry.ts";
