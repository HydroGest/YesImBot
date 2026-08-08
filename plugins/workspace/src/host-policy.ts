import { createHash, randomUUID } from "node:crypto";
import { lstatSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";

import { parse, type WordNode } from "just-bash";
import type { ChannelScope } from "koishi-plugin-yesimbot";

import type { HostChannelRule, HostRootSpec } from "./types";

export const HOST_READ_LIMIT_BYTES = 10 * 1024 * 1024;

export type HostPolicyDecision = { kind: "allow" } | { kind: "approve"; fingerprint: string; riskTags: string[]; summary: string };

export interface HostPolicy {
  checkChannel(scope: ChannelScope): boolean;
  checkFile(tool: "readFile" | "writeFile", path: string): void;
  classify(scope: ChannelScope, toolName: string, input: unknown): HostPolicyDecision;
}

export interface HostPolicyOptions {
  readonly allowedChannels?: readonly HostChannelRule[];
  readonly hostRoots?: readonly HostRootSpec[];
  readonly workspaceRoot?: string;
  readonly cwd?: string;
  readonly policyRevision?: string | number;
}

type RootMode = "ro" | "rw";
type Root = { path: string; mode: RootMode };
type RiskTag =
  | "assignment"
  | "background"
  | "command-substitution"
  | "compound"
  | "delete"
  | "dynamic-command"
  | "dynamic-expansion"
  | "environment"
  | "interpreter"
  | "network"
  | "overwrite"
  | "parser-unsupported"
  | "process-substitution"
  | "redirection"
  | "script"
  | "unbounded"
  | "unknown-command"
  | "write";

type WalkState = {
  readonly riskTags: Set<RiskTag>;
  readonly commands: string[];
  commandCount: number;
};

type RecordValue = Record<string, unknown>;

const RISK_TAG_ORDER: readonly RiskTag[] = [
  "parser-unsupported",
  "delete",
  "overwrite",
  "write",
  "network",
  "interpreter",
  "script",
  "environment",
  "background",
  "command-substitution",
  "process-substitution",
  "dynamic-command",
  "dynamic-expansion",
  "redirection",
  "assignment",
  "compound",
  "unbounded",
  "unknown-command",
];

const READ_ONLY_COMMANDS: Record<string, true> = {
  printf: true,
  cat: true,
  cmp: true,
  comm: true,
  cut: true,
  date: true,
  diff: true,
  dirname: true,
  du: true,
  echo: true,
  file: true,
  grep: true,
  head: true,
  id: true,
  ls: true,
  pwd: true,
  readlink: true,
  realpath: true,
  sed: true,
  sha1sum: true,
  sha256sum: true,
  sort: true,
  stat: true,
  tail: true,
  test: true,
  tr: true,
  true: true,
  type: true,
  uniq: true,
  wc: true,
  which: true,
  whoami: true,
};

const WRITE_COMMANDS: Record<string, true> = {
  chmod: true,
  chgrp: true,
  chown: true,
  cp: true,
  dd: true,
  install: true,
  ln: true,
  mkdir: true,
  mktemp: true,
  mv: true,
  rm: true,
  rmdir: true,
  shred: true,
  tee: true,
  touch: true,
  truncate: true,
  unlink: true,
};

const NETWORK_COMMANDS: Record<string, true> = {
  curl: true,
  ftp: true,
  http: true,
  nc: true,
  ncat: true,
  netcat: true,
  scp: true,
  sftp: true,
  ssh: true,
  telnet: true,
  wget: true,
};

const INTERPRETER_COMMANDS: Record<string, true> = {
  bash: true,
  bun: true,
  dash: true,
  deno: true,
  fish: true,
  js: true,
  lua: true,
  node: true,
  nodejs: true,
  perl: true,
  php: true,
  python: true,
  python2: true,
  python3: true,
  ruby: true,
  sh: true,
  zsh: true,
};

const SCRIPT_SUFFIXES = /\.(?:bash?|command|js|lua|php|pl|py|rb|sh|tcl|ts)$/i;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null;
}

