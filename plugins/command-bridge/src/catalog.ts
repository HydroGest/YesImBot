import type { Command } from "koishi";

import { commandMatches } from "./policy.js";
import type { CommandBridgeConfig } from "./types.js";

export interface CommandInfo {
  name: string;
  aliases: string[];
  description?: string;
  children: CommandInfo[];
}

interface UniversalCommandInfo {
  name: string;
  description: Record<string, string>;
  children: UniversalCommandInfo[];
}

export function collectCommandCatalog(commander: { _commandList: readonly Command[] }): CommandInfo[] {
  const roots = commander._commandList.filter((command) => !command.parent);
  return roots.map((command) => toCommandInfo(command.toJSON() as UniversalCommandInfo, command.displayName, Object.keys(command._aliases)));
}

export function filterCommandCatalog(
  catalog: readonly CommandInfo[],
  config: Pick<CommandBridgeConfig, "trustMode" | "allowCommands" | "hardDeny">,
): CommandInfo[] {
  return catalog.map((entry) => ({ ...entry, children: filterCommandCatalog(entry.children, config) })).filter((entry) => isAllowedCommand(entry.name, config));
}

export function formatCommandCatalog(catalog: readonly CommandInfo[]): string {
  return catalog.map((entry) => formatCommandInfo(entry, "")).join("\n");
}

export function formatCommandHelp(command: Command): string {
  const json = command.toJSON() as UniversalCommandInfo & {
    arguments?: Array<{ name: string; type?: string; required?: boolean; description?: Record<string, string> }>;
    options?: Array<{ name: string; type?: string; required?: boolean; description?: Record<string, string> }>;
  };
  const lines: string[] = [];

  lines.push(`## ${command.displayName}`);
  const desc = descToString(json.description);
  if (desc) lines.push(desc);

  if (command._usage) {
    const usage = typeof command._usage === "string" ? command._usage : "(动态用法，执行时生成)";
    lines.push("", "用法:", usage);
  }

  if (json.arguments?.length) {
    lines.push("", "参数:");
    for (const arg of json.arguments) {
      const req = arg.required ? "(必填)" : "(可选)";
      const argDesc = descToString(arg.description);
      lines.push(`  ${arg.name}: ${arg.type ?? "string"} ${req}${argDesc ? " - " + argDesc : ""}`);
    }
  }

  if (json.options?.length) {
    lines.push("", "选项:");
    for (const opt of json.options) {
      const req = opt.required ? "(必填)" : "";
      const optDesc = descToString(opt.description);
      lines.push(`  --${opt.name}: ${opt.type ?? "string"} ${req}${optDesc ? " - " + optDesc : ""}`);
    }
  }

  if (command._examples?.length) {
    lines.push("", "示例:");
    for (const ex of command._examples) lines.push(`  ${ex}`);
  }

  if (command.children?.length) {
    lines.push("", "子命令:");
    for (const child of command.children) {
      const childDesc = descToString(child.toJSON().description as Record<string, string>);
      lines.push(`  ${child.name}${childDesc ? " - " + childDesc : ""}`);
    }
  }

  return lines.join("\n");
}

function toCommandInfo(command: UniversalCommandInfo, name: string, aliases: string[]): CommandInfo {
  const description = command.description?.zh ?? command.description?.en ?? Object.values(command.description ?? {})[0];
  return { name, aliases, description, children: command.children.map((child) => toCommandInfo(child, child.name, [])) };
}

function isAllowedCommand(command: string, config: Pick<CommandBridgeConfig, "trustMode" | "allowCommands" | "hardDeny">): boolean {
  if (config.hardDeny.some((deny) => commandMatches(deny, command))) return false;
  if (config.trustMode === "locked" && !config.allowCommands.some((pattern) => commandMatches(pattern, command))) return false;
  return true;
}

function formatCommandInfo(entry: CommandInfo, indent: string): string {
  const aliasText = entry.aliases.length > 0 ? ` (${entry.aliases.join(", ")})` : "";
  const descriptionText = entry.description ? ` - ${entry.description}` : "";
  const line = `${indent}${entry.name}${aliasText}${descriptionText}`;
  const children = entry.children.map((child) => formatCommandInfo(child, `${indent}  `));
  return [line, ...children].join("\n");
}

function descToString(desc: Record<string, string> | undefined): string {
  if (!desc) return "";
  return desc.zh ?? desc.en ?? Object.values(desc)[0] ?? "";
}
