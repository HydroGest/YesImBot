#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REPO = "https://github.com/YesWeAreBot/YesImBot.git";
const BRANCH = "dev";
const GROUP = "group:yesimbot";
const MIN_NODE_MAJOR = 18;
const MIN_YARN_MAJOR = 4;
const CREATE_KOISHI_VERSION = "6.4.0";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const yesimbotRoot = path.resolve(scriptDir, "..");
const yesimbotMeta = JSON.parse(fs.readFileSync(path.join(yesimbotRoot, "package.json"), "utf8"));
const stateFile = path.join(yesimbotRoot, ".koishi-app-path");

const parsed = parseArgs();
if (!parsed.help) {
  ensureNode();
  ensureGit();
  ensureYarn({ prepare: !parsed.check });
}
const appRoot = resolveAppRoot();
const requireApp = createRequire(path.join(appRoot, "package.json"));

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { app: null, createApp: null, repo: DEFAULT_REPO, check: false, pull: false, start: false, help: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--check") {
      options.check = true;
    } else if (arg === "--pull") {
      options.pull = true;
    } else if (arg === "--start") {
      options.start = true;
    } else if (arg === "--help") {
      options.help = true;
    } else if (arg === "--app") {
      options.app = path.resolve(process.cwd(), args[++index] || process.cwd());
    } else if (arg === "--create-app") {
      options.createApp = args[++index] || null;
    } else if (arg === "--repo") {
      options.repo = args[++index] || DEFAULT_REPO;
    }
  }

  return options;
}

function looksLikeKoishiApp(directory) {
  return fs.existsSync(path.join(directory, "package.json")) && fs.existsSync(path.join(directory, "koishi.yml"));
}

function savedAppRoot() {
  if (!fs.existsSync(stateFile)) return null;
  const saved = fs.readFileSync(stateFile, "utf8").trim();
  return saved && looksLikeKoishiApp(saved) ? saved : null;
}

function resolveAppRoot() {
  if (parsed.createApp) {
    if (parsed.app) {
      fail("use either --app or --create-app, not both");
    }

    const directory = path.resolve(process.cwd(), parsed.createApp);
    if (fs.existsSync(directory)) {
      if (looksLikeKoishiApp(directory)) {
        log(`reusing existing Koishi app at ${directory}`);
        return directory;
      }
      fail(`${directory} already exists but is not a Koishi app; choose a new directory or use --app`);
    }

    createKoishiApp(directory);
    return directory;
  }

  if (parsed.app) {
    if (!looksLikeKoishiApp(parsed.app)) {
      fail(`${parsed.app} does not look like a Koishi app (missing package.json or koishi.yml)`);
    }
    return parsed.app;
  }

  if (looksLikeKoishiApp(process.cwd())) return process.cwd();
  const saved = savedAppRoot();
  if (saved) return saved;

  let current = yesimbotRoot;
  while (true) {
    const parent = path.dirname(current);
    if (parent === current) break;
    if (looksLikeKoishiApp(parent)) return parent;
    current = parent;
  }

  fail("cannot find a Koishi app; pass --app <directory>");
}

function log(message) {
  console.log(`[yesimbot-setup] ${message}`);
}

function fail(message) {
  console.error(`[yesimbot-setup] ${message}`);
  process.exit(1);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd || appRoot,
    env: process.env,
    encoding: "utf8",
    shell: options.shell ?? false,
    stdio: options.quiet ? "pipe" : "inherit",
  });

  if (result.error) {
    result.errorMessage = `${command} ${commandArgs.join(" ")} failed: ${result.error.message}`;
  } else if (result.status !== 0) {
    result.errorMessage = `${command} ${commandArgs.join(" ")} exited with ${result.status}`;
  }

  return result;
}

function runChecked(command, commandArgs, options = {}) {
  const result = run(command, commandArgs, { ...options, quiet: true });
  if (result.errorMessage) {
    const detail = result.stderr?.trim() || result.error?.message || "";
    throw new Error(`${result.errorMessage}\n${detail}`);
  }
  return result.stdout?.trim() || "";
}

