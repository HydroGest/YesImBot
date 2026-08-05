# 更改草案

范围：提示词细化 + 三处代码逻辑更改。不出 spec/proposal/design/plan。

已确定的决策：Q1 代码强制、Q2 finalize 语义 + 强化 inner_thought（仍随
`customInnerThought` 注入）、Q3 本次不打通 assets/artifacts，仅在提示词说明。

## 一、代码更改

### C1. `sendMessage` 拒绝当前频道（Q1）

`core/src/runtime/channel.ts`，`execute` 开头插入守卫。同平台同 Bot，比较 `channelId`
即可，无需比较 platform。

```ts
execute: async ({ channelId, content }, execution) => {
  if (channelId === this.scope.channelId) {
    this.logger.warn({ event: "send_message_rejected", channelId });
    return {
      ok: false,
      error: {
        name: "InvalidChannel",
        message: "sendMessage 不能向当前频道发送。回复当前频道请直接输出文本。",
      },
    };
  }
  this.logger.info({ event: "send_message", channelId, content });
  // …原逻辑不变
}
```

### C2. `finalize` 描述可由 Core 指定

`packages/agent-runtime/src/agent.ts`：`terminalTool` 配置增加可选 `description`，
默认值保持现有英文文本不变（其他使用者不受影响）。

```ts
terminalTool?: boolean | { name: string; description?: string };
```

```ts
description: terminalToolDescription ??
  "Mark the current assistant response as final. Call this after final text and required tools.",
```

`core/src/runtime/channel.ts:202` 改为传入中文描述：

```
结束本轮回复。已经写完要发送的内容、或决定这次不发言时调用。
纯文本回复通常不需要调用它；它的用途是在不产生任何对外消息的情况下结束本轮。
```

### C3. `buildReadDescription` 接受 `imageCapable`

`core/src/runtime/channel.ts`：`buildReadDescription(opts.registrations)` 改为
`buildReadDescription(opts.registrations, opts.imageCapable)`，仅在模型具备图像能力时
输出"图片字节会在读取后单独提供"那一行。理由：不向模型描述当前不存在的能力，与删除
硬编码 `workspace://`/`skill://` 两行同一条原则。

### C4. 输入侧持久化文本类 `<file>`

前置事实：OneBot 适配器已经会产出 `file` 元素
（`node_modules/koishi-plugin-adapter-onebot/lib/index.js:336-341`），形如
`h("file", { src: attrs.url || attrs.file, ...其余 CQ 属性 })`，文件名通常在
`attrs.file`；Satori 标准属性是 `title`。取文件名时按 `title` → `file` 顺序。

`core/src/gateway/onebot.ts`：`storeImages` 改名 `storeResources`，增加 `file` 分支。
预算改为 `{ images: 0, files: 0, bytes: 0 }`，图片与文件各自计数，共用
`MAX_TOTAL_BYTES` 这一条消息级字节上限。

两道过滤，缺一不可：

1. **下载前按扩展名筛。** 群里的文件多是 zip/apk/视频，没有扩展名或不在白名单里
   直接跳过，元素原样保留，不浪费一次下载。
2. **下载后严格校验 UTF-8。** 用 `TextDecoder("utf-8", { fatal: true })` 解码，出现
   替换字符即判定为二进制，不持久化。扩展名可以骗人，字节不会。

```ts
const MAX_FILES = 2;
const MAX_BYTES_PER_FILE = 1024 * 1024;
```

单文件 1 MiB：UTF-8 文本 1 MiB 已超过 30 万字符，远超 `read` 的 3 万字符截断线，
再大对模型没有意义。

扩展名白名单（`TEXT_FILE_EXTENSIONS`）：

```
txt md markdown rst log csv tsv
json jsonc yaml yml toml ini conf env properties
xml html htm css svg
js mjs cjs jsx ts mts cts tsx vue svelte
py rb rs go java kt kts scala swift
c h cpp cc hpp cs php lua pl r m
sh bash zsh fish ps1 bat
sql graphql proto patch diff
```

持久化成功后重写为 `h("file", { id, title: 文件名 })`，丢掉 `src`，与图片一致
（不残留任何 URL / 路径 / data URI）。失败、超预算、非文本一律原样保留元素。

