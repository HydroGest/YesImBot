import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import matter from "gray-matter";

import type { LoadSkillsOptions, LoadSkillsResult, ResourceDiagnostic, Skill, SkillFrontmatter } from "./types";

const MAX_NAME_LENGTH = 64;

const MAX_DESCRIPTION_LENGTH = 1024;

type ParsedFrontmatter<T extends Record<string, unknown>> = { frontmatter: T; body: string };

/**
 * Discovery rules:
 * - if a directory contains SKILL.md, treat it as a skill root and do not recurse further
 * - otherwise, load direct .md children in the root
 * - recurse into subdirectories to find SKILL.md
 */
export async function loadSkillsFromDir(dir: string): Promise<LoadSkillsResult> {
  const rootDir = await realpath(dir).catch(() => resolve(dir));
  return loadSkillsFromDirInternal(dir, true, rootDir, new Set());
}

/**
 * Format skills for inclusion in a system prompt using `skill://` locations.
 * Skills with disableModelInvocation=true are excluded from the prompt.
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  const visibleSkills = skills.filter((skill) => !skill.disableModelInvocation);
  if (visibleSkills.length === 0) return "";

  const lines = [
    "\n\nThe following skills provide specialized instructions for specific tasks.",
    "Use the Core `read` tool to load a matching skill's instructions: skill://<skill-name>/SKILL.md",
    "Read auxiliary skill files with skill://<skill-name>/<relative-path>. When Workspace mounts are active, execute Skill scripts only through /skills/<skill-name>/...; never pass skill:// to Bash.",
    "",
    "<available_skills>",
  ];

  for (const skill of visibleSkills) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>skill://${escapeXml(skill.name)}/SKILL.md</location>`);
    lines.push("  </skill>");
  }

  lines.push("</available_skills>");
  return lines.join("\n");
}

/** Load skills from all configured locations with deduplication and collision diagnostics. */
export async function loadSkills(options: LoadSkillsOptions): Promise<LoadSkillsResult> {
  const { cwd, skillPaths } = options;
  const skillMap = new Map<string, Skill>();
  const realPathSet = new Set<string>();
  const allDiagnostics: ResourceDiagnostic[] = [];
  const collisionDiagnostics: ResourceDiagnostic[] = [];

  async function addSkills(result: LoadSkillsResult) {
    allDiagnostics.push(...result.diagnostics);
    for (const skill of result.skills) {
      let realPath: string;
      try {
        realPath = await realpath(skill.filePath);
      } catch {
        realPath = skill.filePath;
      }
      if (realPathSet.has(realPath)) continue;
      const existing = skillMap.get(skill.name);
      if (existing) {
        collisionDiagnostics.push({
          type: "collision",
          message: `name "${skill.name}" collision`,
          path: skill.filePath,
          collision: { resourceType: "skill", name: skill.name, winnerPath: existing.filePath, loserPath: skill.filePath },
        });
      } else {
        skillMap.set(skill.name, skill);
        realPathSet.add(realPath);
      }
    }
  }

  for (const rawPath of skillPaths) {
    const resolvedPath = resolveSkillPath(rawPath, cwd);
    try {
      const stats = await stat(resolvedPath);
      if (stats.isDirectory()) {
        const rootDir = await realpath(resolvedPath);
        await addSkills(await loadSkillsFromDirInternal(resolvedPath, true, rootDir, new Set()));
      } else if (stats.isFile() && resolvedPath.endsWith(".md")) {
        const rootDir = await realpath(dirname(resolvedPath));
        const result = await loadSkillFromFile(resolvedPath, rootDir);
        if (result.skill) {
          await addSkills({ skills: [result.skill], diagnostics: result.diagnostics });
        } else {
          allDiagnostics.push(...result.diagnostics);
        }
      } else {
        allDiagnostics.push({ type: "warning", message: "skill path is not a markdown file", path: resolvedPath });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to read skill path";
      if (message.includes("ENOENT") || message.includes("no such file")) {
        allDiagnostics.push({ type: "warning", message: "skill path does not exist", path: resolvedPath });
        continue;
      }
      allDiagnostics.push({ type: "warning", message, path: resolvedPath });
    }
  }

  return { skills: Array.from(skillMap.values()), diagnostics: [...allDiagnostics, ...collisionDiagnostics] };
}

export const parseFrontmatter = <T extends Record<string, unknown> = Record<string, unknown>>(content: string): ParsedFrontmatter<T> => {
  const parsed = matter(content);
  return { frontmatter: parsed.data as T, body: parsed.content.trim() };
};

export const stripFrontmatter = (content: string): string => parseFrontmatter(content).body;

function validateName(name: string, parentDirName: string): string[] {
  const errors: string[] = [];
  if (name !== parentDirName) errors.push(`name "${name}" does not match parent directory "${parentDirName}"`);
  if (name.length > MAX_NAME_LENGTH) errors.push(`name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`);
  if (!/^[a-z0-9-]+$/.test(name)) errors.push("name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)");
  if (name.startsWith("-") || name.endsWith("-")) errors.push("name must not start or end with a hyphen");
  if (name.includes("--")) errors.push("name must not contain consecutive hyphens");
  return errors;
}

function validateDescription(description: string | undefined): string[] {
  const errors: string[] = [];
  if (!description || description.trim() === "") {
    errors.push("description is required");
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`);
  }
  return errors;
}

async function loadSkillsFromDirInternal(dir: string, includeRootFiles: boolean, rootDir: string, visited: Set<string>): Promise<LoadSkillsResult> {
  const skills: Skill[] = [];
  const diagnostics: ResourceDiagnostic[] = [];
  let realDir: string;
  try {
    realDir = await realpath(dir);
  } catch {
    return { skills, diagnostics };
  }
  if (!isPathContained(rootDir, realDir) || visited.has(realDir)) return { skills, diagnostics };
  visited.add(realDir);

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name !== "SKILL.md") continue;
      const filePath = join(dir, entry.name);
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          isFile = (await stat(filePath)).isFile();
        } catch {
          continue;
        }
      }
      if (!isFile) continue;
      const result = await loadSkillFromFile(filePath, rootDir);
      if (result.skill) skills.push(result.skill);
      diagnostics.push(...result.diagnostics);
      return { skills, diagnostics };
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;
      const fullPath = join(dir, entry.name);

      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const stats = await stat(fullPath);
          isDirectory = stats.isDirectory();
          isFile = stats.isFile();
        } catch {
          continue;
        }
      }

      let realEntryPath: string;
      try {
        realEntryPath = await realpath(fullPath);
      } catch {
        continue;
      }
      if (!isPathContained(rootDir, realEntryPath)) {
        diagnostics.push({ type: "warning", message: "skill path escapes its configured root", path: fullPath });
        continue;
      }

      if (isDirectory) {
        const subResult = await loadSkillsFromDirInternal(fullPath, false, rootDir, visited);
        skills.push(...subResult.skills);
        diagnostics.push(...subResult.diagnostics);
        continue;
      }

      if (!isFile || !includeRootFiles || !entry.name.endsWith(".md")) continue;
      const result = await loadSkillFromFile(fullPath, rootDir);
      if (result.skill) skills.push(result.skill);
      diagnostics.push(...result.diagnostics);
    }
  } catch {}

  return { skills, diagnostics };
}

async function loadSkillFromFile(filePath: string, rootDir?: string): Promise<{ skill: Skill | null; diagnostics: ResourceDiagnostic[] }> {
  const diagnostics: ResourceDiagnostic[] = [];
  try {
    const realFilePath = await realpath(filePath);
    if (rootDir && !isPathContained(rootDir, realFilePath)) {
      return { skill: null, diagnostics: [{ type: "warning", message: "skill path escapes its configured root", path: filePath }] };
    }
    const rawContent = await readFile(realFilePath, "utf-8");
    const { frontmatter } = parseFrontmatter<SkillFrontmatter>(rawContent);
    const skillDir = dirname(realFilePath);
    const parentDirName = basename(skillDir);
    const description = typeof frontmatter.description === "string" ? frontmatter.description : undefined;

    const descriptionErrors = validateDescription(description);
    for (const error of descriptionErrors) {
      diagnostics.push({ type: "warning", message: error, path: filePath });
    }
    const name = typeof frontmatter.name === "string" && frontmatter.name.length > 0 ? frontmatter.name : parentDirName;
    const nameErrors = validateName(name, parentDirName);
    for (const error of nameErrors) {
      diagnostics.push({ type: "warning", message: error, path: filePath });
    }

    const invalidName = nameErrors.some((error) => error.includes("exceeds") || error.includes("invalid characters") || error.includes("must not"));
    if (descriptionErrors.length > 0 || invalidName || !description) {
      return { skill: null, diagnostics };
    }

    return {
      skill: { name, description, filePath: realFilePath, baseDir: skillDir, disableModelInvocation: frontmatter["disable-model-invocation"] === true },
      diagnostics,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to parse skill file";
    diagnostics.push({ type: "warning", message, path: filePath });
    return { skill: null, diagnostics };
  }
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function normalizePath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
  if (trimmed.startsWith("~")) return join(homedir(), trimmed.slice(1));
  return trimmed;
}

function resolveSkillPath(p: string, cwd: string): string {
  const normalized = normalizePath(p);
  return isAbsolute(normalized) ? normalized : resolve(cwd, normalized);
}

function isPathContained(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

export type { LoadSkillsOptions, LoadSkillsResult, ResourceDiagnostic, Skill, SkillFrontmatter } from "./types";
