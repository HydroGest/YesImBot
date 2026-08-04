import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { formatSkillsForPrompt, loadSkills, type Skill } from "../src/skills";

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: "test-skill",
    description: "A test skill",
    filePath: "/path/to/test-skill/SKILL.md",
    baseDir: "/path/to/test-skill",
    disableModelInvocation: false,
    ...overrides,
  };
}

describe("formatSkillsForPrompt", () => {
  it("returns empty string for empty array", () => {
    expect(formatSkillsForPrompt([])).toBe("");
  });

  it("formats single skill with a skill:// location", () => {
    const result = formatSkillsForPrompt([skill()]);
    expect(result).toContain("<available_skills>");
    expect(result).toContain("<name>test-skill</name>");
    expect(result).toContain("<description>A test skill</description>");
    expect(result).toContain("<location>skill://test-skill/SKILL.md</location>");
    expect(result).toContain("</available_skills>");
    expect(result).not.toContain("/path/to");
  });

  it("directs reading through Core read and keeps scripts on mounts", () => {
    const result = formatSkillsForPrompt([skill()]);
    const loaderName = ["load", "skill"].join("_");
    expect(result).toContain("skill://<skill-name>/SKILL.md");
    expect(result).toContain("/skills/<skill-name>/");
    expect(result).not.toContain(loaderName);
  });

  it("formats multiple skills", () => {
    const result = formatSkillsForPrompt([skill({ name: "skill-a" }), skill({ name: "skill-b" })]);
    expect(result).toContain("<name>skill-a</name>");
    expect(result).toContain("<name>skill-b</name>");
  });

  it("excludes skills with disableModelInvocation=true", () => {
    const result = formatSkillsForPrompt([
      skill({ name: "visible" }),
      skill({ name: "hidden", disableModelInvocation: true }),
    ]);
    expect(result).toContain("<name>visible</name>");
    expect(result).not.toContain("<name>hidden</name>");
  });

  it("escapes XML special characters", () => {
    const result = formatSkillsForPrompt([skill({ name: "a", description: 'use <b> & "quoted" values' })]);
    expect(result).toContain("&lt;b&gt;");
    expect(result).toContain("&amp;");
    expect(result).toContain("&quot;quoted&quot;");
  });
});

describe("loadSkills", () => {
  let basePath: string;

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), "yesimbot-workspace-skills-"));
  });

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true });
  });

  it("discovers SKILL.md roots and nested skills", async () => {
    const csv = join(basePath, "csv");
    const nested = join(basePath, "nested");
    await mkdir(csv, { recursive: true });
    await mkdir(nested, { recursive: true });
    await writeFile(join(csv, "SKILL.md"), "---\nname: csv\ndescription: CSV processing\n---\n# CSV");
    await writeFile(join(nested, "SKILL.md"), "---\nname: nested\ndescription: Nested skill\n---\n# Nested");

    const result = await loadSkills({ skillPaths: [basePath], cwd: basePath });
    expect(result.skills.map((item) => item.name).sort()).toEqual(["csv", "nested"]);
  });

  it("reports duplicate name collisions", async () => {
    const first = join(basePath, "first");
    const second = join(basePath, "second");
    await mkdir(first, { recursive: true });
    await mkdir(second, { recursive: true });
    await writeFile(join(first, "SKILL.md"), "---\nname: dup\ndescription: One\n---\n# One");
    await writeFile(join(second, "SKILL.md"), "---\nname: dup\ndescription: Two\n---\n# Two");

    const result = await loadSkills({ skillPaths: [basePath], cwd: basePath });
    expect(result.skills).toHaveLength(1);
    expect(result.diagnostics.some((item) => item.type === "collision")).toBe(true);
  });

  it("warns for missing paths and keeps other skills", async () => {
    const good = join(basePath, "good");
    await mkdir(good, { recursive: true });
    await writeFile(join(good, "SKILL.md"), "---\nname: good\ndescription: Good\n---\n# Good");

    const result = await loadSkills({
      skillPaths: [join(basePath, "missing"), good],
      cwd: basePath,
    });
    expect(result.skills.map((item) => item.name)).toEqual(["good"]);
    expect(result.diagnostics.some((item) => item.message.includes("does not exist"))).toBe(true);
  });
});
