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

export function filterCommandCatalog(catalog: readonly CommandInfo[], config: Pick<CommandBridgeConfig, "trustMode" | "allowCommands" | "hardDeny">): CommandInfo[] {
  return catalog
    .map((entry) => ({
      ...entry,
      children: filterCommandCatalog(entry.children, config),
    }))
    .filter((entry) => isAllowedCommand(entry.name, config));
}

export function formatCommandCatalog(catalog: readonly CommandInfo[]): string {
  return catalog.map((entry) => formatCommandInfo(entry, "")).join("\n");
}

function toCommandInfo(command: UniversalCommandInfo, name: string, aliases: string[]): CommandInfo {
  const description = command.description?.zh
    ?? command.description?.en
    ?? Object.values(command.description ?? {})[0];
  return {
    name,
    aliases,
    description,
    children: command.children.map((child) => toCommandInfo(child, child.name, [])),
  };
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
