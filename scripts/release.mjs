#!/usr/bin/env node
// @ts-check
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const ROOT = resolve(import.meta.dirname, "..");

// 扫描工作区目录，收集所有可发布包
function scanPackages() {
  const workspaceDirs = ["core", "packages/*", "plugins/*", "providers/*"];
  const packages = [];

  for (const pattern of workspaceDirs) {
    if (pattern.endsWith("/*")) {
      const dir = join(ROOT, pattern.slice(0, -2));
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const pkgPath = join(dir, entry.name, "package.json");
        if (!existsSync(pkgPath)) continue;
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        if (pkg.private) continue;
        packages.push({
          name: pkg.name,
          version: pkg.version,
          path: join(pattern.slice(0, -2), entry.name, "package.json"),
          tagKey: entry.name,
        });
      }
    } else {
      const pkgPath = join(ROOT, pattern, "package.json");
      if (!existsSync(pkgPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.private) continue;
      packages.push({
        name: pkg.name,
        version: pkg.version,
        path: join(pattern, "package.json"),
        tagKey: pattern,
      });
    }
  }

  return packages;
}

// 简单的交互式选择
function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function printPackages(packages) {
  console.log("\n可发布的包：\n");
  packages.forEach((pkg, i) => {
    console.log(`  ${i + 1}. ${pkg.name.padEnd(45)} ${pkg.version}`);
  });
  console.log(`  ${packages.length + 1}. 全部同步发布`);
  console.log();
}

async function selectPackages(packages) {
  printPackages(packages);
  const input = await prompt("选择包（序号，多选用逗号分隔，回车取消）：");
  if (!input) return [];

  const indices = input
    .split(",")
    .map((s) => parseInt(s.trim(), 10) - 1)
    .filter((i) => !isNaN(i));

  // 选了"全部"
  if (indices.includes(packages.length)) return packages;

  return indices.filter((i) => i >= 0 && i < packages.length).map((i) => packages[i]);
}

function runBumpp(pkg, isBeta) {
  const prereleaseArgs = isBeta ? "--release prerelease --preid beta" : "";
  const tagTemplate = `${pkg.tagKey}@%s`;
  const commitTemplate = `release: ${pkg.tagKey}@%s`;
  const cmd = [
    "npx bumpp",
    pkg.path, // 直接指定 package.json 路径
    "-r",
    "false", // -r 是 --recursive 的短选项
    `--tag "${tagTemplate}"`,
    `--commit "${commitTemplate}"`,
    "--no-push", // 统一最后再 push，多包时避免多次触发 CI
    prereleaseArgs,
  ]
    .filter(Boolean)
    .join(" ");

  console.log(`\n→ ${pkg.name}`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

async function main() {
  const isBeta = process.argv.includes("--beta");
  const packages = scanPackages();

  if (packages.length === 0) {
    console.log("未找到可发布的包。");
    process.exit(0);
  }

  const selected = await selectPackages(packages);
  if (selected.length === 0) {
    console.log("已取消。");
    process.exit(0);
  }

  console.log(
    `\n将发布 ${selected.length} 个包${isBeta ? "（beta）" : ""}：`,
    selected.map((p) => p.name).join(", "),
  );
  const confirm = await prompt("确认？(y/N) ");
  if (confirm.toLowerCase() !== "y") {
    console.log("已取消。");
    process.exit(0);
  }

  for (const pkg of selected) {
    runBumpp(pkg, isBeta);
  }

  console.log("\n所有包 bump 完成。运行以下命令推送：");
  console.log("  git push --follow-tags");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
