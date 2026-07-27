import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export type PromptResource = "constitution" | "athena-persona";

// Resolve the package root by name instead of a relative path from this module's own
// location: pkgroll bundles this module into a single dist/index.js at the package root,
// while vitest runs it unbundled from src/runtime/prompts/, so no fixed `..` depth is
// correct in both places. Package-name resolution is depth-independent in both cases.
const _require = createRequire(import.meta.url);
const PACKAGE_ROOT = dirname(_require.resolve("koishi-plugin-yesimbot/package.json"));
const RESOURCE_ROOT = join(PACKAGE_ROOT, "resources");

export async function readPromptResource(name: PromptResource): Promise<string> {
  const path = join(RESOURCE_ROOT, `${name}.md`);
  const content = (await readFile(path, "utf8")).trim();
  if (content.length === 0) throw new Error(`Prompt resource ${name} is empty`);
  return content;
}
