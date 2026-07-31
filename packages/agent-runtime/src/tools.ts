import { jsonSchema, type Tool, type ToolExecutionOptions, type ToolSet } from "ai";

import type { Awaitable } from "./base.js";
import type { AgentChannel } from "./channel.js";
import type { AgentEntry } from "./entry.js";
import { ToolConflictError } from "./errors.js";
import type { AgentPlugin, ToolCallContext, ToolHookContext, ToolResultContext } from "./plugin.js";
import type { AgentStateManager } from "./state.js";
import type { AgentStorage } from "./storage.js";

export interface AgentToolExecuteContext extends ToolExecutionOptions {
  readonly runtime: { id: string };
  readonly channel: AgentChannel;
  readonly state: AgentStateManager;
  readonly storage: AgentStorage<AgentEntry>;
  readonly turnId: string;
}

// oxlint-disable-next-line typescript/no-explicit-any
export type AgentTool<IN = any, OUT = any> = Omit<Tool<IN, OUT>, "execute"> & {
  name: string;
  execute?: (input: IN, options: AgentToolExecuteContext) => Awaitable<OUT>;
};

export type AgentToolSet = AgentTool[];

export type ToolDecision =
  | { type: "allow" }
  | { type: "block"; reason: string }
  | { type: "replace"; args: unknown };

export function mergeTools(toolSets: readonly AgentToolSet[]): AgentToolSet {
  const merged: AgentToolSet = [];
  const seen = new Set<string>();

  for (const tools of toolSets) {
    for (const tool of tools) {
      if (seen.has(tool.name)) {
        throw new ToolConflictError(tool.name);
      }
      seen.add(tool.name);
      merged.push({ ...tool });
    }
  }

  return merged;
}

export async function runBeforeToolHooks(
  plugins: readonly AgentPlugin[],
  call: ToolCallContext,
  context: ToolHookContext,
): Promise<ToolDecision> {
  let current = call;
  let currentDecision: ToolDecision = { type: "allow" };

  for (const plugin of plugins) {
    const decision = await plugin?.beforeToolCall?.(current, context);
    if (!decision || decision.type === "allow") {
      continue;
    }

    if (decision.type === "block") {
      return decision;
    }

    current = { ...current, args: decision.args };
    currentDecision = decision;
  }

  return currentDecision;
}

export async function runAfterToolHooks(
  plugins: readonly AgentPlugin[],
  result: ToolResultContext,
  context: ToolHookContext,
): Promise<ToolResultContext> {
  let current = result;

  for (const plugin of plugins) {
    const patch = await plugin?.afterToolCall?.(current, context);
    if (patch) {
      current = { ...current, ...patch };
    }
  }

  return current;
}

export function toAiToolSet(tools: AgentToolSet): ToolSet {
  const result: ToolSet = {};
  for (const tool of tools) {
    if (tool.name in result) {
      throw new ToolConflictError(tool.name);
    }

    const { name: _name, ...aiTool } = tool;
    result[tool.name] = aiTool as Tool;
  }
  return result;
}

export const DEFAULT_TERMINAL_TOOL_NAME = "finalize_response";

export interface TerminalToolOutput {
  finalized: true;
}

export function resolveTerminalToolName(
  config: boolean | { name?: string } | undefined,
): string | undefined {
  if (!config) {
    return undefined;
  }
  if (config === true) {
    return DEFAULT_TERMINAL_TOOL_NAME;
  }
  return config.name ?? DEFAULT_TERMINAL_TOOL_NAME;
}

export function createTerminalTool(
  name = DEFAULT_TERMINAL_TOOL_NAME,
): AgentTool<Record<string, never>, TerminalToolOutput> {
  return {
    name,
    description:
      "Mark the current assistant response as final. Call this after final text and required tools.",
    inputSchema: jsonSchema({
      type: "object",
      additionalProperties: false,
    }),
    execute: async () => ({ finalized: true }),
  };
}
