#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REPO = "https://github.com/YesWeAreBot/YesImBot.git";
const BRANCH = "dev";
const GROUP = "group:yesimbot";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const yesimbotRoot = path.resolve(scriptDir, "..");
const yesimbotMeta = JSON.parse(
  fs.readFileSync(path.join(yesimbotRoot, "package.json"), "utf8"),
);

const parsed = parseArgs();
const appRoot = resolveAppRoot();
const requireApp = createRequire(path.join(appRoot, "package.json"));

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    app: null,
    createApp: null,
    repo: DEFAULT_REPO,
    check: false,
    start: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--check") {
      options.check = true;
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
  return fs.existsSync(path.join(directory, "package.json"))
    && fs.existsSync(path.join(directory, "koishi.yml"));
}

function resolveAppRoot() {
  if (parsed.createApp) {
    if (parsed.app) {
      fail("use either --app or --create-app, not both");
    }

    const directory = path.resolve(process.cwd(), parsed.createApp);
    if (fs.existsSync(directory)) {
      fail(`${directory} already exists; choose a new directory or use --app for an existing app`);
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

function createKoishiApp(directory) {
  const name = path.basename(directory);
  const parent = path.dirname(directory);

  log(`creating Koishi app at ${directory}`);
  runNpx(["create-koishi@latest", name, "--yes"], { cwd: parent });

  if (!looksLikeKoishiApp(directory)) {
    fail(`create-koishi finished but ${directory} is missing package.json or koishi.yml`);
  }
}

function ensureDevBranch() {
  const dirty = run("git", ["-C", yesimbotRoot, "status", "--porcelain"], { quiet: true });
  if (dirty.errorMessage || dirty.stdout.trim()) {
    fail(`${yesimbotRoot} has uncommitted changes; commit or stash them before running setup`);
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
  return /^@koishijs\/plugin-[0-9a-z-]+$/.test(name)
    || /(^|\/)koishi-plugin-[0-9a-z-]+$/.test(name);
}

function toPosix(value) {
  return value.split(path.sep).join("/");
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
  for (const plugin of plugins) {
    pkg.dependencies[plugin.name] = "workspace:^";
  }

  pkg.dependencies = Object.fromEntries(
    Object.entries(pkg.dependencies).sort(([left], [right]) => left.localeCompare(right)),
  );

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
  if (name.startsWith("@")) return name;
  if (name.startsWith("koishi-plugin-")) return name.slice("koishi-plugin-".length);
  return name;
}

function updateKoishi(plugins) {
  const yaml = loadYaml();
  const file = path.join(appRoot, "koishi.yml");
  const config = fs.existsSync(file)
    ? (yaml.load(fs.readFileSync(file, "utf8")) || {})
    : {};

  config.plugins ||= {};
  const group = config.plugins[GROUP] && typeof config.plugins[GROUP] === "object"
    ? config.plugins[GROUP]
    : {};

  const hasEntry = (base) => Object.keys(group).some((key) => {
    return key.replace(/^~/, "").split(":")[0] === base;
  });

  for (const plugin of plugins) {
    const key = configKey(plugin.name);
    if (!key) continue;
    if (key === "yesimbot") {
      if (!hasEntry("yesimbot")) group.yesimbot = {};
    } else if (!hasEntry(key)) {
      group[`~${key}`] = {};
    }
  }

  config.plugins[GROUP] = group;
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
    console.log([
      "Usage: node scripts/setup-koishi.mjs [options]",
      "",
      "Options:",
      "  --app <dir>      target Koishi app directory (auto-detected when omitted)",
      "  --create-app <dir> create a new Koishi app before setup",
      "  --check          verify the current setup without changing files",
      "  --start          run `yarn dev` after setup",
      "  --repo <url>     git URL used when no origin remote exists",
    ].join("\n"));
    return;
  }

  if (parsed.check) {
    log("checking setup");
    runCheck(collectPluginPackages());
    return;
  }

  ensureDevBranch();

  log("installing yesimbot workspace dependencies");
  runYarn(["install"], { cwd: yesimbotRoot });

  const plugins = collectPluginPackages();

  log(`configuring Koishi app at ${appRoot}`);
  updateManifest(plugins);

  log("installing workspace dependencies with Yarn");
  runYarn(["install"]);

  log("updating koishi.yml");
  updateKoishi(plugins);

  log("building yesimbot packages");
  runYarn(["workspace", yesimbotMeta.name, "build"]);

  log("verifying plugin resolution");
  verify(plugins);

  if (parsed.start) {
    log("starting Koishi");
    runYarn(["dev"]);
  } else {
    log("done; run `yarn dev` or `yarn start` in the Koishi app to launch it");
  }
}

main();