function shellQuoted(commandArgs) {
  if (process.platform !== "win32") return commandArgs;
  return commandArgs.map((arg) => `"${arg.replace(/"/g, '\\"')}"`);
}

function runYarn(commandArgs, options = {}) {
  const useShell = process.platform === "win32";
  const candidates = [
    ["yarn", commandArgs, useShell],
    ["corepack", ["yarn", ...commandArgs], useShell],
  ];

  let lastError;
  for (const [command, args, shell] of candidates) {
    const result = run(command, shellQuoted(args), { ...options, shell });
    if (!result.errorMessage) return result;
    lastError = result.errorMessage;
  }

  throw new Error(`Unable to run Yarn: ${lastError}`);
}

function runNpx(commandArgs, options = {}) {
  const useShell = process.platform === "win32";
  const args = ["--yes", ...commandArgs];
  const result = run("npx", shellQuoted(args), { ...options, shell: useShell });
  if (result.errorMessage) {
    throw new Error(`${result.errorMessage}\n${result.stderr?.trim() || ""}`);
  }
  return result;
}

function commandOutput(command, commandArgs = ["--version"], options = {}) {
  const result = run(command, commandArgs, { ...options, cwd: options.cwd || yesimbotRoot, quiet: true });
  return result.errorMessage ? "" : result.stdout?.trim() || "";
}

function ensureNode() {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (major < MIN_NODE_MAJOR) {
    fail(`Node.js ${MIN_NODE_MAJOR}+ is required, found ${process.versions.node}`);
  }
  log(`Node.js ${process.versions.node} is available`);
}

function ensureGit() {
  const version = commandOutput("git");
  if (version) {
    log(`Git ${version} is available`);
    return;
  }
  if (parsed.pull) {
    fail("Git is required for --pull; install Git and add it to PATH");
  }
  log("Git is not available; continuing because --pull is not requested");
}

function yarnVersion() {
  try {
    return runYarn(["--version"], { quiet: true, cwd: yesimbotRoot }).stdout?.trim() || "";
  } catch {
    return "";
  }
}

function ensureYarn(options = {}) {
  const version = yarnVersion();
  if (version.startsWith(`${MIN_YARN_MAJOR}.`)) {
    log(`Yarn ${version} is available`);
    return;
  }

  const corepackVersion = commandOutput("corepack", ["--version"], { shell: process.platform === "win32" });
  if (!corepackVersion) {
    fail(`Yarn ${MIN_YARN_MAJOR} is required; install Yarn or enable Corepack`);
  }
  if (!options.prepare) {
    fail(`Yarn ${MIN_YARN_MAJOR} is required; enable Corepack and run this script again`);
  }

  log("enabling Yarn through Corepack");
  runChecked("corepack", ["enable", "--yes"], { cwd: yesimbotRoot, shell: process.platform === "win32" });

  const enabledVersion = yarnVersion();
  if (!enabledVersion.startsWith(`${MIN_YARN_MAJOR}.`)) {
    fail(`Corepack is available but Yarn ${MIN_YARN_MAJOR} is still unavailable`);
  }
  log(`Yarn ${enabledVersion} is available through Corepack`);
}

function installStatePath(directory) {
  return path.join(directory, "node_modules", ".koishi-install-state");
}

function installFingerprint(directory, extra = "") {
  const manifest = fs.readFileSync(path.join(directory, "package.json"), "utf8");
  const lockPath = path.join(directory, "yarn.lock");
  const lock = fs.existsSync(lockPath) ? fs.readFileSync(lockPath, "utf8") : "";
  return createHash("sha256").update(`${extra}\n${manifest}\n${lock}`).digest("hex");
}

function dependenciesReady(directory, extra = "") {
  if (!fs.existsSync(path.join(directory, "node_modules")) || !fs.existsSync(path.join(directory, "yarn.lock"))) {
    return false;
  }
  try {
    return fs.readFileSync(installStatePath(directory), "utf8") === installFingerprint(directory, extra);
  } catch {
    return false;
  }
}

