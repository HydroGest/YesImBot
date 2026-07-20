import type { Workspace } from "./workspace";

function formatMountLabel(kind: Workspace["mounts"][number]["kind"]): string {
  if (kind === "read-only") {
    return "read-only";
  }
  if (kind === "overlay") {
    return "overlay";
  }
  return "persistent";
}

export function formatWorkspacePrompt(workspace: Workspace): string {
  const networkState = workspace.config.bash.network ? "enabled" : "disabled";
  const mountLines = workspace.mounts.map(
    (mount) => `- ${mount.path}: ${formatMountLabel(mount.kind)}`,
  );

  return [
    "## Workspace Sandbox",
    "You can use workspace tools backed by a just-bash virtual Bash sandbox.",
    `Current working directory: ${workspace.config.bash.cwd}`,
    "Workspace scope: channel-isolated. Files in /home/workspace are shared only within this Koishi channel context.",
    `Network access: ${networkState}`,
    `Command timeout: ${workspace.defaultTimeoutMs} ms`,
    "",
    "Filesystem mounts:",
    ...mountLines,
    "",
    "Shell state such as cd, aliases, functions, and exported variables does not persist between bash calls. Filesystem changes do persist within the channel workspace.",
    "Use readFile for known files, writeFile for complete file writes, and bash for listing, searching, transformations, and pipelines.",
    "Use help or which before assuming a host binary exists; this is not the host shell.",
  ].join("\n");
}
