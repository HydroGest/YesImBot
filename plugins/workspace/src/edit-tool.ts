import type { AgentTool } from "@yesimbot/agent-runtime";
import { z } from "zod";

import type { WorkspaceBashBackend } from "./bash-tool";

const editFileSchema = z.object({
  path: z.string().describe("The absolute path to the file to edit"),
  oldString: z.string().describe("The exact text to find in the file (must match exactly, including whitespace and indentation)"),
  newString: z.string().describe("The text to replace it with (can be empty to delete the matched text)"),
  replaceAll: z.boolean().optional().default(false).describe("Replace all occurrences instead of just the first"),
});

export interface CreateEditToolInput {
  backend: WorkspaceBashBackend;
  cwd: string;
}

export function createEditTool(input: CreateEditToolInput): AgentTool {
  const { backend, cwd } = input;

  return {
    name: "editFile",
    description:
      "Make a targeted edit to a file by specifying the exact text to find and its replacement. " +
      "Use this for surgical changes instead of rewriting the entire file with writeFile. " +
      "The oldString must match the file content exactly (including indentation and whitespace). " +
      "For creating new files or full rewrites, use writeFile instead.",
    inputSchema: editFileSchema,
    async execute({ path, oldString, newString, replaceAll }) {
      const resolvedPath = resolvePath(cwd, path);

      let content: string;
      try {
        content = await backend.readFile(resolvedPath);
      } catch {
        return { success: false, error: `File not found: ${resolvedPath}` };
      }

      if (oldString === newString) {
        return { success: false, error: "oldString and newString are identical; no change needed" };
      }

      if (!content.includes(oldString)) {
        return { success: false, error: "oldString not found in the file. Ensure it matches exactly, including whitespace and indentation." };
      }

      const occurrences = content.split(oldString).length - 1;
      if (!replaceAll && occurrences > 1) {
        return {
          success: false,
          error: `oldString appears ${occurrences} times in the file. Set replaceAll: true to replace all, or provide a more specific oldString that matches uniquely.`,
        };
      }

      const updated = replaceAll ? content.replaceAll(oldString, newString) : content.replace(oldString, newString);

      await backend.writeFiles([{ path: resolvedPath, content: updated }]);

      return { success: true, replacements: replaceAll ? occurrences : 1 };
    },
  };
}

function resolvePath(cwd: string, path: string): string {
  if (path.startsWith("/")) return path;
  // Simple posix join for sandbox paths
  const base = cwd.endsWith("/") ? cwd : cwd + "/";
  return base + path;
}
