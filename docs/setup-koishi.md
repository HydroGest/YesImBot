# 自动接入 Koishi

`scripts/setup-koishi.mjs` 是 YesImBot dev 分支提供的跨平台安装脚本。它负责把 yesimbot 这个 monorepo 自动接入一个 Koishi 应用，包括安装依赖、构建插件和生成 Koishi 配置。

## 适用场景

- 从零创建一个 Koishi 应用并接入 yesimbot dev。
- 把已有的 Koishi 应用切换到本地 yesimbot workspace。
- 检查当前 Koishi 应用是否已经正确配置 yesimbot。

## 环境要求

- Node.js 18 或更高版本
- Git
- Yarn 4（建议通过 Corepack 提供）
- 首次运行需要联网，因为要拉取 yesimbot dev 分支和 npm 依赖

## 从零安装

在 yesimbot 仓库内执行：

```bash
yarn setup-koishi --create-app ../my-koishi
```

脚本会完成以下步骤：

1. 使用官方 `create-koishi@latest` 在 `../my-koishi` 创建新 Koishi 应用。
2. 确保当前 yesimbot 仓库位于 `dev` 分支。
3. 扫描 yesimbot 内的所有 Koishi 插件包。
4. 修改 Koishi 应用的 `package.json`，加入 yesimbot workspace 和依赖。
5. 执行 `yarn install`。
6. 修改 Koishi 应用的 `koishi.yml`，创建 `group:yesimbot`。
7. 构建 yesimbot 全部插件包。
8. 验证所有插件都能被 Koishi 解析。

创建完成后可以手动启动：

```bash
cd ../my-koishi
yarn dev
```

也可以让脚本直接启动：

```bash
yarn setup-koishi --create-app ../my-koishi --start
```

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
yarn setup-koishi
```

脚本会自动向上查找 Koishi 应用目录。如果 yesimbot 不在 Koishi 应用内，可以显式指定：

```bash
yarn setup-koishi --app ../koishi-app
```

## 参数说明

| 参数 | 说明 |
| --- | --- |
| `--app <dir>` | 指定已有 Koishi 应用目录 |
| `--create-app <dir>` | 自动创建新的 Koishi 应用 |
| `--check` | 只检查当前配置，不修改文件 |
| `--start` | 完成配置和构建后执行 `yarn dev` |
| `--repo <url>` | 指定 yesimbot git 地址；仅在没有 origin 时使用 |
| `--help` | 显示帮助 |

`--app` 和 `--create-app` 不能同时使用。

## 常用命令

```bash
# 检查当前 Koishi 应用是否已正确接入
yarn setup-koishi:check

# 接入已有应用
yarn setup-koishi --app ../koishi-app

# 创建新应用并直接启动
yarn setup-koishi --create-app ../new-koishi --start
```

## 生成的 Koishi 配置

脚本会在 `koishi.yml` 中写入类似内容：

```yaml
plugins:
  group:yesimbot:
    yesimbot: {}
    ~@yesimbot/koishi-plugin-provider-openai: {}
    ~@yesimbot/koishi-plugin-provider-anthropic: {}
    ~@yesimbot/koishi-plugin-provider-deepseek: {}
    ~@yesimbot/koishi-plugin-provider-google: {}
    ~yesimbot-mcp-client: {}
    ~yesimbot-memos-client: {}
    ~yesimbot-onebot-utils: {}
    ~yesimbot-schedule: {}
    ~yesimbot-search-service: {}
    ~yesimbot-skills: {}
    ~yesimbot-workspace: {}
```

规则如下：

- 主插件 `yesimbot` 默认启用。
- provider 和扩展插件默认以 `~` 禁用。
- 禁用项也需要正确的完整短名，例如 `yesimbot-skills`，不能写成 `skills`。
- 如果已有配置中已经存在同名插件，脚本不会重复添加。

## 运行前的配置

启动 Koishi 后，在控制台启用至少一个 provider，并填写 API Key：

1. 打开 Koishi 控制台。
2. 启用 `@yesimbot/koishi-plugin-provider-openai` 或其它 provider。
3. 填写 API Key 和模型列表。
4. 给 `yesimbot.chatModel` 选择一个模型。

## 安全行为

- 如果 yesimbot 仓库有未提交的修改，脚本会停止，避免覆盖用户工作。
- 分支更新只使用 `git merge --ff-only`，不会强制改写本地提交。
- `--create-app` 目标目录如果已经存在，脚本会停止，避免覆盖已有项目。

## 常见问题

### 提示 yesimbot 有未提交修改

先提交或暂存当前修改：

```bash
git -C external/yesimbot status
git -C external/yesimbot stash
```

再重新运行脚本。

### 提示找不到 Koishi 应用

显式传入应用目录：

```bash
yarn setup-koishi --app D:\path\to\koishi-app
```

### 不要使用 npm install

yesimbot 依赖 `workspace:^` 和 Yarn workspace 机制，请使用 `yarn install`。如果项目里存在旧的 `package-lock.json`，不要依赖它。

### Windows 上 Yarn 命令不可用

如果 PowerShell 阻止运行 `yarn.ps1`，可以使用 `yarn.cmd`，或启用 Corepack：

```powershell
corepack enable
```

### node-liblzma 编译失败

`node-liblzma` 来自 `just-bash`，只影响 `yesimbot-workspace` 插件的部分功能。默认该插件是禁用状态，不影响主插件运行。