function hasType(value: unknown, type: string): value is RecordValue & { type: string } {
  return isRecord(value) && value.type === type;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function normalizeRules(value: readonly HostChannelRule[] | undefined): {
  readonly rules: readonly HostChannelRule[];
  readonly valid: boolean;
} {
  if (!Array.isArray(value) || value.length === 0) return { rules: [], valid: false };

  let valid = true;
  const rules: HostChannelRule[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) {
      valid = false;
      continue;
    }
    const platform = candidate.platform;
    const channelId = candidate.channelId;
    const type = candidate.type;
    const selfId = candidate.selfId;
    if (
      !isString(platform) ||
      platform.length === 0 ||
      !isString(channelId) ||
      channelId.length === 0 ||
      (type !== undefined && type !== "shared" && type !== "direct") ||
      (selfId !== undefined && (!isString(selfId) || selfId.length === 0))
    ) {
      valid = false;
      continue;
    }
    rules.push({
      platform,
      channelId,
      ...(type === undefined ? {} : { type }),
      ...(selfId === undefined ? {} : { selfId }),
    });
  }
  return { rules, valid: valid && rules.length > 0 };
}

function scopeIsUsable(scope: unknown): scope is ChannelScope {
  if (!isRecord(scope)) return false;
  if (scope.type !== "shared" && scope.type !== "direct") return false;
  if (!isString(scope.platform) || scope.platform.length === 0) return false;
  if (!isString(scope.channelId) || scope.channelId.length === 0) return false;
  if (scope.selfId !== undefined && !isString(scope.selfId)) return false;
  return true;
}

function matchesRule(scope: ChannelScope, rule: HostChannelRule): boolean {
  if (scope.platform !== rule.platform && rule.platform !== "*") return false;
  if (scope.channelId !== rule.channelId && rule.channelId !== "*") return false;
  if (rule.type !== undefined && scope.type !== rule.type) return false;
  if (rule.selfId !== undefined && (scope.selfId === undefined || (scope.selfId !== rule.selfId && rule.selfId !== "*"))) {
    return false;
  }
  return true;
}

function normalizeRootPath(path: unknown): string | undefined {
  return isString(path) && path.length > 0 && !path.includes("\0") ? resolve(path) : undefined;
}

function pathContains(root: string, target: string): boolean {
  const remainder = relative(root, target);
  return remainder !== "" && remainder !== ".." && !remainder.startsWith(`..${sep}`) && !remainder.startsWith(sep);
}

function hasTraversal(path: string): boolean {
  return path
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => segment === "..");
}

function canonicalCwd(path: string | undefined, workspaceRoot: string | undefined): string {
  const candidate = normalizeRootPath(path ?? workspaceRoot);
  if (!candidate) return "";
  try {
    return realpathSync(candidate);
  } catch {
    return candidate;
  }
}

function commandFromInput(input: unknown): string | undefined {
  if (typeof input === "string") return input;
  if (!isRecord(input)) return undefined;
  return isString(input.command) ? input.command : undefined;
}

function directPathFromInput(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  return isString(input.path) ? input.path : undefined;
}

function originalBytesForFingerprint(input: unknown): string {
  const command = commandFromInput(input);
  if (command !== undefined) return command;
  if (input === undefined) return "";
  try {
    return JSON.stringify(input) ?? "";
  } catch {
    return "";
  }
}

function makeFingerprint(scope: ChannelScope, toolName: string, cwd: string, policyRevision: string, originalCommand: string): string {
  const normalizedScope = {
    type: scope.type,
    platform: scope.platform,
    channelId: scope.channelId,
    selfId: scope.selfId ?? null,
  };
  return createHash("sha256")
    .update(JSON.stringify({ scope: normalizedScope, toolName, cwd, policyRevision }), "utf8")
    .update("\0", "utf8")
    .update(Buffer.from(originalCommand, "utf8"))
    .digest("hex");
}

function literalWord(word: WordNode): string | undefined {
  if (!hasType(word, "Word") || !Array.isArray(word.parts)) return undefined;
  let value = "";
  for (const part of word.parts) {
    if (!isRecord(part)) return undefined;
    switch (part.type) {
      case "Literal":
      case "SingleQuoted":
      case "Escaped":
        if (!isString(part.value)) return undefined;
        value += part.value;
        break;
      case "DoubleQuoted": {
        if (!Array.isArray(part.parts)) return undefined;
        const nested = literalWord({ type: "Word", parts: part.parts } as WordNode);
        if (nested === undefined) return undefined;
        value += nested;
        break;
      }
      default:
        return undefined;
    }
  }
  return value;
}

