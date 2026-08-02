import { readFile } from "fs/promises";
import { resolve } from "path";

import { AgentTool, jsonSchema } from "@yesimbot/agent-runtime";
import { Context, Logger, Schema } from "koishi";
import type {} from "koishi-plugin-yesimbot";

import { formatSkillsForPrompt, loadSkills } from "./skills.js";
import { LoadSkillToolInput, LoadSkillToolOutput, Skill } from "./types.js";

export interface SkillConfig {
  skillPaths: string[];
}

export default class SkillPlugin {
  public static name = "yesimbot-skills";
  public static usage = "技能插件，提供技能加载和管理功能";
  public static inject = ["yesimbot"];
  public static Config: Schema<SkillConfig> = Schema.object({
    skillPaths: Schema.array(Schema.path({ filters: ["directory", "file"], allowCreate: true }))
      .default([])
      .description("技能文件路径列表"),
  });

  public readonly ctx: Context;
  public readonly config: SkillConfig;
  public readonly logger: Logger;

  private skills: Skill[] = [];
  private skillPaths: string[] = [];
  private disposeAgentPlugin?: () => void;

  constructor(ctx: Context, config: SkillConfig) {
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("yesimbot.skill");
    this.skillPaths = config.skillPaths.map((path) => resolve(ctx.baseDir, path));

    ctx.on("ready", this.start.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  public async start(): Promise<void> {
    const loadResult = await loadSkills({ skillPaths: this.skillPaths, cwd: this.ctx.baseDir });
    for (const diagnostic of loadResult.diagnostics) {
      if (diagnostic.type === "error") {
        this.logger.error(
          `加载技能时发生错误: ${diagnostic.message} ${diagnostic.path ? `(路径: ${diagnostic.path})` : ""}`,
        );
      } else if (diagnostic.type === "warning") {
        this.logger.warn(
          `加载技能时发生警告: ${diagnostic.message} ${diagnostic.path ? `(路径: ${diagnostic.path})` : ""}`,
        );
      } else if (diagnostic.type === "collision") {
        this.logger.warn(
          `资源冲突: ${diagnostic.message} 资源类型: ${diagnostic.collision?.resourceType} 资源名称: ${diagnostic.collision?.name} 胜者路径: ${diagnostic.collision?.winnerPath} 败者路径: ${diagnostic.collision?.loserPath}`,
        );
      }
    }
    this.skills.splice(0, this.skills.length, ...loadResult.skills);
    for (const skill of this.skills) {
      this.logger.info(`成功加载技能: ${skill.name} (${skill.filePath})`);
    }

    this.disposeAgentPlugin?.();
    const skillTool: AgentTool<LoadSkillToolInput, LoadSkillToolOutput> = {
      name: "load_skill",
      description: "加载技能",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          skill: {
            type: "string",
            description: 'The skill name. E.g., "commit", "review-pr", or "pdf"',
          },
        },
        required: ["skill"],
        additionalProperties: false,
      }),
      execute: async ({ skill: skillName }, _options) => {
        const skill = this.skills.find((s) => s.name === skillName);
        if (!skill) {
          return {
            error: `未找到技能: ${skillName}`,
          };
        }
        const content = await readFile(skill.filePath, "utf-8");
        return {
          path: skill.filePath,
          content: content,
        };
      },
    };

    this.disposeAgentPlugin = this.ctx.yesimbot.registerChannelPlugin(() => {
      return {
        name: "skill",
        tools: [skillTool],
        appendSystemPrompt: () => {
          return formatSkillsForPrompt(this.skills);
        },
      };
    });
  }
  public async stop(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;
  }
}
