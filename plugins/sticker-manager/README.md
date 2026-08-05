# YesImBot 表情包管理

这个插件帮机器人收藏、分类和使用表情包。

- 群里有人发了好图，机器人可以收藏下来，之后聊天时主动使用。
- 管理员可以批量导入、重命名分类、删除和清理表情包。
- 默认所有频道共用同一个表情包库，也可以改成每个频道独立。

## 怎么启用

### 用 dev 仓库体验

如果你在用 dev 仓库的 `setup-koishi` 脚本，脚本会自动发现这个插件，不需要手动装依赖。

```bash
node scripts/setup-koishi.mjs --create-app ../my-koishi --start
```

启动后打开 Koishi 控制台，找到并启用 `yesimbot-sticker-manager`。

### 用已发布版本

在 Koishi 插件市场搜索 `yesimbot-sticker-manager`，安装并启用即可。

## 日常使用

机器人自己会用这些能力：

- 看到合适的图片时，自动收藏并分类。
- 聊天需要表情包时，自动从库里找一张发出来。
- 找不到分类时会告诉你，或问管理员先导入。

群友不需要记任何命令。

## 管理员常用命令

所有命令都以 `yesimbot.sticker.` 开头。

```text
yesimbot.sticker.list
```

查看当前有哪些分类。

```text
yesimbot.sticker.get 猫猫
```

从“猫猫”分类随机发一张。

```text
yesimbot.sticker.get 猫猫 3
```

发“猫猫”分类里的第 3 张。

```text
yesimbot.sticker.add 猫猫 D:\图片\cat.png
```

手动添加一张图片。

```text
yesimbot.sticker.import D:\表情包文件夹
```

批量导入：这个文件夹里的每个子文件夹会被当成一个分类。

其他管理命令：

```text
yesimbot.sticker.rename 旧分类 新分类
yesimbot.sticker.merge 分类A 分类B
yesimbot.sticker.move 表情包ID 新分类
yesimbot.sticker.delete 分类
yesimbot.sticker.cleanup
```

## 常用设置

一般只需要关心这两项：

- `scope`
  - `global`：所有频道共用一套表情包，默认值。
  - `channel`：每个频道各有一套表情包。
- `classificationModel`
  - 留空时使用机器人的默认聊天模型。
  - 如果默认模型不能看图，可以在这里指定一个支持图片的模型。

其他设置保持默认即可。

### 实验性 tag 模式（默认关闭）

`tagMode` 默认关闭，属于实验性功能。开启后：

- `sticker_steal` 收藏时会按分类自动打 tag。
- 新增 `sticker_tags` 工具，用于查询当前标签和数量。
- `sticker_send` 可传多个 `tags`，会从匹配最多标签的表情包中随机发送。
- `sticker_search` 支持按 `tags` 过滤。

开启方式：

```yaml
yesimbot-sticker-manager:
  tagMode: true
```

tag 模式只新增 `tags` 字段，不改动现有 `category` 字段；关闭后原有分类功能不受影响。

## 从旧版迁移

如果你之前用过 v3 的 `sticker-manager`，旧数据不会自动导入，需要手动迁移一次。

1. 先保留旧插件、旧数据库和旧表情包文件，不要急着删。
2. 启用新插件。
3. 在机器人频道里执行：

```text
yesimbot.sticker.migrate-v3
```

迁移完成后检查一下分类和数量。

旧版命令名已经改了，例如：

```text
旧: sticker.get 猫猫
新: yesimbot.sticker.get 猫猫
```

迁移不会删除旧数据。

注意：v3 的旧插件包名是 `yesimbot-extension-sticker-manager`，新插件包名是 `yesimbot-sticker-manager`。迁移完成后请从 `koishi.yml` 或 Koishi 控制台停用、移除旧插件条目，否则控制台仍会尝试加载旧插件配置并提示 `config failed to load`。

## 常见问题

### 切换了 `scope` 后表情包不见了

这是正常现象。`global` 和 `channel` 是两套可见范围，切换后旧数据会被隐藏，但不会删除。

需要恢复时执行：

```text
yesimbot.sticker.migrate
```

这条命令可以把隐藏范围的数据复制到当前范围。

### 表情包文件存在哪里

默认在 YesImBot 的：

```text
data/yesimbot/sticker-manager/files
```

不要手动改这个目录里的文件，统一用命令管理。

### 机器人在群里为什么不主动发表情包

先确认库里已经有表情包，并且机器人的模型能正常使用工具。你可以先手动执行 `yesimbot.sticker.get 分类` 测试能否发送。