function addTag(state: WalkState, tag: RiskTag): void {
  state.riskTags.add(tag);
}

function walkArithmetic(value: unknown, state: WalkState, seen: Set<object>): void {
  if (!isRecord(value) || seen.has(value)) return;
  seen.add(value);
  if (typeof value.type === "string" && value.type === "ArithCommandSubst") {
    addTag(state, "command-substitution");
  }
  for (const child of Object.values(value)) {
    if (isRecord(child) || Array.isArray(child)) walkArithmetic(child, state, seen);
  }
}

function walkWord(word: unknown, state: WalkState): void {
  if (!hasType(word, "Word") || !Array.isArray(word.parts)) {
    addTag(state, "parser-unsupported");
    return;
  }
  for (const part of word.parts) {
    if (!isRecord(part) || typeof part.type !== "string") {
      addTag(state, "parser-unsupported");
      continue;
    }
    switch (part.type) {
      case "Literal":
      case "SingleQuoted":
      case "Escaped":
        if (!isString(part.value)) addTag(state, "parser-unsupported");
        break;
      case "DoubleQuoted":
        walkWord({ type: "Word", parts: part.parts } as WordNode, state);
        break;
      case "ParameterExpansion":
        addTag(state, "dynamic-expansion");
        if (part.operation && isRecord(part.operation)) {
          for (const child of Object.values(part.operation)) {
            if (isRecord(child) && child.type === "Word") walkWord(child, state);
            else if (isRecord(child) || Array.isArray(child)) walkArithmetic(child, state, new Set());
          }
        }
        break;
      case "CommandSubstitution":
        addTag(state, "command-substitution");
        walkScript(part.body, state);
        break;
      case "ArithmeticExpansion":
        addTag(state, "dynamic-expansion");
        walkArithmetic(part.expression, state, new Set());
        break;
      case "ProcessSubstitution":
        addTag(state, "process-substitution");
        addTag(state, "command-substitution");
        walkScript(part.body, state);
        break;
      case "BraceExpansion":
      case "TildeExpansion":
      case "Glob":
        addTag(state, "dynamic-expansion");
        break;
      default:
        addTag(state, "parser-unsupported");
        break;
    }
  }
}

function walkRedirections(redirections: unknown, state: WalkState): void {
  if (!Array.isArray(redirections)) {
    addTag(state, "parser-unsupported");
    return;
  }
  for (const redirection of redirections) {
    if (!hasType(redirection, "Redirection") || typeof redirection.operator !== "string") {
      addTag(state, "parser-unsupported");
      continue;
    }
    addTag(state, "redirection");
    if ([">", ">>", ">|", "&>", "&>>", "<>", "<<<"].includes(redirection.operator)) {
      addTag(state, "write");
      if ([">", ">>", ">|", "&>", "&>>", "<>"].includes(redirection.operator)) addTag(state, "overwrite");
    }
    if (redirection.target && hasType(redirection.target, "HereDoc")) {
      walkWord(redirection.target.content, state);
    } else {
      walkWord(redirection.target, state);
    }
  }
}

