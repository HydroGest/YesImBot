import { jsonSchema, type AgentTool } from "@yesimbot/agent-runtime";
import { generateText, type LanguageModel } from "ai";
import { h, type Bot, type Element } from "koishi";

import type { PacingConfig } from "../config.js";
import { parseReply } from "../messages/index.js";
import { prepareOutputSegments, ResourceReadError, type ChannelResources } from "../resources/index.js";

const READ_MAX_TEXT_CHARS = 30_000;

type ResourceReadInput = { uri: string };

type ResourceReadResult = { uri: string; filename?: string; mediaType?: string; text?: string; error?: string };

type DescribeImageInput = { uri: string; question: string };

type DescribeImageOutput = { text: string } | { error: string };

type SendMessageMode = "element" | "raw";

type SendMessageInput = {
  messages: string[];
  channel?: string;
  mode?: SendMessageMode;
  continue?: boolean;
  inner_thought?: string;
};

type SendMessageOutput =
  | { ok: true; messageIds: string[]; count: number }
  | { ok: false; error: { name: string; message: string }; sent: string[]; failedAt: number };

type FinishInput = { reason: string };

type FinishOutput = { ok: true };

/** Facts about one delivered platform message, reported so the owner can announce it. */
export interface DeliveredNotice {
  readonly channelId: string;
  readonly messageId: string;
  readonly turnId: string;
  readonly text: string;
}

/** Facts about an aborted send. The model learns from the tool result; this is for operators. */
export interface SendFailedNotice {
  readonly channelId: string;
  readonly turnId: string;
  readonly failedAt: number;
  readonly total: number;
  readonly error: { readonly name: string; readonly message: string };
}

export interface SendMessageToolOptions {
  readonly bot: Bot;
  /** Channel used when the model omits `channel`. */
  readonly channelId: string;
  readonly resources: ChannelResources;
  readonly pacing: PacingConfig;
  /** Exposes the `inner_thought` field so monologue never has to be written as visible text. */
  readonly innerThought: boolean;
  readonly onDelivered?: (notice: DeliveredNotice) => void;
  readonly onFailed?: (notice: SendFailedNotice) => void;
}

/**
 * The only path from the model to a platform. Plain text output is never delivered, so a turn stays
 * silent until this tool runs. Ends the turn unless the model asks to `continue`.
 */
