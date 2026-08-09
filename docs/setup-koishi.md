# 自动接入 Koishi

`scripts/setup-koishi.mjs` 是 YesImBot dev 分支提供的跨平台安装脚本。它负责把 yesimbot 这个 monorepo 自动接入一个 Koishi 应用，包括检查运行环境、安装依赖、构建插件和生成 Koishi 配置。

## 适用场景

- 从零创建一个 Koishi 应用并接入 yesimbot dev。
- 把已有的 Koishi 应用切换到本地 yesimbot workspace。
- 检查当前 Koishi 应用是否已经正确配置 yesimbot。

## 环境要求

- Node.js 18 或更高版本（脚本会自动检查）
- Git（仅使用 `--pull` 时必须安装；本地 setup 不强制）
- Yarn 4（脚本检测到缺失或版本不符时，会尝试通过 Corepack 自动启用）
- 默认使用当前本地 yesimbot 源码，不自动拉取；需要同步远端 dev 时加 `--pull`
- 首次运行需要联网，因为要下载 create-koishi 和 npm 依赖

## 从零安装

在 yesimbot 仓库内执行：

```bash
node scripts/setup-koishi.mjs --create-app ../my-koishi
```

脚本会完成以下步骤：

1. 使用官方 `create-koishi@latest` 在 `../my-koishi` 创建新 Koishi 应用；如果目录已存在且是有效 Koishi 应用，则直接复用。
2. 自动检查 Node.js、Git 和 Yarn；Yarn 缺失时尝试通过 Corepack 自动启用。
3. 默认直接使用当前本地 yesimbot 源码；传入 `--pull` 时先同步到远端 `dev` 分支。
4. 把 Koishi 应用路径写入 yesimbot 的本地状态文件 `.koishi-app-path`。
5. 自动在 yesimbot 仓库内执行 `yarn install`，生成 `yarn.lock` 并安装依赖；`node_modules` 和 `yarn.lock` 已存在时跳过。
6. 扫描 yesimbot 内的所有 Koishi 插件包。
7. 修改 Koishi 应用的 `package.json`，加入 yesimbot workspace 和依赖。
8. 在 Koishi 应用内执行 `yarn install`；依赖已存在且 `package.json` 未变化时跳过。
9. 修改 Koishi 应用的 `koishi.yml`，创建 `group:yesimbot`。
10. 构建 yesimbot 全部插件包。
11. 验证所有插件都能被 Koishi 解析。

创建完成后可以手动启动：

```bash
cd ../my-koishi
yarn dev
```

也可以让脚本直接启动：

```bash
node scripts/setup-koishi.mjs --create-app ../my-koishi --start
```

首次运行请使用 `node scripts/setup-koishi.mjs`，这样脚本会先自动检查并补齐 yesimbot 仓库自身的环境与依赖。之后重复运行会复用 `.koishi-app-path`，并在依赖已经存在时跳过安装。

## 后续启动

setup 会把目标 Koishi 应用路径记录在 yesimbot 仓库内的 `.koishi-app-path` 中。setup 和启动脚本都会优先读取这个状态文件，因此之后可以从 yesimbot 仓库直接运行。该文件已加入 `.gitignore`，不会提交到仓库。

之后可以在 yesimbot 仓库内直接启动：

```bash
# 推荐：生产模式，动态配置可用
yarn koishi:start

# 仅在需要时使用开发模式
yarn koishi:dev
```

`yarn koishi:start` 会执行 `yarn start`。Koishi 的 `dev` 模式不会加载动态 schema，而 yesimbot 的模型配置依赖动态配置，所以默认推荐 `yarn start`。

如果状态文件丢失或需要临时指定其它应用：

```bash
node scripts/start-koishi.mjs --app ../my-koishi
```

也可以直接运行：

```bash
node scripts/start-koishi.mjs
```

需要开发模式时：

```bash
node scripts/start-koishi.mjs --dev
```

只查看脚本会启动哪个应用，不真正启动：

```bash
node scripts/start-koishi.mjs --check
```

脚本会按以下顺序查找 Koishi 应用：

1. `--app` 显式指定的目录。
2. `.koishi-app-path` 中记录的目录。
3. 当前工作目录。
4. 从 yesimbot 仓库向上查找包含 `koishi.yml` 和 `package.json` 的目录。

## 接入已有 Koishi 应用

如果 Koishi 应用已经存在，例如目录结构是：

```text
koishi-app/
  external/
    yesimbot/
  koishi.yml
  package.json
```

可以直接从 yesimbot 仓库执行：

```bash
node scripts/setup-koishi.mjs
```

脚本会优先复用 `.koishi-app-path` 中记录的目录，否则自动向上查找 Koishi 应用目录。如果 yesimbot 不在 Koishi 应用内，可以显式指定：