function runInstallIfMissing(directory, label, options = {}) {
  const extra = options.extraFingerprint ?? "";
  if (!options.force && dependenciesReady(directory, extra)) {
    log(`skipping ${label} dependency install (already present)`);
    return;
  }
  log(`installing ${label} dependencies`);
  runYarn(["install"], { cwd: directory });
  fs.mkdirSync(path.join(directory, "node_modules"), { recursive: true });
  fs.writeFileSync(installStatePath(directory), installFingerprint(directory, extra));
}

function ensureAppYarnConfig(directory) {
  const file = path.join(directory, ".yarnrc.yml");
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (existing.includes("supportedArchitectures:")) return;
  const block = [
    "supportedArchitectures:",
    "  os:",
    "    - current",
    "  cpu:",
    "    - current",
  ].join("\n");
  fs.writeFileSync(file, `${existing.trimEnd() ? `${existing.trimEnd()}\n\n` : ""}${block}\n`);
}

function createKoishiApp(directory) {
  const name = path.basename(directory);
  const parent = path.dirname(directory);

  log(`creating Koishi app at ${directory}`);
  runNpx([`create-koishi@${CREATE_KOISHI_VERSION}`, name, "--yes"], { cwd: parent });

  if (!looksLikeKoishiApp(directory)) {
    fail(`create-koishi finished but ${directory} is missing package.json or koishi.yml`);
  }
}

function ensureDevBranch() {
  const dirty = run("git", ["-C", yesimbotRoot, "status", "--porcelain"], { quiet: true });
  if (dirty.errorMessage || dirty.stdout.trim()) {
    fail(`${yesimbotRoot} has uncommitted changes; commit or stash them before using --pull`);
  }

  const remote = run("git", ["-C", yesimbotRoot, "remote", "get-url", "origin"], { quiet: true });
  if (remote.errorMessage) {
    runChecked("git", ["-C", yesimbotRoot, "remote", "add", "origin", parsed.repo]);
  }

  log(`updating yesimbot to ${BRANCH}`);
  runChecked("git", ["-C", yesimbotRoot, "fetch", "origin", BRANCH]);

  const current = run("git", ["-C", yesimbotRoot, "rev-parse", "--abbrev-ref", "HEAD"], { quiet: true });
  const local = run("git", ["-C", yesimbotRoot, "rev-parse", "--verify", "--quiet", BRANCH], { quiet: true });

  if (current.stdout.trim() === BRANCH) {
    runChecked("git", ["-C", yesimbotRoot, "merge", "--ff-only", `origin/${BRANCH}`]);
  } else if (local.status === 0) {
    runChecked("git", ["-C", yesimbotRoot, "checkout", BRANCH]);
    runChecked("git", ["-C", yesimbotRoot, "merge", "--ff-only", `origin/${BRANCH}`]);
  } else {
    runChecked("git", ["-C", yesimbotRoot, "checkout", "-b", BRANCH, `origin/${BRANCH}`]);
  }
}

function saveAppPath() {
  fs.writeFileSync(stateFile, `${appRoot}\n`);
}

function collectPluginPackages() {
  const files = [];

  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if ([".git", ".yarn", "node_modules", "dist", "references"].includes(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name === "package.json") {
        files.push(fullPath);
      }
    }
  }

  walk(yesimbotRoot);

  const plugins = [];
  for (const file of files) {
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    if (meta.name && isPluginName(meta.name)) {
      plugins.push(meta);
    }
  }

  if (!plugins.length) {
    fail("no Koishi plugin packages found in this yesimbot repository");
  }

  return plugins.sort((left, right) => left.name.localeCompare(right.name));
}

