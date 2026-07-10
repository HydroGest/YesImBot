export interface SkillFrontmatter {
  name?: string;
  description?: string;
  "disable-model-invocation"?: boolean;
  [key: string]: unknown;
}

export interface Skill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
}
export interface ResourceCollision {
  resourceType: "extension" | "skill" | "prompt" | "theme";
  name: string; // skill name, command/tool/flag name, prompt name, theme name
  winnerPath: string;
  loserPath: string;
  winnerSource?: string; // e.g., "npm:foo", "git:...", "local"
  loserSource?: string;
}
export interface ResourceDiagnostic {
  type: "warning" | "error" | "collision";
  message: string;
  path?: string;
  collision?: ResourceCollision;
}

export interface LoadSkillsResult {
  skills: Skill[];
  diagnostics: ResourceDiagnostic[];
}

export type LoadSkillToolInput = {
  skill: string;
};

export type LoadSkillToolOutput =
  | {
      path: string;
      content: string;
    }
  | {
      error: string;
    };