function classifySimpleCommand(command: RecordValue, state: WalkState): void {
  state.commandCount += 1;
  if (state.commandCount > 32) addTag(state, "unbounded");

  const name = command.name;
  const literalName = name === null ? undefined : literalWord(name as WordNode);
  if (name !== null) {
    walkWord(name, state);
    if (literalName === undefined || literalName.length === 0) addTag(state, "dynamic-command");
  }

  const assignments = command.assignments;
  if (!Array.isArray(assignments)) {
    addTag(state, "parser-unsupported");
  } else {
    for (const assignment of assignments) {
      if (!hasType(assignment, "Assignment")) {
        addTag(state, "parser-unsupported");
        continue;
      }
      addTag(state, "assignment");
      if (assignment.value) walkWord(assignment.value, state);
      if (Array.isArray(assignment.array)) for (const word of assignment.array) walkWord(word, state);
    }
  }

  const args = command.args;
  if (!Array.isArray(args)) addTag(state, "parser-unsupported");
  else for (const arg of args) walkWord(arg, state);
  walkRedirections(command.redirections, state);

  if (literalName === undefined || literalName.length === 0) {
    if (name === null) addTag(state, "assignment");
    return;
  }
  const commandName = basename(literalName);
  state.commands.push(commandName);

  if (WRITE_COMMANDS[commandName]) {
    addTag(state, "write");
    if (commandName === "rm" || commandName === "rmdir" || commandName === "unlink" || commandName === "shred") addTag(state, "delete");
    if (["cp", "mv", "tee", "truncate"].includes(commandName)) addTag(state, "overwrite");
  } else if (NETWORK_COMMANDS[commandName]) {
    addTag(state, "network");
  } else if (INTERPRETER_COMMANDS[commandName]) {
    addTag(state, "interpreter");
  } else if (commandName === "source" || commandName === "." || commandName === "eval" || commandName === "exec" || commandName === "xargs") {
    addTag(state, "script");
  } else if (!READ_ONLY_COMMANDS[commandName]) {
    addTag(state, "unknown-command");
  }

  if (literalName.includes("/") && SCRIPT_SUFFIXES.test(literalName)) addTag(state, "script");
  if (commandName === "env" || commandName === "printenv") addTag(state, "environment");
  if (commandName === "sed" && argsContainFlag(args, ["-i", "--in-place"])) {
    addTag(state, "write");
    addTag(state, "overwrite");
  }
  if (commandName === "find" && argsContainFlag(args, ["-delete", "-exec", "-execdir", "-ok", "-okdir"])) addTag(state, "write");
  if (commandName === "printf" && argsContainFlag(args, ["-v"])) addTag(state, "assignment");
}

function argsContainFlag(args: unknown, flags: readonly string[]): boolean {
  if (!Array.isArray(args)) return false;
  return args.some((arg) => {
    if (!hasType(arg, "Word")) return false;
    const value = literalWord(arg as unknown as WordNode);
    return value !== undefined && flags.includes(value);
  });
}

function walkCommand(command: unknown, state: WalkState): void {
  if (!isRecord(command) || typeof command.type !== "string") {
    addTag(state, "parser-unsupported");
    return;
  }
  switch (command.type) {
    case "SimpleCommand":
      classifySimpleCommand(command, state);
      return;
    case "If":
      addTag(state, "compound");
      if (!Array.isArray(command.clauses)) addTag(state, "parser-unsupported");
      else {
        for (const clause of command.clauses) {
          if (!isRecord(clause)) addTag(state, "parser-unsupported");
          else {
            walkStatements(clause.condition, state);
            walkStatements(clause.body, state);
          }
        }
      }
      walkStatements(command.elseBody, state);
      walkRedirections(command.redirections, state);
      return;
    case "For":
      addTag(state, "compound");
      if (Array.isArray(command.words)) for (const word of command.words) walkWord(word, state);
      else if (command.words !== null) addTag(state, "parser-unsupported");
      walkStatements(command.body, state);
      walkRedirections(command.redirections, state);
      return;
    case "CStyleFor":
      addTag(state, "compound");
      walkArithmetic(command.init, state, new Set());
      walkArithmetic(command.condition, state, new Set());
      walkArithmetic(command.update, state, new Set());
      walkStatements(command.body, state);
      walkRedirections(command.redirections, state);
      return;
    case "While":
    case "Until":
      addTag(state, "compound");
      walkStatements(command.condition, state);
      walkStatements(command.body, state);
      walkRedirections(command.redirections, state);
      return;
    case "Case":
      addTag(state, "compound");
      walkWord(command.word, state);
      if (!Array.isArray(command.items)) addTag(state, "parser-unsupported");
      else {
        for (const item of command.items) {
          if (!isRecord(item)) addTag(state, "parser-unsupported");
          else {
            if (Array.isArray(item.patterns)) for (const pattern of item.patterns) walkWord(pattern, state);
            else addTag(state, "parser-unsupported");
            walkStatements(item.body, state);
          }
        }
      }
      walkRedirections(command.redirections, state);
      return;
    case "Subshell":
    case "Group":
      addTag(state, "compound");
      walkStatements(command.body, state);
      walkRedirections(command.redirections, state);
      return;
    case "ArithmeticCommand":
      addTag(state, "compound");
      walkArithmetic(command.expression, state, new Set());
      walkRedirections(command.redirections, state);
      return;
    case "ConditionalCommand":
      addTag(state, "compound");
      walkArithmetic(command.expression, state, new Set());
      walkRedirections(command.redirections, state);
      return;
    case "FunctionDef":
      addTag(state, "script");
      walkCommand(command.body, state);
      walkRedirections(command.redirections, state);
      return;
    default:
      addTag(state, "parser-unsupported");
  }
}