export function createSendMessageTool(options: SendMessageToolOptions): AgentTool<SendMessageInput, SendMessageOutput> {
  const { bot, channelId: defaultChannelId, resources, pacing, innerThought, onDelivered, onFailed } = options;
  return {
    name: "send_message",
    terminal: (input) => !input.continue,
    description: sendMessageDescription(innerThought),
    inputSchema: jsonSchema<SendMessageInput>({
      type: "object",
      properties: {
        ...(innerThought ? { inner_thought: { type: "string", description: "本次发送前的内心独白；只保留在你自己的历史里，不会发送给任何人" } } : {}),
        mode: { type: "string", enum: ["element", "raw"], description: "element（默认）解析消息元素；raw 原样发送纯文本" },
        channel: { type: "string", minLength: 1, description: "目标频道 ID；留空则发往当前频道" },
        messages: {
          type: "array",
          minItems: 1,
          items: { type: "string", minLength: 1 },
          description: "要发送的消息，每一项作为一条独立消息按顺序发出",
        },
        continue: { type: "boolean", description: "true 时发送后继续生成下一步，可以再调用工具或再次发送消息" },
      },
      required: ["messages"],
    }),
    execute: async (input, execution) => {
      const target = input.channel ? input.channel : defaultChannelId;
      const messages = Array.isArray(input.messages) ? input.messages : [];
      if (messages.length === 0) return { ok: false, error: { name: "InvalidInput", message: "messages is empty" }, sent: [], failedAt: 0 };
      if (messages.some((m) => typeof m !== "string" || m.length === 0))
        return { ok: false, error: { name: "InvalidInput", message: "messages must be non-empty strings" }, sent: [], failedAt: 0 };
      if (input.mode && input.mode !== "element" && input.mode !== "raw")
        return { ok: false, error: { name: "InvalidInput", message: `mode must be "element" or "raw"` }, sent: [], failedAt: 0 };
      const mode = input.mode ?? "element";
      const total = input.messages.length;
      const sent: string[] = [];
      let elapsed = 0;
      const abort = (index: number, error: { name: string; message: string }): SendMessageOutput => {
        onFailed?.({ channelId: target, turnId: execution.turnId, failedAt: index, total, error });
        return { ok: false, error, sent, failedAt: index };
      };
      for (const [index, message] of input.messages.entries()) {
        try {
          const segments = mode === "raw" ? [[h.text(message)]] : await prepareOutputSegments(parseReply(message), resources, execution.abortSignal);
          for (const segment of segments) {
            if (sent.length > 0) {
              const delay = pacedDelay(segment, pacing, elapsed);
              const startedAt = Date.now();
              await sleep(delay, execution.abortSignal);
              elapsed += Math.max(delay, Date.now() - startedAt);
            }
            if (execution.abortSignal?.aborted) return abort(index, { name: "AbortError", message: "send_message aborted" });
            const ids = await bot.sendMessage(target, segment);
            sent.push(...ids);
            for (const id of ids) onDelivered?.({ channelId: target, messageId: id, turnId: execution.turnId, text: message });
          }
        } catch (cause) {
          if (cause instanceof ResourceReadError) return abort(index, { name: cause.code, message: cause.message });
          return abort(index, {
            name: cause instanceof Error ? cause.name : "Error",
            message: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }
      return { ok: true, messageIds: sent, count: total };
    },
  };
}

export function createReadTool(resources: ChannelResources, imageOutputSupported: boolean): AgentTool<{ uri: string }, ResourceReadResult> {
  const pendingImages = new Map<string, { bytes: Uint8Array; mediaType: string }>();
  const imageEnabled = imageOutputSupported && resources.imageInput;
  const lines = [
    "读取资源内容。仅在确实需要内容时读取精确 URI，不要猜测或拼造 URI。",
    "URI 形如 scheme://authority[/path]，不能包含 ?、#、%，也不能有 . 或 .. 路径段。",
    "- asset://<32位十六进制id>：平台输入的不可变资源，包括图片与文本文件。消息里看到的 [图片：asset://xxx] 和 [文件：名字 asset://xxx] 就是它；路径部分必须为空。",
    "- artifact://<tool>/<uuid>：工具输出的不可变工件，uuid 由工具返回，原样传入。",
  ];
  for (const reader of resources
    .listReaders()
    .slice()
    .sort((a, b) => a.scheme.localeCompare(b.scheme))) {
    lines.push(`- ${reader.scheme}://：${reader.prompt}`);
  }
  lines.push(
    "",
    "返回 {uri, filename?, mediaType?, text?, error?}。",
    "- 文本资源在 text 中直接给出内容，过长会被截断并以 [内容已截断] 结尾。",
    imageEnabled
      ? "- 图片资源：读取后图片字节将随结果返回，你可以直接查看图片内容。查看图片必须使用本工具读取。"
      : "- 图片资源只给出占位描述，不包含图片字节，当前无法查看图片内容。",
  );
  if (!imageEnabled) lines.push("- 需要图片内容时，使用 describe_image 工具获取图片描述。");
  lines.push(
    "- 其他二进制只给出类型与大小，无法查看内容。",
    "- error 存在时不会有 text：invalid_resource_uri 表示 URI 形状不合法，检查后重写而不是原样重试；resource_not_found 表示资源不存在，换来源；resource_unavailable 表示该方案当前未启用；resource_too_large 表示超出读取上限，无法读取；timeout 与 resource_read_aborted 可以重试一次；resource_read_failed 表示读取失败。",
  );
  return {
    name: "read",
    description: lines.join("\n"),
    inputSchema: jsonSchema<ResourceReadInput>({ type: "object", properties: { uri: { type: "string", description: "要读取的资源 URI" } }, required: ["uri"] }),
    execute: async ({ uri }, execution) => {
      let opened: Awaited<ReturnType<ChannelResources["openStrict"]>>;
      try {
        opened = await resources.openStrict(uri, execution.abortSignal);
      } catch (cause) {
        if (cause instanceof ResourceReadError) return { uri, error: cause.code };
        return { uri, error: "resource_read_failed" };
      }
      const mediaType = detectedMediaType(opened.bytes) ?? opened.mediaType;
      if (imageOutputSupported && resources.imageInput && mediaType?.startsWith("image/")) {
        pendingImages.set(execution.toolCallId, { bytes: opened.bytes, mediaType });
      }
      return { uri, filename: opened.filename, mediaType, text: describeBytes(opened.bytes, mediaType) };
    },
    toModelOutput: ({ toolCallId, output }) => {
      const image = pendingImages.get(toolCallId);
      if (!image) return { type: "json", value: output };
      return {
        type: "content",
        value: [
          ...(output.text ? [{ type: "text" as const, text: output.text }] : []),
          { type: "image-data" as const, data: Buffer.from(image.bytes).toString("base64"), mediaType: image.mediaType },
        ],
      };
    },
  };
}

export function createDescribeImageTool(model: LanguageModel, resources: ChannelResources): AgentTool<DescribeImageInput, DescribeImageOutput> {
  return {
    name: "describe_image",
    description:
      "当你需要了解图片内容、但当前无法直接查看图片时，使用本工具调用外部视觉模型生成图片描述。uri 必须是 asset://<32位十六进制id>。返回 {text} 或 {error}：invalid_uri 表示 URI 形状不合法；asset_not_found 表示资源不存在；not_an_image 表示该资源不是已知格式的图片；vision_call_failed 表示外部模型调用失败，可重试一次。",
    inputSchema: jsonSchema<DescribeImageInput>({
      type: "object",
      properties: {
        uri: { type: "string", description: "要描述的图片资源 URI，形如 asset://<32位十六进制id>" },
        question: { type: "string", description: "要从图片中获取的信息" },
      },
      required: ["uri", "question"],
    }),
    execute: async ({ uri, question }, execution) => {
      if (!/^asset:\/\/[a-f0-9]{32}$/.test(uri)) return { error: "invalid_uri" };
      const id = uri.slice("asset://".length);
      let bytes: Uint8Array;
      try {
        bytes = await resources.assets.get(id);
      } catch {
        return { error: "asset_not_found" };
      }
      const mediaType = detectedMediaType(bytes);
      if (!mediaType) return { error: "not_an_image" };
      try {
        const result = await generateText({
          model,
          temperature: 0.2,
          abortSignal: execution.abortSignal,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: `请详细描述这张图片，并回答问题：${question}\n\n图片内容：` },
                { type: "file", data: bytes, mediaType },
              ],
            },
          ],
        });
        return { text: result.text };
      } catch (cause) {
        return { error: `vision_call_failed: ${cause instanceof Error ? cause.message : String(cause)}` };
      }
    },
  };
}

