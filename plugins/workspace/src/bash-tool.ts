import type { AgentTool, AgentToolSet } from "@yesimbot/agent-runtime";
import type { Tool } from "ai";
import { createBashTool, type Sandbox } from "bash-tool";

import type { Workspace } from "./workspace";

type AbortSignalScope = {
  getSignal(): AbortSignal | undefined;
  run<T>(signal: AbortSignal | undefined, operation: () => T): T;
};

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

async function executeWorkspaceCommand(
  workspace: Workspace,
  command: string,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const timeoutSignal = AbortSignal.timeout(workspace.defaultTimeoutMs);
    const result = await workspace.bash.exec(command, {
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return {
        stdout: "",
        stderr: `Command timed out after ${workspace.defaultTimeoutMs}ms`,
        exitCode: 124,
      };
    }

    return {
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 1,
    };
  }
}

function createWorkspaceSandbox(workspace: Workspace, abortSignals: AbortSignalScope): Sandbox {
  return {
    async executeCommand(command) {
      return await executeWorkspaceCommand(workspace, command, abortSignals.getSignal());
    },

    async readFile(path) {
      return workspace.fs.readFile(path, "utf8");
    },

    async writeFiles(files) {
      for (const file of files) {
        const content =
          typeof file.content === "string" ? file.content : file.content.toString("utf-8");
        await workspace.fs.writeFile(file.path, content, "utf8");
      }
    },
  };
}

function withName(name: string, tool: Tool, abortSignals?: AbortSignalScope): AgentTool {
  const agentTool = {
    ...tool,
    name,
  } as AgentTool;

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

export async function createBashToolSet(workspace: Workspace): Promise<AgentToolSet> {
  const abortSignals = createAbortSignalScope();
  const toolkit = await createBashTool({
    sandbox: createWorkspaceSandbox(workspace, abortSignals),
    destination: workspace.config.bash.cwd,
  });

  return [
    withName("bash", toolkit.tools.bash, abortSignals),
    withName("readFile", toolkit.tools.readFile),
    withName("writeFile", toolkit.tools.writeFile),
  ];
}