```bash
node scripts/setup-koishi.mjs --app ../koishi-app
```

## 参数说明

| 参数 | 说明 |
| --- | --- |
| `--app <dir>` | 指定已有 Koishi 应用目录 |
| `--create-app <dir>` | 创建新的 Koishi 应用；目录已存在且是有效 Koishi 应用时直接复用 |
| `--check` | 只检查当前配置，不修改文件；仍会检查 Node/Git/Yarn |
| `--pull` | 先 fetch 并 fast-forward 到远端 `dev`；此时要求 yesimbot 仓库无未提交修改 |
| `--start` | 完成配置和构建后执行 `yarn dev` |
| `--repo <url>` | 指定 yesimbot git 地址；仅在没有 origin 时使用 |
| `--help` | 显示帮助 |

`--app` 和 `--create-app` 不能同时使用。

## 常用命令

```bash
# 检查当前 Koishi 应用是否已正确接入
node scripts/setup-koishi.mjs --check

# 重复运行：复用已记录的应用，已存在的依赖会被跳过
node scripts/setup-koishi.mjs

# 接入已有应用
node scripts/setup-koishi.mjs --app ../koishi-app

# 先同步远端 dev 再接入
node scripts/setup-koishi.mjs --app ../koishi-app --pull

# 创建新应用并直接启动
node scripts/setup-koishi.mjs --create-app ../new-koishi --start
```

## 生成的 Koishi 配置

脚本会在 `koishi.yml` 中写入类似内容：

```yaml
plugins:
  group:yesimbot:
    yesimbot: {}
    ~@yesimbot/provider-openai: {}
    ~@yesimbot/provider-anthropic: {}
    ~@yesimbot/provider-deepseek: {}
    ~@yesimbot/provider-google: {}
    ~yesimbot-mcp-client: {}
    ~yesimbot-memos-client: {}
    ~yesimbot-onebot-utils: {}
    ~yesimbot-schedule: {}
    ~yesimbot-search-service: {}
    ~yesimbot-workspace: {}
```

规则如下：

- 主插件 `yesimbot` 默认启用。
- provider 和扩展插件默认以 `~` 禁用。
- 禁用项也需要使用 Koishi 可识别的短名，例如 `yesimbot-workspace` 或 `@yesimbot/provider-openai`，不能写成 `koishi-plugin-` 完整包名。
- 如果已有配置中已经存在同名插件，脚本不会重复添加。

## 运行前的配置

启动 Koishi 后，在控制台启用至少一个 provider，并填写 API Key：

1. 打开 Koishi 控制台。
2. 启用 `@yesimbot/koishi-plugin-provider-openai` 或其它 provider。
3. 填写 API Key 和模型列表。
4. 给 `yesimbot.chatModel` 选择一个模型。

## 安全行为

- 默认不修改 yesimbot 仓库的 git 状态，因此本地有未提交修改也可以运行。
- 使用 `--pull` 时才同步远端 `dev`，并且要求工作区干净；分支更新只使用 `git merge --ff-only`。
- `--create-app` 目标目录如果已经存在但不是有效 Koishi 应用，脚本会停止，避免覆盖已有项目；有效应用会被复用。

## 重复运行

- 已有 `.koishi-app-path` 且记录的应用仍有效时，不带 `--app` / `--create-app` 会直接复用该应用。
- `node_modules` 和 `yarn.lock` 已存在时跳过 `yarn install`；Koishi 应用 `package.json` 发生变化时仍会重新安装。
- 配置同步、构建和插件解析验证仍然会执行，确保接入状态与当前源码一致。

## 常见问题

### 提示 yesimbot 有未提交修改

只有使用 `--pull` 同步远端 `dev` 时才要求工作区干净。先提交或暂存当前修改：

```bash
git -C external/yesimbot status
git -C external/yesimbot stash
```

再重新运行 `--pull`。如果不想提交或暂存，直接运行不带 `--pull` 的 setup 即可。

### 提示找不到 Koishi 应用

显式传入应用目录：

```bash
node scripts/setup-koishi.mjs --app D:\path\to\koishi-app
```

### 不要使用 npm install

yesimbot 依赖 `workspace:^` 和 Yarn workspace 机制，请使用 `yarn install`。如果项目里存在旧的 `package-lock.json`，不要依赖它。

### Windows 上 Yarn 命令不可用

脚本会自动尝试 `corepack enable --yes` 来提供 Yarn。如果 PowerShell 仍阻止运行 `yarn.ps1`，可以使用 `yarn.cmd`，或手动启用 Corepack：

```powershell
corepack enable
```

### node-liblzma 编译失败

`node-liblzma` 来自 `just-bash`，只影响 `yesimbot-workspace` 插件的部分功能。默认该插件是禁用状态，不影响主插件运行。