export function createFinishTool(): AgentTool<FinishInput, FinishOutput> {
  return {
    name: "finish",
    terminal: true,
    description:
      "结束本轮，不发送任何消息。当你判断当前场景不需要你参与、或已经做完该做的事且没有要说的话时使用。保持沉默是一个完整的选择，不需要为了确认收到或维持礼貌而发言。",
    inputSchema: jsonSchema<FinishInput>({
      type: "object",
      properties: { reason: { type: "string", description: "结束原因" } },
      required: ["reason"],
    }),
    execute: async () => ({ ok: true }),
  };
}

function sendMessageDescription(innerThought: boolean): string {
  return `向频道发送消息。这是消息到达平台的唯一途径——你的文本输出不会被发送，只有本工具发出的内容会被别人看到。

调用后生成一条真正展示给用户的回复。你可以针对某个用户回复，也可以对所有用户回复。发言必须通过send_message工具，不然用户无法看见，这是你与用户交流的唯一途径。。

# 参数

## messages
要发送的消息列表，每一项作为一条独立消息按顺序发出。
让分条跟随对话节奏：快速反应和深思熟虑的解释各有恰当的时刻，不要固守习惯性的条数或长度。读者逐条看到消息，每次分条都会让半截回复单独停留片刻，只在不伤害这种「半截状态」的地方分条。事实、指令、代码、链接、结构化内容、修正，以及任何后果重大的内容，都应保持在同一条消息内。
不要用空行分段。平台不会把空行渲染成视觉分隔，它只是一个被吞掉的空白，让消息看起来格式奇怪。需要分开就分成多条。

## channel
目标频道 ID。留空发往当前频道；填写其他频道 ID 可以向该频道发送。

## mode
- element（默认）：内容按下面的消息元素语法解析，<img> 与 <file> 的资源 URI 会被解析成真实内容。
- raw：内容作为字面量原样发送，不解析任何元素。尖括号、& 和引号都不需要转义，你写下的每个字符原样到达接收方。发送代码、日志、命令行输出、含大量特殊字符的文本，或需要精确控制每个字符时用它。

## continue
默认 false。设为 true 时，发送后继续生成下一步，可以再调用工具或再次发送消息。需要「先回应再去做事」或「分几次发送并在中间查资料」时用它。
${
  innerThought
    ? `
## inner_thought
本次发送前的内心活动——感受当前场景的氛围、形成对正在发生的事的判断、规划接下来的行动，或反思之前的选择。
它不会到达平台，任何人都看不到，但会保留在你自己的历史里，之后你能看到当时想了什么。不要把其中的话当作已经说出口；需要让对方知道某个判断，必须另外写进 messages。没有固定长度或频率要求，不需要每次都写。
`
    : ""
}
# 返回值
成功返回 {ok:true, messageIds, count}。
失败返回 {ok:false, error, sent, failedAt}：sent 是已经成功发出的消息 ID，failedAt 是出错的 messages 下标。发送遇错会立即停止，failedAt 及其之后的消息都没有发出。必须检查 ok，不要假设发送成功。

# 消息元素（仅 mode=element）
消息元素的语法与 HTML 类似，形如 <名称 属性="值"/>。你观察到的消息由元素组成，你发出的消息使用同一套元素：普通文本直接写，结构元素直接放在文本里。
元素名只能由小写字母、数字和连字符组成，且以字母开头。不符合规则的标签形式会被当作普通文本——但如果你的文本恰好长得像合法元素名，它就会被错误解析。这就是为什么转义很重要。

## 常用元素
<at id="用户ID"/>：提及某人。id 填用户 ID，不是昵称。
<at type="all"/>：提及全体成员。<at type="here"/>：提及在线成员。
<quote id="消息ID"/>：引用某条消息。id 取自该消息观察头的 id。
<img src="…"/>：图片。src 支持频道资源 URI。
<file src="…"/>：文件。src 支持频道资源 URI。
<audio src="…"/>：语音。src 只能是平台可直接访问的地址。
<video src="…"/>：视频。src 只能是平台可直接访问的地址。
<text>…</text>：逐字交付的纯文本块。其中的内容不会被解析成元素，所有字符原样到达接收方。用它包裹含尖括号的代码、标签示例、泛型签名等片段。整条消息都是这类内容时，直接用 mode=raw 更省事。

## 转义（关键）
< 和 > 如果没有转义，系统会尝试把它们之间的内容解析为元素。如果解析成功，你原本想输出的文字就会消失——这不是显示异常，而是内容被永久吞掉。
例如：你想说「当 a<b 且 c>d 时」，但 <b 且 c> 看起来像一个元素，会被解析掉，接收方看到的是「当 a d 时」。
规则：文本中出现的 <、>、&、" 如果不是用来构成元素标签，必须转义。
| 字符 | 转义 | 何时需要 |
|:---:|:---:|:---|
| < | &lt; | 文本中所有非元素用途的 < |
| > | &gt; | 文本中所有非元素用途的 > |
| & | &amp; | 文本中的 &（否则会被当作转义序列开头） |
| " | &quot; | 元素属性值内的引号 |

## 示例
普通对话，不需要特殊处理：
messages: ["今天天气不错"]

分多条发送：
messages: ["先说结论", "具体原因是这样的……"]

提及某人并引用消息：
messages: ["<quote id=\\"msg_12345\\"/><at id=\\"114514\\"/> 你说的这个我有不同看法"]

文本中包含尖括号：
messages: ["泛型写法是 Array&lt;string&gt;，不是 Array(string)"]
→ 接收方看到：泛型写法是 Array<string>，不是 Array(string)

发送代码——用 mode=raw 最直接：
mode: "raw", messages: ["function compare<T>(a: T, b: T) {\\n  return a < b;\\n}"]

错误示范——忘记转义：
messages: ["当 x<10 且 y>5 时执行"]
❌ 系统尝试解析 <10 且 y>，内容丢失。改用转义或 mode=raw。

## 资源与不支持的格式
只有 <img> 和 <file> 的 src 支持频道资源 URI（可用方案见 read 工具说明），发送前会被解析成真实内容；<audio> 和 <video> 的 src 不会被解析。资源解析失败时该元素会被整条丢掉，消息其余部分照常发出——引用资源前先确认它存在。
平台不支持的修饰元素（加粗、斜体、Markdown 格式等）会被去掉标签、保留其中的文字。不要依赖排版来表达结构或强调。`;
}

