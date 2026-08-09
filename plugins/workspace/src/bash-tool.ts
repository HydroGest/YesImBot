import type { AgentTool, AgentToolSet } from "@yesimbot/agent-runtime";
import type { Tool } from "ai";
import type { CommandResult, Sandbox } from "bash-tool";
type AbortSignalScope = { getSignal(): AbortSignal | undefined; run<T>(signal: AbortSignal | undefined, operation: () => T): T };
type BackendSandbox = Sandbox & { setPendingCommand(command: string): void };
export interface WorkspaceBashBackend {
  executeCommand(command: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<unknown>;
  readFile(path: string): Promise<string>;
  writeFiles(files: readonly { path: string; content: string }[]): Promise<void>;
}
export interface CreateBashToolSetInput {
  backend: WorkspaceBashBackend;
  destination: string;
  environment: "sandbox" | "host";
}
function createAbortSignalScope(): AbortSignalScope {
  let currentSignal: AbortSignal | undefined;

  return {
    getSignal() {
      return currentSignal;
    },

    run(signal, operation) {
      const previousSignal = currentSignal;
      currentSignal = signal;
      try {
        return operation();
      } finally {
        currentSignal = previousSignal;
      }
    },
  };
}
function withName(name: string, tool: Tool, abortSignals?: AbortSignalScope): AgentTool {
  const agentTool = { ...tool, name } as AgentTool;

  if (!agentTool.execute || !abortSignals) {
    return agentTool;
  }

  const execute = agentTool.execute;
  return {
    ...agentTool,
    execute(input, context) {
      // bash-tool calls sandbox.executeCommand before its first await; this bridges
      // AgentToolExecuteContext.abortSignal without replacing bash-tool's execute logic.
      return abortSignals.run(context.abortSignal, () => execute(input, context));
    },
  };
}
function createBackendSandbox(input: CreateBashToolSetInput, abortSignals: AbortSignalScope): BackendSandbox {
  let pendingCommand: string | undefined;

  return {
    async executeCommand(command) {
      // createBashTool performs tool discovery before it installs its bash-call
      // callback. During an actual call, onBeforeBashCall records the original
      // command so the backend receives structured cwd/signal data instead of
      // having to parse bash-tool's generated `cd` prefix.
      const originalCommand = pendingCommand;
      pendingCommand = undefined;
      return (await input.backend.executeCommand(originalCommand ?? command, { cwd: input.destination, signal: abortSignals.getSignal() })) as CommandResult;
    },

    async readFile(path) {
      return input.backend.readFile(path);
    },

    async writeFiles(files) {
      await input.backend.writeFiles(
        files.map((file) => ({ path: file.path, content: typeof file.content === "string" ? file.content : file.content.toString("utf8") })),
      );
    },

    setPendingCommand(command) {
      pendingCommand = command;
    },
  };
}
export async function createBashToolSet(input: CreateBashToolSetInput): Promise<AgentToolSet> {
  // bash-tool 是 ESM-only 包（exports 无 require 条件）；动态 import 让 Node
  // 运行时直接加载其 ESM build，避免 pkgroll 内联转译进 CJS bundle。
  const { createBashTool } = await import("bash-tool");
  const abortSignals = createAbortSignalScope();
  const sandbox = createBackendSandbox(input, abortSignals);
  const toolkit = await createBashTool({
    sandbox,
    destination: input.destination,
    extraInstructions:
      input.environment === "host" ? "Commands execute in the approved Host environment." : "Commands execute in the Sandbox virtual filesystem.",
    onBeforeBashCall({ command }) {
      sandbox.setPendingCommand(command);
      return undefined;
    },
  });

  return [withName("bash", toolkit.tools.bash, abortSignals), withName("readFile", toolkit.tools.readFile), withName("writeFile", toolkit.tools.writeFile)];
}
