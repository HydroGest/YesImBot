import type { Workspace } from "./workspace";

export interface HostWorkspacePromptOptions {
  workspaceDir: string;
  timeoutMs: number;
  hostRoots: readonly { readonly path: string; readonly mode: "ro" | "rw" }[];
}

/**
 * Host-mode system prompt: real cwd, configured roots, risk classification, and approval behavior.
 * Unlike the sandbox prompt, it does not describe virtual mounts or a fake filesystem.
 */
export function formatHostWorkspacePrompt(options: HostWorkspacePromptOptions): string {
  return [
    "## 工作区（host 模式）",
    `当前处于宿主机 Host 模式：bash 在真实宿主机环境中执行，真实 cwd 为 ${options.workspaceDir}。这不是 just-bash 沙箱。`,
    `文件工具受隐含的可写频道工作区与配置的 Host roots 限制：${options.hostRoots.length > 0 ? options.hostRoots.map((root) => `${root.mode}:${root.path}`).join(", ") : "没有额外 roots"}。不要假设工作区之外的路径可读写，也不要尝试绕过 canonical path、symlink 或大小限制。`,
    "每次请求都生成一个完整的单次 tool call；不要把 secrets 放入命令或参数，不要使用宽泛路径、无界变更或绕过尝试。",
    "普通、有界、只读命令可以直接执行；写入、删除、覆盖、网络、解释器、脚本、后台任务、复杂结构或动态展开会在执行前暂停并请求管理员审批。",
    "审批通知只发送脱敏摘要与风险标签；只有 authority-5 管理员可以使用 yesimbot.workspace.approvals、yesimbot.workspace.approve <requestId>、yesimbot.workspace.reject <requestId>。",
    "审批被拒绝、过期、取消或插件停止后，原始调用会被阻断，不会被改写，也不会自动重试；请停止并向用户说明下一步。",
    `频道工作区目录（持久化，按频道隔离）：${options.workspaceDir}`,
    `workspace:///relative/path 与 ${options.workspaceDir}/relative/path 是同一个文件，可用于对外引用；bash 只能使用真实路径。`,
    `命令超时：${options.timeoutMs} ms；stdout/stderr 各最多 30KB，超出静默截断。`,
  ].join("\n");
}

function formatMountLabel(kind: Workspace["mounts"][number]["kind"]): string {
  if (kind === "read-only") {
    return "只读（写入会失败）";
  }
  if (kind === "overlay") {
    return "覆盖层（能读到真实内容，但写入只停留在内存，看起来成功却不会落盘，下次调用即消失）";
  }
  return "持久（真实读写，改动会落盘）";
}

export function formatWorkspacePrompt(workspace: Workspace): string {
  const networkState = workspace.config.bash.network ? "启用" : "禁用";
  const mountLines = workspace.mounts.map((mount) => `- ${mount.path}：${formatMountLabel(mount.kind)}`);

  return [
    "## 工作区沙箱",
    "你可以使用由 just-bash 虚拟沙箱支撑的工作区工具。它不是宿主机 shell：命令由 JS 解释执行，只有下列挂载点存在，宿主机上的其他文件与二进制都不可见。不要假设某个命令存在，先用 help 或 which 确认。",
    `当前工作目录：${workspace.config.bash.cwd}`,
    "工作区按频道隔离：/home/workspace 下的文件只在当前频道内共享。",
    `网络访问：${networkState}`,
    `命令超时：${workspace.defaultTimeoutMs} ms`,
    "bash 的 stdout 与 stderr 各自最多返回约 30 KB，超出会被静默截断；处理大输出时先用 wc、head、grep 收窄再看。",
    "",
    "文件系统挂载：",
    ...mountLines,
    "",
    "bash 调用之间不保留 shell 状态：cd、别名、函数、导出的变量都不跨调用；需要切目录时在同一条命令里写 cd <dir> && <cmd>。文件系统的改动会在频道工作区内持久保留。",
    "读已知文件用 readFile，整文件写入用 writeFile，列目录、搜索、转换和管道用 bash。",
    "",
    "/home/workspace/x.png 与 workspace:///x.png 是同一个文件的两种称法：前者给沙箱内的 readFile/bash 用，后者是对外引用，用于 Core 的 read、分析工具，或作为 img/file 的 src 发送出去。bash 不接受 workspace:// 形式的 URI。",
    "平台输入的图片与文件（asset://）以及工具工件（artifact://）不在沙箱里，也不在任何挂载点下：ls /home/workspace 找不到刚收到的图片或文件，bash 也无法处理它们，只能通过 Core 的 read 读取；需要用 bash 处理其内容时，先 read 出来再 writeFile 写进工作区。反过来，沙箱里的文件也只有通过 workspace:// 才能被外部引用。",
    "技能文件是只读资源：用 Core 的 read 读 skill://<skill-name>/SKILL.md 或 skill://<skill-name>/<relative-path>；执行技能脚本只能走 /skills/<skill-name>/... 挂载路径。",
  ].join("\n");
}