function walkStatements(value: unknown, state: WalkState): void {
  if (!Array.isArray(value)) {
    if (value !== null && value !== undefined) addTag(state, "parser-unsupported");
    return;
  }
  for (const statement of value) walkStatement(statement, state);
}

function walkStatement(statement: unknown, state: WalkState): void {
  if (!isRecord(statement) || statement.type !== "Statement" || !Array.isArray(statement.pipelines)) {
    addTag(state, "parser-unsupported");
    return;
  }
  if (statement.background === true) addTag(state, "background");
  else if (statement.background !== false) addTag(state, "parser-unsupported");
  if (statement.deferredError) addTag(state, "parser-unsupported");
  for (const pipeline of statement.pipelines) {
    if (!isRecord(pipeline) || pipeline.type !== "Pipeline" || !Array.isArray(pipeline.commands)) {
      addTag(state, "parser-unsupported");
      continue;
    }
    if (pipeline.negated || pipeline.timed || pipeline.timePosix) addTag(state, "compound");
    for (const command of pipeline.commands) walkCommand(command, state);
  }
}

function walkScript(script: unknown, state: WalkState): void {
  if (!isRecord(script) || script.type !== "Script" || !Array.isArray(script.statements)) {
    addTag(state, "parser-unsupported");
    return;
  }
  for (const statement of script.statements) walkStatement(statement, state);
}

function orderedRiskTags(state: WalkState): string[] {
  return RISK_TAG_ORDER.filter((tag) => state.riskTags.has(tag));
}

function summaryFor(state: WalkState, riskTags: readonly string[]): string {
  const knownCommands = state.commands.filter(
    (command) => READ_ONLY_COMMANDS[command] || WRITE_COMMANDS[command] || NETWORK_COMMANDS[command] || INTERPRETER_COMMANDS[command],
  );
  const commandPart = knownCommands.length > 0 ? knownCommands.slice(0, 8).join(", ") : "unrecognized command";
  return `Host bash ${commandPart}; arguments and paths redacted; risks: ${riskTags.join(", ") || "none"}`;
}

function resolveExistingParent(candidate: string): string {
  try {
    return realpathSync(dirname(candidate));
  } catch {
    throw new Error("Host file parent does not exist");
  }
}

function canonicalFileCandidate(path: string, cwd: string): { input: string; canonical: string; exists: boolean } {
  if (path.length === 0) throw new Error("Host file path is required");
  if (path.includes("\0")) throw new Error("Host file path contains NUL");
  if (hasTraversal(path)) throw new Error("Host file path traversal is not allowed");
  const input = resolve(cwd, path);
  try {
    const metadata = lstatSync(input);
    if (metadata.isSymbolicLink()) throw new Error("Host file final symlink is not allowed");
    return { input, canonical: realpathSync(input), exists: true };
  } catch (error) {
    if (error instanceof Error && /final symlink/.test(error.message)) throw error;
    return { input, canonical: `${resolveExistingParent(input)}/${basename(input)}`, exists: false };
  }
}

function rootForCandidate(candidate: string, roots: readonly Root[]): Root | undefined {
  const matching = roots.filter((root) => pathContains(root.path, candidate));
  if (matching.length === 0) return undefined;
  const longest = Math.max(...matching.map((root) => root.path.length));
  const mostSpecific = matching.filter((root) => root.path.length === longest);
  if (new Set(mostSpecific.map((root) => root.mode)).size > 1) throw new Error("Host file path has conflicting root modes");
  return mostSpecific[0];
}

function resolveConfiguredRoot(path: string, mode: RootMode, implicit: boolean): Root {
  const candidate = normalizeRootPath(path);
  if (!candidate) throw new Error("Host root path is invalid");
  try {
    const metadata = statSync(candidate);
    if (!metadata.isDirectory()) throw new Error("Host root must be a directory");
    return { path: realpathSync(candidate), mode };
  } catch (error) {
    if (implicit && error instanceof Error && /ENOENT|no such file/i.test(error.message)) return { path: candidate, mode };
    throw error;
  }
}

