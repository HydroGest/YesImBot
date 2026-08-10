import { h, type Bot, type Logger, type Session } from "koishi";
import { formatElements, type ChannelContext } from "koishi-plugin-yesimbot";

import type { CommandActor, CommandExecutionEvent, InteractiveMode } from "./types.js";

type Element = ReturnType<typeof h.normalize>[number];
type ElementFragment = Parameters<typeof h.normalize>[0];
type PromptRequest = { prompt: string; resolve: (value: string) => void; reject: (reason: Error) => void };

export interface CommandExecutionOptions {
  id: string;
  command: string;
  bot: Bot;
  scope: ChannelContext;
  actor: CommandActor;
  interactive: InteractiveMode;
  channelId?: string;
  guildId?: string;
  channelName?: string;
  guildName?: string;
  userName?: string;
  messageId?: string;
  authority?: number;
  permissions?: readonly string[];
  timeoutMs: number;
  maxTranscriptChars: number;
  logger: Pick<Logger, "debug" | "info" | "warn">;
  persistElements?: (elements: readonly Element[]) => Promise<Element[]>;
}

export class CommandExecution {
  public readonly id: string;

  private readonly logger: Pick<Logger, "debug" | "info" | "warn">;
  private readonly session: Session;
  private readonly transcript: Element[] = [];
  private readonly waiters: Array<() => void> = [];
  private readonly abortController = new AbortController();
  private pendingPrompt?: PromptRequest;
  private terminal?: CommandExecutionEvent;
  private timer?: NodeJS.Timeout;

  public constructor(private readonly options: CommandExecutionOptions) {
    this.id = options.id;
    this.logger = options.logger;
    this.session = this.createSession(options);
    this.overrideSessionMethods(options);
  }

  public start(): void {
    this.logger.debug("command.execution.start", {
      executionId: this.id,
      command: this.options.command,
      channelId: this.options.channelId ?? this.options.scope.channelId,
      timeoutMs: this.options.timeoutMs,
    });
    this.timer = setTimeout(() => {
      this.logger.warn("command.execution.timeout", { executionId: this.id });
      this.abort(new Error("command timed out"));
    }, this.options.timeoutMs);

    void this.run().finally(() => {
      if (this.timer) clearTimeout(this.timer);
    });
  }