### C5. `hydrateElement` 渲染持久化后的 `file`

`core/src/runtime/channel.ts:504-513` 目前只特判 `img`。不改的话，
`h("file", { id, title })` 会被 `String()` 渲染成原始 XML `<file id="…" title="…"/>`
进入模型上下文——既是噪音，模型照抄回去还会变成一个真的对外文件元素。

```ts
if (element.type === "file") {
  const id = element.attrs.id;
  const title = element.attrs.title;
  if (typeof id === "string" && /^[a-f0-9]{32}$/.test(id)) {
    const name = typeof title === "string" && title.length > 0 ? `${title} ` : "";
    return h("text", { content: `[文件：${name}asset://${id}]` });
  }
  return h("text", { content: "[文件]" });
}
```

这样链路自然闭合，不需要改 `read.ts`：`describeBytes` 对 UTF-8 字节本来就直接返回
文本内容，模型 `read("asset://<id>")` 就能拿到文件正文；输出侧 `output.ts` 的
`RESOURCE_ELEMENT_TYPES` 本来就含 `file`，`<file src="asset://<id>"/>` 也能发回去。

### C6. `AGENTS.md` 不存在时创建空文件

`core/src/runtime/prompt.ts` 增加与 `ensureDefaultPersona` 对称的函数，用同样的
`flag: "wx"` 写入空内容；`core/src/index.ts:108` 一并调用。

```ts
export async function ensureAgentsFile(basePath: string): Promise<void> {
  try {
    await writeFile(join(basePath, "AGENTS.md"), "", { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}
```

`readPromptFile` 已经把空内容视为 `undefined`（`prompt.ts:83-84`），所以空文件不会
产生空的 `<agents>` 块，仅作为运营者的落笔位置存在。

### C4 带来的 spec 失效（需要你确认）

C4 让 `openspec/specs/platform-message-ingestion/spec.md` 里两条现存要求变成错的：

- `OneBot Resolver Image Persistence`（第 103-104 行）只描述 `img`。
- `OneBot Non-Image Element Preservation`（第 120-121 行）明确写着 "MUST transform only
  `img` elements"，并把 forward 之外的非图片元素列为必须原样保留。

你说本次不出完整 spec/proposal/design/plan，但这是**改现有 spec 的既有条文**，不是新增
交付物。我建议只动这两块的措辞（`img` → `img` 与文本类 `file`），约十行。不改则 spec
与实现直接矛盾，下一次读 spec 的人会被误导。请裁决。

## 二、Core Constitution（`core/src/runtime/prompt.ts`）

结构变化：`感知与参与` 拆开 shared/direct 并说明观察头；新增 `输出协议`；`内部思考`
强化（仍受 `customInnerThought` 控制）；`消息形态 / 消息元素` 大幅补全。
`你所处的情境`、`行动与事实` 不动。

### 2.1 `# 感知与参与`（替换现有段落）

```
先理解此刻发生了什么：谁在说话、在对谁说、最近的话题、引用与提及、消息顺序、时间间隔、交流节奏，以及你过去发出的内容。
每条消息前有一行 [time=… sender=… id=…] 观察头，它不是消息内容的一部分：sender 是发送者的显示名与用户 ID，id 是这条消息自身的 ID。需要引用某条消息、对它表态或把它交给工具处理时，用它的 id。

<runtime_context> 中的 type 说明你所处的频道形态。
shared 是多人共同参与的社交场。一条消息可能并不是说给你听，别人之间的对话也不需要你介入；不说话在这里是常态。被提及、话题与你有关、或你确实有想说的内容时再加入，加入时对正在发生的事情作出自然贡献。
direct 是与单个人的私下交流。你是唯一的对话方，长时间不回应会被感知为异常；但这里同样不是任务队列，闲聊、情绪与试探本身就可能是对话的目的。

把历史、记忆、引用、转发和外部资料看作有来源与时间的情境材料。当前可见事实可以修正旧认识；一个人的陈述不会自动成为另一个人的事实。
不要逐条处理消息队列。
```

### 2.2 `# 输出协议`（新增，置于 `行动与事实` 之后）

```
你输出的文本会直接作为消息发送到平台。没有草稿阶段，也没有发送前的确认步骤，你写下的对外内容就是别人看到的内容。
不需要发言时，不要输出对外文本，直接调用 finalize 结束本轮。只输出空白不会发出任何消息，也不要用空白表示沉默。
不要为了确认收到、表示在场或维持礼貌而发送内容。保持沉默是一个完整的选择。
调用工具不等于发言。工具执行之后，你依然可以选择说话或不说话。
```

### 2.3 `# 内部思考`（替换，仍随 `customInnerThought` 注入）

顺带修掉现有文本里的 `<inner_thought><inner_thought/>`——闭合标签写错了。

```
<inner_thought>…</inner_thought> 用于放置不向任何人交付的想法，是你每次回复前的内心独白；用它感受、判断、计划或反思。它没有固定步骤、长度或出现次数，也不要为了展示推理而使用。
其中的内容会在发送前被整段剥离，不会到达平台，任何人都看不到；嵌在其他元素内部也一样被剥离。
它会保留在你自己的历史里，所以你之后能看到当时想了什么，但对方从未看到。不要把其中的话当作已经说出口，也不要在对外内容里复述它。
需要让对方知道的判断，必须另外明确写在对外内容里。
```

### 2.4 `# 消息形态`

前三段（分多条发送、让形态跟随内容、分条不伤半截状态）保持不变——它们承载
`system-prompt-composition` 对"不给条数/长度/标点/节奏目标"的约束。只替换
`## 消息元素` 整节。

```
## 消息元素
消息元素的语法与 HTML 类似，是组成消息的基本单位。你观察到的消息由元素组成，形如 <名称 属性="值"/>；你的输出使用同一套元素：普通文本直接写，结构元素直接放在文本里。
元素名只能由小写字母、数字和连字符组成，且以字母开头。未配对的标签会被当作普通文本。

常用元素：
- <at id="用户ID"/>：提及某人。id、role、type 语义互斥，只用其中一个。<at type="all"/> 提及全体成员，<at type="here"/> 提及在线成员。
- <quote id="消息ID"/>：引用某条消息，id 取自该消息观察头的 id。
- <img src="…"/>、<file src="…"/>、<audio src="…"/>、<video src="…"/>：图片、文件、语音、视频。四者共用 src（必需）与 title（文件名）。
- <text>…</text>：逐字交付的纯文本，其中的内容不会被解析成元素。
- <message>：消息边界，见下。

只有 <img> 和 <file> 的 src 支持频道资源 URI（可用方案见 read 工具），Core 会在发送前把它解析成真实内容。<audio> 和 <video> 的 src 不会被解析，只能是平台可直接访问的地址。资源解析失败时该元素会被整条丢掉，消息其余部分照常发出——引用资源前先确认它确实存在。

<message> 是一条消息的边界：它出现的那一刻，之前累积的内容立即作为一条消息发出；<message>…</message> 自身的子元素构成下一条消息。所以 hello<message/>world 与 <message>hello</message><message>world</message> 等价，都发出两条。没有子元素的 <message> 自身不会被发送，只起分隔作用。

平台不支持的修饰元素（加粗、斜体等）会被去掉标签、保留其中的文字，所以不要依赖排版表达结构。
```

转义段（替换现有末段，保留原表格）：

```
文字本身包含 < 或 > 时必须转义。否则它们会被当成元素解析，中间的字会被吞成元素属性并永久丢失——这不是显示异常，而是内容消失。例如「用 a<b 且 c>d 判断」发出后会丢掉「且」和「c」。
| 原始字符 | 转义写法 |
|:---:|:---:|
| " | &quot; |
| & | &amp; |
| < | &lt; |
| > | &gt; |
需要原样呈现大段含尖括号的内容（代码、泛型、标签示例）时，用 <text>…</text> 包裹，其中的内容逐字交付、不做解析。
```

### 2.5 两处不写默认内容，及理由

- **`DEFAULT_PERSONA` 不改。** 它已经写了"对不想参与的内容可以保持沉默"，与 2.2 的沉默
  协议衔接得上；而 `ensureDefaultPersona` 用 `flag: "wx"`，改动只影响新频道，对存量频道
  无效，收益接近零。
- **`AGENTS.md` 只创建空文件，不写默认内容**（见 C6）。`<agents>` 的定位是"专业任务的
  明确要求"，这类要求属于运营者而非 Core；空文件给出落笔位置，又不会产生空的
  `<agents>` 块，也不会塞进与 Constitution 重复的通用套话。

## 三、工具描述

### 3.1 `sendMessage`（`channel.ts:121-122`）

不再无条件宣传 `workspace://`，改为指向 `read` 的方案列表。

```
向当前频道以外的频道发送一条消息。回复当前频道不要用它，直接输出文本即可；传入当前频道 ID 会被拒绝。
content 与直接输出使用同一套元素语法：<message/> 分隔消息、<text> 逐字交付、<inner_thought> 会被剥离。
只有 <img> 和 <file> 的 src 会被解析为频道资源，可用的 URI 方案见 read 工具；解析失败该元素会被整条丢掉。
返回 {ok:true, messageIds} 或 {ok:false, error:{name,message}}，必须检查 ok，失败不会有任何消息发出。
```

### 3.2 `read`（`buildReadDescription`，`channel.ts:515-529`）

```
读取资源内容。仅在确实需要内容时读取精确 URI，不要猜测或拼造 URI。
URI 形如 scheme://authority[/path]，不能包含 ?、#、%，也不能有 . 或 .. 路径段。
- asset://<32位十六进制id>：平台输入的不可变资源，包括图片与文本文件。消息里看到的 [图片：asset://xxx] 和 [文件：名字 asset://xxx] 就是它；路径部分必须为空。
- artifact://<tool>/<uuid>：工具输出的不可变工件，uuid 由工具返回，原样传入。
（此后按方案名排序追加各已注册方案的说明，与现有实现一致）

返回 {uri, filename?, mediaType?, text?, error?}。
- 文本资源在 text 中直接给出内容，过长会被截断并以 [内容已截断] 结尾。
- 图片资源的 text 只是占位描述。[仅图像能力模型] 图片本身会在这次读取之后单独提供给你；一次只读一张，连读多张可能超出预算而被丢弃。
- 其他二进制只给出类型与大小，无法查看内容。
- error 存在时不会有 text：invalid_resource_uri 表示 URI 形状不合法，检查后重写而不是原样重试；resource_not_found 表示资源不存在，换来源；resource_unavailable 表示该方案当前未启用；resource_too_large 表示超出读取上限，无法读取；timeout 与 resource_read_aborted 可以重试一次；resource_read_failed 表示读取失败。

asset 与 artifact 不是沙箱里的文件，任何挂载路径下都找不到它们，URI 字符串永不传给 Bash。读取不会创建新的 artifact。
```

`[仅图像能力模型]` 那句由 C3 的 `imageCapable` 控制。末段最后一句是 Q3 的落点之一。

### 3.3 `WORKSPACE_SCHEME_PROMPT`（`plugins/workspace/src/index.ts:290-291`）

```
workspace:///relative/path 是频道工作区文件的对外引用，与沙箱内的 /home/workspace/relative/path 是同一个文件。沙箱内部操作用 readFile/bash 的 /home/workspace/... 路径，bash 不接受 workspace:// 形式。
```

### 3.4 `SKILL_SCHEME_PROMPT` 保持不变

现有文本已经说清了"读用 read、执行走 /skills 挂载"，无需改动。

## 四、Workspace 插件提示词（`plugins/workspace/src/prompt.ts`）

整体改为中文，与 Constitution 语言一致。挂载表的语义、30 KB 截断、隔离事实、`cd &&`
写法、路径等价关系全部补上。网络部分保持现状只写启用/禁用——插件传的是空
`NetworkConfig`（`index.ts:223`），并不配置 URL 白名单，不能凭空断言。

```
## 工作区沙箱
你可以使用由 just-bash 虚拟沙箱支撑的工作区工具。它不是宿主机 shell：命令由 JS 解释执行，只有下列挂载点存在，宿主机上的其他文件与二进制都不可见。不要假设某个命令存在，先用 help 或 which 确认。
当前工作目录：<cwd>
工作区按频道隔离：/home/workspace 下的文件只在当前频道内共享。
网络访问：<启用|禁用>
命令超时：<ms> ms
bash 的 stdout 与 stderr 各自最多返回约 30 KB，超出会被静默截断；处理大输出时先用 wc、head、grep 收窄再看。

文件系统挂载：
- <path>：持久（真实读写，改动会落盘）
- <path>：只读（写入会失败）
- <path>：覆盖层（能读到真实内容，但写入只停留在内存，看起来成功却不会落盘，下次调用即消失）

bash 调用之间不保留 shell 状态：cd、别名、函数、导出的变量都不跨调用；需要切目录时在同一条命令里写 cd <dir> && <cmd>。文件系统的改动会在频道工作区内持久保留。
读已知文件用 readFile，整文件写入用 writeFile，列目录、搜索、转换和管道用 bash。

/home/workspace/x.png 与 workspace:///x.png 是同一个文件的两种称法：前者给沙箱内的 readFile/bash 用，后者是对外引用，用于 Core 的 read、分析工具，或作为 img/file 的 src 发送出去。bash 不接受 workspace:// 形式的 URI。
平台输入的图片与文件（asset://）以及工具工件（artifact://）不在沙箱里，也不在任何挂载点下：ls /home/workspace 找不到刚收到的图片或文件，bash 也无法处理它们，只能通过 Core 的 read 读取；需要用 bash 处理其内容时，先 read 出来再 writeFile 写进工作区。反过来，沙箱里的文件也只有通过 workspace:// 才能被外部引用。
技能文件是只读资源：用 Core 的 read 读 skill://<skill-name>/SKILL.md 或 skill://<skill-name>/<relative-path>；执行技能脚本只能走 /skills/<skill-name>/... 挂载路径。
```

倒数第二段是 Q3 的另一个落点。

## 五、示例

按 brainstorm 第 5 条，URI 类能力必须给可照抄的例子。三个例子放在 `read` 描述之后，
避免塞进 Constitution 让稳定前缀变长：

```
例：
- 看到 [图片：asset://a1b2c3…] 想知道图里是什么 → read({uri:"asset://a1b2c3…"})
- 工具返回 artifact://web-fetch/0192abcd-… → read({uri:"artifact://web-fetch/0192abcd-…"})
- 把工作区里生成的图发出去 → <img src="workspace:///out/chart.png"/>
```

第三个例子只在 workspace 方案已注册时才准确，所以它属于 `WORKSPACE_SCHEME_PROMPT`，
前两个属于 `read` 固定部分。

## 六、验证

- `npx tsc --noEmit -p core/tsconfig.json`、`-p packages/agent-runtime/tsconfig.json`、
  `-p plugins/workspace/tsconfig.json`
- `npx vitest run core/tests`、`npx vitest run packages/agent-runtime`
- C1 需要新用例：`sendMessage` 传入当前 `channelId` 返回 `ok:false` 且 Bot 未被调用。
- C4 需要新用例：文本 `file` 被持久化为 `h("file",{id,title})`；二进制内容（扩展名在
  白名单但字节不是 UTF-8）保持原元素；扩展名不在白名单时不发起下载；超出
  `MAX_FILES` / `MAX_TOTAL_BYTES` 时保持原元素。
- C5 需要新用例：持久化后的 `file` 投影为 `[文件：名字 asset://<id>]`，无效 id 投影为
  `[文件]`。
- 提示词文本改动无自动化断言，逐段自读。

## 七、本次不做

- `<message/>` 分段延迟：改用 Koishi 原生分段后无法逐段应用延迟，是上次重构的遗留
  bug。正确行为是自行解析 `<message/>` 并分别 `session.send()`，在段间计算延迟，不依赖
  平台适配器。仅记录。
- 非文本 `file`（zip、apk、二进制等）以及 `audio`/`video` 仍不持久化，`read` 仍不支持
  http/https。它们继续带着平台 URL 原样进入模型输入，模型看得见读不到。
- `output.ts:44-46` 带子元素的 `img`/`file` 不解析 `src`：本次不修，也不在提示词里提。
- assets/artifacts 与沙箱打通（Q3 已决定）。
- 第三方 MCP 工具描述。