function rootsFor(options: HostPolicyOptions): { readonly roots: readonly Root[]; readonly invalid: boolean } {
  const workspace = normalizeRootPath(options.workspaceRoot);
  if (!workspace) return { roots: [], invalid: true };
  const roots: Root[] = [];
  let invalid = false;
  try {
    roots.push(resolveConfiguredRoot(workspace, "rw", true));
  } catch {
    invalid = true;
  }
  if (!Array.isArray(options.hostRoots)) return { roots, invalid };
  for (const spec of options.hostRoots) {
    if (!isRecord(spec) || (spec.mode !== "ro" && spec.mode !== "rw") || !isString(spec.path)) {
      invalid = true;
      continue;
    }
    try {
      roots.push(resolveConfiguredRoot(spec.path, spec.mode, false));
    } catch {
      invalid = true;
    }
  }
  return { roots, invalid };
}

export function createHostPolicy(options: HostPolicyOptions = {}): HostPolicy {
  const normalizedRules = normalizeRules(options.allowedChannels);
  const { roots, invalid: invalidRoots } = rootsFor(options);
  const workspaceRoot = normalizeRootPath(options.workspaceRoot);
  const cwd = canonicalCwd(options.cwd, workspaceRoot);
  const policyRevision = String(options.policyRevision ?? "1");

  const checkChannel = (scope: ChannelScope): boolean => {
    if (!normalizedRules.valid || !scopeIsUsable(scope)) return false;
    return normalizedRules.rules.some((rule) => matchesRule(scope, rule));
  };

  const checkFile = (tool: "readFile" | "writeFile", path: string): void => {
    if (invalidRoots || roots.length === 0 || !workspaceRoot || cwd.length === 0) throw new Error("Host file roots are unavailable");
    const candidate = canonicalFileCandidate(path, cwd);
    const root = rootForCandidate(candidate.canonical, roots);
    if (!root) throw new Error("Host file path is outside configured roots");
    if (tool === "writeFile" && root.mode !== "rw") throw new Error("Host file root is read-only");
    if (tool === "readFile" && !candidate.exists) throw new Error("Host file does not exist");
    if (candidate.exists) {
      const metadata = statSync(candidate.input);
      if (!metadata.isFile()) throw new Error("Host file must be a regular file");
      if (tool === "readFile" && metadata.size > HOST_READ_LIMIT_BYTES) throw new Error(`Host file exceeds ${HOST_READ_LIMIT_BYTES}-byte read limit`);
    }
  };

  const classify = (scope: ChannelScope, toolName: string, input: unknown): HostPolicyDecision => {
    if (!checkChannel(scope)) throw new Error("Host channel is not allowed");

    if (toolName === "readFile" || toolName === "writeFile") {
      const path = directPathFromInput(input);
      if (!path) throw new Error("Host file path is required");
      checkFile(toolName, path);
      return { kind: "allow" };
    }

    const originalCommand = originalBytesForFingerprint(input);
    const fingerprint = makeFingerprint(scope, toolName, cwd, policyRevision, originalCommand);
    if (toolName !== "bash") {
      return {
        kind: "approve",
        fingerprint,
        riskTags: ["unknown-command"],
        summary: "Host tool requires approval; arguments and paths redacted; risks: unknown-command",
      };
    }

    const command = commandFromInput(input);
    if (command === undefined) {
      return {
        kind: "approve",
        fingerprint,
        riskTags: ["parser-unsupported"],
        summary: "Host bash syntax requires review; arguments and paths redacted; risks: parser-unsupported",
      };
    }

    const state: WalkState = { riskTags: new Set(), commands: [], commandCount: 0 };
    try {
      walkScript(parse(command), state);
    } catch {
      addTag(state, "parser-unsupported");
    }
    const riskTags = orderedRiskTags(state);
    if (riskTags.length === 0) return { kind: "allow" };
    return { kind: "approve", fingerprint, riskTags, summary: summaryFor(state, riskTags) };
  };

  return { checkChannel, checkFile, classify };
}

export const HOST_APPROVAL_TTL_MS = 60_000;

export interface HostApprovalRequest {
  readonly requestId?: string;
  readonly scope: ChannelScope;
  readonly toolName: string;
  readonly cwd: string;
  readonly policyRevision: string;
  readonly fingerprint: string;
  readonly riskTags: readonly string[];
  readonly summary: string;
  readonly notify?: (request: HostApprovalRecord) => void | Promise<void>;
}