function pacedDelay(segment: readonly Element[], pacing: PacingConfig, elapsed: number): number {
  const characters = segment.reduce((total, element) => total + elementTextLength(element), 0);
  const delay = Math.min(Math.max(250, Math.ceil((characters / pacing.charactersPerSecond) * 1000)), 10_000);
  return elapsed + delay >= pacing.maxTotalDelayMs ? 250 : Math.round(delay);
}

function elementTextLength(element: Element): number {
  return (
    (typeof element.attrs.content === "string" ? element.attrs.content.length : 0) +
    element.children.reduce((total, child) => total + elementTextLength(child), 0)
  );
}

function sleep(timeout: number, signal?: AbortSignal): Promise<void> {
  if (timeout <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, timeout);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

function describeBytes(bytes: Uint8Array, mediaType?: string): string {
  const image = detectedMediaType(bytes);
  if (image) return `[图片资源，${image}，${formatBytes(bytes.byteLength)}]`;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.length <= READ_MAX_TEXT_CHARS) return text;
    const marker = "\n[内容已截断]";
    return `${text.slice(0, READ_MAX_TEXT_CHARS - marker.length)}${marker}`;
  } catch {
    return `[资源，${mediaType ?? "未知类型"}，${formatBytes(bytes.byteLength)}]`;
  }
}

function detectedMediaType(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  )
    return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "image/webp";
  return undefined;
}

function formatBytes(length: number): string {
  if (length >= 1024 * 1024) return `${(length / (1024 * 1024)).toFixed(1)} MiB`;
  if (length >= 1024) return `${(length / 1024).toFixed(1)} KiB`;
  return `${length} B`;
}
