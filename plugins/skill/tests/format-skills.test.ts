import { describe, it, expect } from "vitest";

import { formatSkillsForPrompt } from "../src/skills";
import { Skill } from "../src/types";

describe("formatSkillsForPrompt", () => {
  it("returns empty string for empty array", () => {
    expect(formatSkillsForPrompt([])).toBe("");
  });

  it("formats single skill in XML", () => {
    const skills: Skill[] = [
      {
        name: "test-skill",
        description: "A test skill",
        filePath: "/path/to/skill.md",
        baseDir: "/path/to",
        disableModelInvocation: false,
      },
    ];
    const result = formatSkillsForPrompt(skills);
    expect(result).toContain("<available_skills>");
    expect(result).toContain("<name>test-skill</name>");
    expect(result).toContain("<description>A test skill</description>");
    expect(result).toContain("<location>/path/to/skill.md</location>");
    expect(result).toContain("</available_skills>");
  });

  it("formats multiple skills", () => {
    const skills: Skill[] = [
      {
        name: "skill-a",
        description: "Skill A",
        filePath: "/a.md",
        baseDir: "/",
        disableModelInvocation: false,
      },
      {
        name: "skill-b",
        description: "Skill B",
        filePath: "/b.md",
        baseDir: "/",
        disableModelInvocation: false,
      },
    ];
    const result = formatSkillsForPrompt(skills);
    expect(result).toContain("<name>skill-a</name>");
    expect(result).toContain("<name>skill-b</name>");
  });

  it("excludes skills with disableModelInvocation=true", () => {
    const skills: Skill[] = [
      {
        name: "visible",
        description: "Visible skill",
        filePath: "/visible.md",
        baseDir: "/",
        disableModelInvocation: false,
      },
      {
        name: "hidden",
        description: "Hidden skill",
        filePath: "/hidden.md",
        baseDir: "/",
        disableModelInvocation: true,
      },
    ];
    const result = formatSkillsForPrompt(skills);
    expect(result).toContain("<name>visible</name>");
    expect(result).not.toContain("<name>hidden</name>");
  });

  it("returns empty string when all skills are hidden", () => {
    const skills: Skill[] = [
      {
        name: "hidden",
        description: "Hidden",
        filePath: "/h.md",
        baseDir: "/",
        disableModelInvocation: true,
      },
    ];
    expect(formatSkillsForPrompt(skills)).toBe("");
  });

  it("escapes XML special characters", () => {
    const skills: Skill[] = [
      {
        name: "xml-test",
        description: 'Description with <special> & "chars"',
        filePath: "/path",
        baseDir: "/",
        disableModelInvocation: false,
      },
    ];
    const result = formatSkillsForPrompt(skills);
    expect(result).toContain("&lt;special&gt;");
    expect(result).toContain("&amp;");
    expect(result).toContain("&quot;chars&quot;");
  });
});