export type HostApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "cancelled";

export interface HostApprovalRecord {
  readonly requestId: string;
  readonly scope: ChannelScope;
  readonly toolName: string;
  readonly cwd: string;
  readonly policyRevision: string;
  readonly fingerprint: string;
  readonly riskTags: readonly string[];
  readonly summary: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly status: HostApprovalStatus;
}

export interface HostApprovalAuditEvent {
  readonly event: "pending" | "approved" | "rejected" | "expired" | "cancelled" | "executed" | "notification-failed";
  readonly requestId: string;
  readonly scope: ChannelScope;
  readonly toolName: string;
  readonly cwd: string;
  readonly policyRevision: string;
  readonly fingerprint: string;
  readonly riskTags: readonly string[];
  readonly actor?: string;
  readonly durationMs?: number;
  readonly exitCode?: number;
  readonly signal?: string;
  readonly truncated?: boolean;
  readonly cancelled?: boolean;
}

export interface HostApprovalBroker {
  request(request: HostApprovalRequest, signal: AbortSignal): Promise<"approved" | "rejected" | "expired">;
  stop(): void;
  approve(requestId: string, fingerprint?: string, actor?: string): boolean;
  reject(requestId: string, fingerprint?: string, actor?: string): boolean;
  find(fingerprint: string): HostApprovalRecord | undefined;
  list(): readonly HostApprovalRecord[];
  recordExecution(
    request: HostApprovalRecord,
    metadata?: { durationMs?: number; exitCode?: number; signal?: string; truncated?: boolean; cancelled?: boolean },
  ): void;
}

export interface HostApprovalBrokerOptions {
  readonly audit?: (event: HostApprovalAuditEvent) => void;
}

type ApprovalWaiter = {
  readonly resolve: (result: "approved" | "rejected" | "expired") => void;
  readonly signal?: AbortSignal;
  readonly onAbort?: () => void;
};

type ApprovalEntry = {
  record: HostApprovalRecord;
  notify?: (request: HostApprovalRecord) => void | Promise<void>;
  timer: ReturnType<typeof setTimeout>;
  waiters: ApprovalWaiter[];
};

function approvalRecord(request: HostApprovalRequest, requestId: string, now: number, status: HostApprovalStatus): HostApprovalRecord {
  return {
    requestId,
    scope: { ...request.scope },
    toolName: request.toolName,
    cwd: request.cwd,
    policyRevision: request.policyRevision,
    fingerprint: request.fingerprint,
    riskTags: [...request.riskTags],
    summary: request.summary,
    createdAt: now,
    expiresAt: now + HOST_APPROVAL_TTL_MS,
    status,
  };
}

function auditEvent(
  record: HostApprovalRecord,
  event: HostApprovalAuditEvent["event"],
  extra: Omit<HostApprovalAuditEvent, keyof HostApprovalRecord | "event"> = {},
): HostApprovalAuditEvent {
  return {
    event,
    requestId: record.requestId,
    scope: record.scope,
    toolName: record.toolName,
    cwd: record.cwd,
    policyRevision: record.policyRevision,
    fingerprint: record.fingerprint,
    riskTags: record.riskTags,
    ...extra,
  };
}

