import type { CommandBridgeConfig } from "./types.js";

export function normalizeCommand(command: string): string {
  return command.trim().replace(/^\/+/, "").toLowerCase();
}

export function commandMatches(pattern: string, command: string): boolean {
  const normalizedPattern = normalizeCommand(pattern);
  const normalizedCommand = normalizeCommand(command);
  return (
    normalizedCommand === normalizedPattern || normalizedCommand.startsWith(`${normalizedPattern}.`) || normalizedCommand.startsWith(`${normalizedPattern} `)
  );
}

export function validateCommandCall(command: string, config: Pick<CommandBridgeConfig, "trustMode" | "allowCommands" | "hardDeny">): string | null {
  if (!command.trim()) return "command is required";

  for (const deny of config.hardDeny) {
    if (commandMatches(deny, command)) return `command '${deny}' is hard-denied`;
  }

  if (config.trustMode === "locked" && !config.allowCommands.some((pattern) => commandMatches(pattern, command))) {
    return "command is not allowed by the locked policy";
  }

  return null;
}