function isPluginName(name) {
  return /^@koishijs\/plugin-[0-9a-z-]+$/.test(name) || /(^|\/)koishi-plugin-[0-9a-z-]+$/.test(name);
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function isManagedPluginName(name) {
  return name === "koishi-plugin-yesimbot" || name.startsWith("koishi-plugin-yesimbot-") || /^@yesimbot\/koishi-plugin-provider-/.test(name);
}

function configKeyToPackageName(key) {
  if (key === "yesimbot") return "koishi-plugin-yesimbot";
  if (key.startsWith("@yesimbot/provider-")) {
    return `@yesimbot/koishi-plugin-provider-${key.slice("@yesimbot/provider-".length)}`;
  }
  if (key.startsWith("yesimbot-")) return `koishi-plugin-${key}`;
  return null;
}

function belongsToYesImBotRoot(name) {
  let resolved;
  try {
    resolved = requireApp.resolve(`${name}/package.json`);
  } catch {
    const relativePath = packagePathInYesImBot(name);
    return !!relativePath && fs.existsSync(path.join(yesimbotRoot, relativePath));
  }

  const relative = path.relative(yesimbotRoot, resolved);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function packagePathInYesImBot(name) {
  if (name === "koishi-plugin-yesimbot") return "core";
  if (name.startsWith("@yesimbot/koishi-plugin-provider-")) {
    return `providers/${name.slice("@yesimbot/koishi-plugin-provider-".length)}`;
  }
  if (name.startsWith("koishi-plugin-yesimbot-")) {
    return `plugins/${name.slice("koishi-plugin-yesimbot-".length)}`;
  }
  if (name.startsWith("koishi-plugin-")) {
    return `plugins/${name.slice("koishi-plugin-".length)}`;
  }
  return null;
}

function updateManifest(plugins) {
  const file = path.join(appRoot, "package.json");
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  const repoPath = toPosix(path.relative(appRoot, yesimbotRoot));
  const requiredWorkspaces = [
    "external/*",
    "external/*/external/*",
    "external/*/packages/*",
    "external/*/plugins/*",
    repoPath,
    `${repoPath}/core`,
    `${repoPath}/packages/*`,
    `${repoPath}/providers/*`,
    `${repoPath}/plugins/*`,
  ];

  pkg.workspaces ||= [];
  for (const pattern of requiredWorkspaces) {
    if (!pkg.workspaces.includes(pattern)) pkg.workspaces.push(pattern);
  }

  pkg.dependencies ||= {};
  const currentNames = new Set(plugins.map((plugin) => plugin.name));
  for (const name of Object.keys(pkg.dependencies)) {
    if (isManagedPluginName(name) && !currentNames.has(name) && belongsToYesImBotRoot(name)) {
      delete pkg.dependencies[name];
      log(`removed stale dependency ${name}`);
    }
  }
  for (const plugin of plugins) {
    pkg.dependencies[plugin.name] = "workspace:^";
  }

  pkg.dependencies = Object.fromEntries(Object.entries(pkg.dependencies).sort(([left], [right]) => left.localeCompare(right)));

  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}

function loadYaml() {
  try {
    return requireApp("js-yaml");
  } catch {
    throw new Error("js-yaml is unavailable; run yarn install before updating koishi.yml");
  }
}

function configKey(name) {
  if (name.startsWith("@")) {
    const slash = name.indexOf("/");
    if (slash >= 0) {
      const rest = name.slice(slash + 1);
      if (rest.startsWith("koishi-plugin-")) {
        return name.slice(0, slash + 1) + rest.slice("koishi-plugin-".length);
      }
    }
    return name;
  }
  if (name.startsWith("koishi-plugin-")) return name.slice("koishi-plugin-".length);
  return name;
}

function updateKoishi(plugins) {
  const yaml = loadYaml();
  const file = path.join(appRoot, "koishi.yml");
  const config = fs.existsSync(file) ? yaml.load(fs.readFileSync(file, "utf8")) || {} : {};

  config.plugins ||= {};
  const group = config.plugins[GROUP] && typeof config.plugins[GROUP] === "object" ? config.plugins[GROUP] : {};

  const normalizedGroup = {};
  for (const [key, value] of Object.entries(group)) {
    const disabled = key.startsWith("~");
    const body = disabled ? key.slice(1) : key;
    const separator = body.indexOf(":");
    const base = separator >= 0 ? body.slice(0, separator) : body;
    const suffix = separator >= 0 ? body.slice(separator) : "";
    const normalized = `${disabled ? "~" : ""}${configKey(base)}${suffix}`;
    if (!(normalized in normalizedGroup)) normalizedGroup[normalized] = value;
  }

  const normalized = normalizedGroup;
  const hasEntry = (base) =>
    Object.keys(normalized).some((key) => {
      return key.replace(/^~/, "").split(":")[0] === base;
    });

  const currentKeys = new Set(plugins.map((plugin) => configKey(plugin.name)));
  for (const key of Object.keys(normalized)) {
    const base = key.replace(/^~/, "").split(":")[0];
    const packageName = configKeyToPackageName(base);
    if (packageName && !currentKeys.has(base) && belongsToYesImBotRoot(packageName)) {
      delete normalized[key];
      log(`removed stale plugin config ${key}`);
    }
  }

  for (const plugin of plugins) {
    const key = configKey(plugin.name);
    if (!key) continue;
    if (key === "yesimbot") {
      if (!hasEntry("yesimbot")) normalized.yesimbot = {};
    } else if (!hasEntry(key)) {
      normalized[`~${key}`] = {};
    }
  }

  config.plugins[GROUP] = normalized;
  fs.writeFileSync(file, yaml.dump(config, { lineWidth: -1, noRefs: true }));
}

function verify(plugins) {
  for (const plugin of plugins) {
    let target;
    try {
      target = requireApp.resolve(plugin.name);
    } catch {
      throw new Error(`cannot resolve ${plugin.name}; is the package built?`);
    }
    log(`ok ${plugin.name} -> ${path.relative(appRoot, target)}`);
  }
}

function runCheck(plugins) {
  const branch = run("git", ["-C", yesimbotRoot, "rev-parse", "--abbrev-ref", "HEAD"], { quiet: true });
  if (branch.errorMessage || branch.stdout.trim() !== BRANCH) {
    fail(`yesimbot is not on ${BRANCH}`);
  }

  verify(plugins);
  log(`yesimbot is on ${BRANCH}, app=${appRoot}, and all plugin packages resolve`);
}

function main() {
  if (parsed.help) {
    console.log(
      [
        "Usage: node scripts/setup-koishi.mjs [options]",
        "",
        "Options:",
        "  --app <dir>      target Koishi app directory (auto-detected when omitted)",
        "  --create-app <dir> create a Koishi app (reuses an existing valid app)",
        "  --check          verify the current setup without changing files",
        "  --pull           fetch and fast-forward yesimbot to origin/dev first",
        "  --start          run `yarn start` after setup",
        "  --repo <url>     git URL used when no origin remote exists",
      ].join("\n"),
    );
    return;
  }

  if (parsed.pull) {
    ensureDevBranch();
  } else {
    log("using local yesimbot repository without updating");
  }

  if (parsed.check) {
    log("checking setup");
    runCheck(collectPluginPackages());
    return;
  }

  saveAppPath();

  runInstallIfMissing(yesimbotRoot, "yesimbot workspace");
  const repoFingerprint = installFingerprint(yesimbotRoot);

  const plugins = collectPluginPackages();

  log(`configuring Koishi app at ${appRoot}`);
  const manifestBefore = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
  updateManifest(plugins);
  const manifestAfter = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
  const manifestChanged = JSON.stringify(manifestBefore) !== JSON.stringify(manifestAfter);

  ensureAppYarnConfig(appRoot);
  runInstallIfMissing(appRoot, "Koishi app", {
    force: manifestChanged,
    extraFingerprint: repoFingerprint,
  });

  log("updating koishi.yml");
  updateKoishi(plugins);

  log("building yesimbot packages");
  runYarn(["workspace", yesimbotMeta.name, "build"]);

  log("verifying plugin resolution");
  verify(plugins);

  if (parsed.start) {
    log("starting Koishi");
    runYarn(["start"]);
  } else {
    log("done; run `yarn dev` or `yarn start` in the Koishi app to launch it");
  }
}

main();