export function createHostApprovalBroker(options: HostApprovalBrokerOptions = {}): HostApprovalBroker {
  const entries = new Map<string, ApprovalEntry>();
  let stopped = false;

  const emit = (event: HostApprovalAuditEvent): void => {
    try {
      options.audit?.(event);
    } catch {
      // Auditing must not change approval state or release a blocked call.
    }
  };

  const uniqueRequestId = (): string => {
    let requestId = randomUUID();
    while (entries.has(requestId)) requestId = randomUUID();
    return requestId;
  };

  const settleWaiters = (entry: ApprovalEntry, result: "approved" | "rejected" | "expired"): void => {
    for (const waiter of entry.waiters.splice(0)) {
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
      waiter.resolve(result);
    }
  };

  const expire = (entry: ApprovalEntry): void => {
    if (entry.record.status === "pending") {
      entry.record = { ...entry.record, status: "expired" };
      settleWaiters(entry, "expired");
      emit(auditEvent(entry.record, "expired", { durationMs: Date.now() - entry.record.createdAt }));
    }
    entries.delete(entry.record.requestId);
  };

  const finish = (entry: ApprovalEntry, status: Exclude<HostApprovalStatus, "pending" | "cancelled">, actor?: string): boolean => {
    if (entry.record.status !== "pending") return false;
    clearTimeout(entry.timer);
    entry.record = { ...entry.record, status };
    settleWaiters(entry, status === "approved" ? "approved" : status === "rejected" ? "rejected" : "expired");
    emit(auditEvent(entry.record, status, { actor, durationMs: Date.now() - entry.record.createdAt }));
    if (status !== "approved") entries.delete(entry.record.requestId);
    return true;
  };

  const waitFor = (entry: ApprovalEntry, signal: AbortSignal): Promise<"approved" | "rejected" | "expired"> => {
    if (entry.record.status === "approved") return Promise.resolve("approved");
    if (entry.record.status === "rejected" || entry.record.status === "cancelled") return Promise.resolve("rejected");
    if (entry.record.status === "expired") return Promise.resolve("expired");
    if (signal.aborted) {
      clearTimeout(entry.timer);
      entry.record = { ...entry.record, status: "cancelled" };
      entries.delete(entry.record.requestId);
      emit(auditEvent(entry.record, "cancelled", { durationMs: Date.now() - entry.record.createdAt, cancelled: true }));
      return Promise.resolve("rejected");
    }
    return new Promise((resolve) => {
      const waiter: ApprovalWaiter = { resolve, signal };
      const onAbort = (): void => {
        const index = entry.waiters.indexOf(waiter);
        if (index >= 0) entry.waiters.splice(index, 1);
        signal.removeEventListener("abort", onAbort);
        emit(auditEvent(entry.record, "cancelled", { durationMs: Date.now() - entry.record.createdAt, cancelled: true }));
        resolve("rejected");
      };
      (waiter as { onAbort?: () => void }).onAbort = onAbort;
      entry.waiters.push(waiter);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  };

  const request = (input: HostApprovalRequest, signal: AbortSignal): Promise<"approved" | "rejected" | "expired"> => {
    if (stopped) return Promise.resolve("rejected");
    const now = Date.now();
    for (const entry of entries.values()) {
      if (entry.record.expiresAt <= now) {
        expire(entry);
        continue;
      }
      if (entry.record.fingerprint !== input.fingerprint) continue;
      if (entry.record.status === "approved") return Promise.resolve("approved");
      if (entry.record.status === "pending") return waitFor(entry, signal);
    }

    const record = approvalRecord(input, uniqueRequestId(), now, "pending");
    const entry: ApprovalEntry = {
      record,
      notify: input.notify,
      timer: setTimeout(() => expire(entry), HOST_APPROVAL_TTL_MS),
      waiters: [],
    };
    entries.set(record.requestId, entry);
    emit(auditEvent(record, "pending"));
    if (input.notify) {
      Promise.resolve(input.notify(record)).catch(() => {
        emit(auditEvent(record, "notification-failed"));
      });
    }
    return waitFor(entry, signal);
  };

  const transition = (requestId: string, status: "approved" | "rejected", fingerprint?: string, actor?: string): boolean => {
    const entry = entries.get(requestId);
    if (!entry || entry.record.expiresAt <= Date.now()) {
      if (entry) expire(entry);
      return false;
    }
    if (fingerprint !== undefined && entry.record.fingerprint !== fingerprint) return false;
    return finish(entry, status, actor);
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    for (const entry of entries.values()) {
      clearTimeout(entry.timer);
      if (entry.record.status === "pending") {
        entry.record = { ...entry.record, status: "cancelled" };
        settleWaiters(entry, "rejected");
        emit(auditEvent(entry.record, "cancelled", { durationMs: Date.now() - entry.record.createdAt, cancelled: true }));
      }
    }
    entries.clear();
  };

  return {
    request,
    stop,
    approve: (requestId, fingerprint, actor) => transition(requestId, "approved", fingerprint, actor),
    find: (fingerprint) => [...entries.values()].find((entry) => entry.record.fingerprint === fingerprint)?.record,
    reject: (requestId, fingerprint, actor) => transition(requestId, "rejected", fingerprint, actor),
    list: () => [...entries.values()].filter((entry) => entry.record.status === "pending").map((entry) => entry.record),
    recordExecution(request, metadata) {
      emit(auditEvent(request, "executed", metadata));
    },
  };
}