  public async next(): Promise<CommandExecutionEvent> {
    for (;;) {
      if (this.terminal) return this.terminal;

      if (this.pendingPrompt) {
        this.logger.debug("command.execution.awaiting_prompt", { executionId: this.id });
        return {
          status: "awaiting_prompt",
          executionId: this.id,
          prompt: this.pendingPrompt.prompt,
          transcript: this.serializeTranscript(),
        };
      }

      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
  }

  public async answer(answer: string): Promise<CommandExecutionEvent> {
    const prompt = this.pendingPrompt;
    if (!prompt) throw new Error(`no pending prompt for execution '${this.id}'`);

    this.logger.debug("command.execution.answer", { executionId: this.id });
    this.pendingPrompt = undefined;
    prompt.resolve(answer);
    this.notify();
    return this.next();
  }

  public abort(reason: Error = new Error("command aborted")): void {
    this.logger.debug("command.execution.abort", { executionId: this.id, reason: reason.message });
    this.abortController.abort(reason);
    const prompt = this.pendingPrompt;
    if (prompt) {
      this.pendingPrompt = undefined;
      prompt.reject(reason);
    }
    this.notify();
  }

  private async run(): Promise<void> {
    const startedAt = Date.now();
    try {
      await this.applyActorPermissions();
      const output = await this.session.execute(this.options.command, true);
      const outputElements = h.normalize(output as ElementFragment);
      if (this.options.persistElements) {
        const transcriptLength = this.transcript.length;
        const prepared = await this.options.persistElements([...this.transcript, ...outputElements]);
        this.transcript.splice(0, this.transcript.length, ...prepared.slice(0, transcriptLength));
        outputElements.splice(0, outputElements.length, ...prepared.slice(transcriptLength));
      }
      const transcript = this.serializeTranscript();
      const returnValue = serializeElements(outputElements, this.options.maxTranscriptChars);
      this.terminal = {
        status: "done",
        executionId: this.id,
        transcript,
        returnValue,
      };
      this.logger.debug("command.execution.done", {
        executionId: this.id,
        durationMs: Date.now() - startedAt,
        transcriptChars: transcript.length,
        returnValueChars: returnValue.length,
      });
    } catch (error) {
      this.terminal = {
        status: "done",
        executionId: this.id,
        transcript: this.serializeTranscript(),
        error: formatError(error),
      };
      this.logger.warn("command.execution.failed", {
        executionId: this.id,
        durationMs: Date.now() - startedAt,
        error: formatError(error),
      });
    } finally {
      this.notify();
    }
  }

  private createSession(options: CommandExecutionOptions): Session {
    const userId = options.actor.kind === "user" ? options.actor.userId : `yesimbot:agent:${options.bot.selfId}`;
    const channelId = options.channelId ?? options.scope.channelId;
    const guildId = options.guildId ?? (options.scope.type !== "direct" ? options.scope.guildId : undefined);
    const userName = options.userName ?? (options.actor.kind === "user" ? userId : `yesimbot:agent:${options.bot.selfId}`);
    const channelName = options.channelName ?? (options.scope.type === "channel" ? options.scope.channelName : undefined);
    const guildName = options.guildName ?? (options.scope.type !== "direct" ? options.scope.guildName : undefined);
    const messageId = options.messageId ?? `yesimbot:${options.id}`;

    const session = options.bot.session({
      type: "message-created",
      subtype: options.scope.type === "direct" ? "private" : "group",
      platform: options.bot.platform,
      selfId: options.bot.selfId,
      timestamp: Date.now(),
      channel: { id: channelId, type: options.scope.type === "direct" ? 1 : 0, ...(channelName ? { name: channelName } : {}) },
      ...(guildId ? { guild: { id: guildId, ...(guildName ? { name: guildName } : {}) } } : {}),
      user: { id: userId, name: userName },
      member: { name: userName },
      message: { id: messageId, content: "", elements: [] },
    }) as Session;
    session.bot = createSilentBotProxy(options.bot, (content) => {
      this.transcript.push(...h.normalize(content as ElementFragment));
    }) as Session["bot"];
    return session;
  }

  private overrideSessionMethods(options: CommandExecutionOptions): void {
    const session = this.session as Session & { prompt: (...args: unknown[]) => Promise<string | undefined> };

    session.send = async (fragment: Parameters<Session["send"]>[0]) => {
      this.transcript.push(...h.normalize(fragment as ElementFragment));
      return [];
    };

    session.sendQueued = async (fragment: Parameters<Session["sendQueued"]>[0]) => {
      this.transcript.push(...h.normalize(fragment as ElementFragment));
      return [];
    };

    session.prompt = async (...args: unknown[]) => {
      if (options.interactive !== "ask") {
        throw new Error("interactive command is not allowed");
      }
      if (typeof args[0] === "function") {
        throw new Error("callback prompt form is not supported");
      }

      return new Promise<string>((resolve, reject) => {
        this.pendingPrompt = { prompt: "命令要求用户输入，请调用 koishi_prompt_answer 提供答案。", resolve, reject };
        this.notify();
      });
    };
  }

  private async applyActorPermissions(): Promise<void> {
    const { authority, permissions } = this.options;
    if (authority === undefined && permissions === undefined) return;

    const user = await this.session.observeUser(["id", "authority", "permissions", "locales"] as never);
    const target = user as unknown as { authority: number; permissions: string[] };
    if (authority !== undefined) target.authority = authority;
    if (permissions !== undefined) target.permissions = [...permissions];
  }

  private serializeTranscript(): string {
    return serializeElements(this.transcript, this.options.maxTranscriptChars);
  }

  private notify(): void {
    for (const resolve of this.waiters.splice(0)) resolve();
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function serializeElements(elements: readonly Element[], maxChars: number): string {
  return formatElements(elements).trim().slice(0, maxChars);
}

function createSilentBotProxy(bot: Bot, onSend: (content: ElementFragment) => void): Bot {
  return new Proxy(bot, {
    get(target, property, receiver) {
      if (property === "sendMessage") {
        return async (_channelId: string, content: ElementFragment) => {
          onSend(content);
          return [];
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Bot;
}
