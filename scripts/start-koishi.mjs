#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const yesimbotRoot = path.resolve(scriptDir, "..");
const stateFile = path.join(yesimbotRoot, ".koishi-app-path");

const parsed = parseArgs();

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { app: null, dev: false, prod: false, check: false, help: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--prod") {
      options.dev = false;
      options.prod = true;
    } else if (arg === "--dev") {
      options.dev = true;
      options.prod = false;
    } else if (arg === "--check") {
      options.check = true;
    } else if (arg === "--help") {
      options.help = true;
    } else if (arg === "--app") {
      options.app = path.resolve(process.cwd(), args[++index] || process.cwd());
    }
  }

  return options;
}

function looksLikeKoishiApp(directory) {
  return fs.existsSync(path.join(directory, "package.json")) && fs.existsSync(path.join(directory, "koishi.yml"));
}

function resolveAppRoot() {
  if (parsed.app) {
    if (!looksLikeKoishiApp(parsed.app)) {
      fail(`${parsed.app} does not look like a Koishi app`);
    }
    return parsed.app;
  }

  if (fs.existsSync(stateFile)) {
    const saved = fs.readFileSync(stateFile, "utf8").trim();
    if (saved && looksLikeKoishiApp(saved)) return saved;
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
  console.log(`[yesimbot-start] ${message}`);
}

function fail(message) {
  console.error(`[yesimbot-start] ${message}`);
  process.exit(1);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd || process.cwd(),
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

function main() {
  if (parsed.help) {
    console.log(
      [
        "Usage: node scripts/start-koishi.mjs [options]",
        "",
        "Options:",
        "  --app <dir>      target Koishi app directory",
        "  --check          verify the target app without starting it",
        "  --dev            run `yarn dev` instead of the default `yarn start`",
      ].join("\n"),
    );
    return;
  }

  const appRoot = resolveAppRoot();
  if (parsed.check) {
    log(`Koishi app: ${appRoot}`);
    return;
  }

  const command = parsed.dev ? "dev" : "start";
  log(`starting Koishi (${command}) at ${appRoot}`);
  runYarn([command], { cwd: appRoot });
}

main();
