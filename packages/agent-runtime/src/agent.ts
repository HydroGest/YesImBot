import {
  hasToolCall,
  isLoopFinished,
  LanguageModel,
  streamText,
  type SystemModelMessage,
  type LanguageModelUsage,
} from "ai";

import { AgentChannel, createAgentChannel } from "./channel.js";
import { createEventEntry, createMessageEntry } from "./entry.js";
import { formatErrorCause } from "./errors.js";
import { createDiagnostic, createInternalEvent } from "./event.js";
import { buildModelMessages, createAssistantMessage, createToolMessage } from "./message.js";
import { createPluginHost } from "./plugin.js";
import { AgentStateManager, createStateManager } from "./state.js";
import { createMemoryStorage } from "./storage.js";
import {
  AgentTool,
  AgentToolSet,
  createTerminalTool,
  mergeTools,
  resolveTerminalToolName,
  toAiToolSet,
} from "./tools.js";
import type { AgentToolExecuteContext } from "./tools.js";
import {
  createTurnQueue,
  TurnResult,
  type AgentWaitOptions,
  type TurnRequest,
} from "./turn.js";
import { Awaitable } from "./types/base.js";
import type { AgentEntry } from "./types/entry.js";
import type { AgentInternalEvent, AgentInternalEventInit } from "./types/event.js";
import type { AgentMessage } from "./types/message.js";
import type {
  AgentPlugin,
  PromptContext,
  ToolExtensionContext,
  ToolHookContext,
} from "./types/plugin.js";
import type { AgentState } from "./types/state.js";
import type { AgentStorage } from "./types/storage.js";

export interface AgentSendOptions {
  ifBusy?: "defer" | "join" | "reject";
}

export interface AgentTerminalToolConfig {
  name?: string;
}

export interface AgentConfig {
  id?: string;
  model: LanguageModel;
  systemPrompt?: string | ((context: PromptContext) => Awaitable<string>);
  tools?: AgentToolSet;
  terminalTool?: boolean | AgentTerminalToolConfig;
  storage?: AgentStorage<AgentEntry>;
  plugins?: AgentPlugin[];
  initialState?: AgentState;
  defaultState?: AgentState;
}

export interface Agent {
  readonly id: string;
  readonly channel: AgentChannel;
  readonly storage: AgentStorage<AgentEntry>;
  readonly state: AgentStateManager;
  init(): Promise<void>;
  stop(): Promise<void>;
  append(message: AgentMessage): Promise<void>;
  send(message: AgentMessage, options?: AgentSendOptions): string;
  run(message: AgentMessage, options?: AgentSendOptions): AsyncIterable<AgentInternalEvent>;
  wait(options?: AgentWaitOptions): Promise<void>;
  interrupt(reason?: unknown): Awaitable<void>;
  setTools(tools: AgentToolSet): void;
  getModel(): LanguageModel;
  setModel(model: LanguageModel): void;
  clear(): Promise<void>;
  getActiveTurnId(): string | undefined;
  isIdle(): boolean;
}

function createAbortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function raceAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return operation;
  }

  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  return Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(createAbortError()), { once: true });
    }),
  ]);
}

function isTurnScopedEvent(
  event: AgentInternalEvent,
): event is AgentInternalEvent & { turnId: string } {
  return "turnId" in event && typeof (event as { turnId?: unknown }).turnId === "string";
}

function isTerminalTurnEvent(event: AgentInternalEvent) {
  return (
    event.type === "turn.done" || event.type === "turn.failed" || event.type === "turn.aborted"
  );
}

export function createAgent(config: AgentConfig): Agent {
  const id = config.id ?? crypto.randomUUID();
  const baseStorage = config.storage ?? createMemoryStorage();
  const channel = createAgentChannel();

  let storageReady = Promise.resolve();
  const mutateStorage = async <T>(operation: () => Promise<T>): Promise<T> => {
    const next = storageReady.then(operation, operation);
    storageReady = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const storage: AgentStorage<AgentEntry> = {
    append: (...entries) => mutateStorage(() => Promise.resolve(baseStorage.append(...entries))),
    read: () => storageReady.then(() => baseStorage.read()),
    clear: () => mutateStorage(() => Promise.resolve(baseStorage.clear())),
  };
  const state = createStateManager({
    storage,
    initialState: config.initialState ?? config.defaultState,
  });

  let model = config.model;
  let tools = config.tools ?? [];
  const terminalToolName = resolveTerminalToolName(config.terminalTool);
  const terminalTools = terminalToolName ? [createTerminalTool(terminalToolName)] : [];
  const systemPrompt = config.systemPrompt;

  const pluginHost = createPluginHost({
    plugins: config.plugins ?? [],
    runtime: { id, channel, state, storage },
  });

  const runtimeContext = {
    runtime: { id },
    channel,
    state,
    storage,
  };

  let initialized = false;
  let initPromise: Promise<void> | undefined;
  const turnStreams = new Map<string, Set<(event: AgentInternalEvent) => void>>();
  const turnEventBuffer = new Map<string, AgentInternalEvent[]>();
  let appendPipelineReady = Promise.resolve();
  const submittedMessageEntries = new WeakMap<
    object,
    Array<Extract<AgentEntry, { type: "message" }>>
  >();

  const runAppendPipeline = async <T>(operation: () => Promise<T>): Promise<T> => {
    const next = appendPipelineReady.then(operation, operation);
    appendPipelineReady = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const emitInternal = <T extends AgentInternalEventInit>(event: T): AgentInternalEvent<T> => {
    const created = createInternalEvent(event);

    if (isTurnScopedEvent(created)) {
      const buffered = turnEventBuffer.get(created.turnId) ?? [];
      buffered.push(created);
      turnEventBuffer.set(created.turnId, buffered);

      for (const listener of turnStreams.get(created.turnId) ?? []) {
        listener(created);
      }
    }

    void Promise.resolve(channel.emit("internal", created)).catch(() => undefined);

    return created;
  };

  const appendEntries = async (
    entries: AgentEntry[],
    options: { turnId?: string } = {},
  ): Promise<AgentEntry[]> => {
    if (entries.length === 0) {
      return [];
    }

    return runAppendPipeline(async () => {
      const transformed = await pluginHost.helpers.onAppend(entries, runtimeContext);
      await storage.append(...transformed);

      for (const entry of transformed) {
        if (entry.type !== "message") continue;

        await emitInternal(
          options.turnId
            ? { type: "message.appended", message: entry.data, turnId: options.turnId }
            : { type: "message.appended", message: entry.data },
        );
      }

      return transformed;
    });
  };

  const persistTerminalTurnEvent = async (event: AgentInternalEventInit & { turnId: string }) => {
    const created = await emitInternal(event);
    await storage.append(createEventEntry(created));
  };

  const ensureInit = () => {
    if (initialized) {
      return Promise.resolve();
    }
    if (initPromise) {
      return initPromise;
    }

    initPromise = (async () => {
      await pluginHost.init();
      initialized = true;
      await emitInternal({ type: "agent.init" });
    })().finally(() => {
      if (!initialized) {
        initPromise = undefined;
      }
    });

    return initPromise;
  };

  const resolveSystemPrompt = async (
    turnId: string,
    signal?: AbortSignal,
  ): Promise<string | SystemModelMessage[] | undefined> => {
    const promptContext: PromptContext = {
      ...runtimeContext,
      turnId,
      signal,
    };
    const basePrompt =
      typeof systemPrompt === "function" ? await systemPrompt(promptContext) : systemPrompt;

    const legacyPrompt =
      basePrompt === undefined
        ? undefined
        : await pluginHost.helpers.extendSystemPrompt(basePrompt, promptContext);
    const structuredBlocks = await pluginHost.helpers.appendSystemPrompt(promptContext);

    if (structuredBlocks.length === 0) {
      return legacyPrompt;
    }

    return legacyPrompt === undefined
      ? structuredBlocks
      : [{ role: "system", content: legacyPrompt }, ...structuredBlocks];
  };

  const resolveTools = async (turnId: string, signal?: AbortSignal) => {
    const toolContext: ToolExtensionContext = {
      ...runtimeContext,
      turnId,
      signal,
    };
    const stableTools = mergeTools([tools, [...pluginHost.stableTools], terminalTools]);
    const visibleTools = pluginHost.hasDynamicToolExtensions
      ? await pluginHost.helpers.extendTools([...stableTools], toolContext)
      : stableTools;
    const merged = mergeTools([visibleTools]);

    let serial = Promise.resolve();
    const wrapped: AgentToolSet = [];

    for (const tool of merged) {
      const toolName = tool.name;
      const wrappedTool: AgentTool = {
        ...tool,
        execute: tool.execute
          ? async (input, options) => {
              const run = serial.then(async () => {
                const hookContext: ToolHookContext = {
                  ...runtimeContext,
                  turnId,
                  signal: options.abortSignal ?? signal,
                };
                throwIfAborted(hookContext.signal);

                const originalCall = {
                  toolCallId: options.toolCallId,
                  toolName,
                  args: input,
                };
                const decision = await pluginHost.helpers.beforeToolCall(
                  { type: "allow" },
                  originalCall,
                  hookContext,
                );
                throwIfAborted(hookContext.signal);

                const nextInput = decision.type === "replace" ? decision.args : input;

                if (decision.type === "block") {
                  await emitInternal({
                    type: "tool.blocked",
                    turnId,
                    toolName,
                    toolCallId: options.toolCallId,
                    reason: decision.reason,
                  });
                  return { blocked: true, reason: decision.reason };
                }

                await emitInternal({
                  type: "tool.start",
                  turnId,
                  toolName,
                  toolCallId: options.toolCallId,
                });

                try {
                  const executeContext: AgentToolExecuteContext = {
                    ...options,
                    runtime: { id },
                    channel,
                    state,
                    storage,
                    turnId,
                    abortSignal: hookContext.signal,
                  };
                  const output = await raceAbort(
                    Promise.resolve(tool.execute?.(nextInput, executeContext)),
                    hookContext.signal,
                  );
                  throwIfAborted(hookContext.signal);
                  const result = await pluginHost.helpers.afterToolCall(
                    {
                      toolCallId: options.toolCallId,
                      toolName,
                      args: nextInput,
                      result: output,
                      isError: false,
                    },
                    hookContext,
                  );

                  await emitInternal({
                    type: "tool.done",
                    turnId,
                    toolName,
                    toolCallId: options.toolCallId,
                  });
                  return result.result;
                } catch (error) {
                  const diagnostic = createDiagnostic(error);
                  await pluginHost.helpers.afterToolCall(
                    {
                      toolCallId: options.toolCallId,
                      toolName,
                      args: nextInput,
                      result: diagnostic,
                      isError: true,
                    },
                    hookContext,
                  );

                  await emitInternal({
                    type: "tool.failed",
                    turnId,
                    toolName,
                    toolCallId: options.toolCallId,
                    error: diagnostic,
                  });
                  throw error;
                }
              });

              serial = run.then(
                () => undefined,
                () => undefined,
              );
              return run;
            }
          : undefined,
      } as AgentTool;
      wrapped.push(wrappedTool);
    }

    return wrapped;
  };

  const collectHistoryMessageEntries = async () => {
    await appendPipelineReady;
    const entries = await storage.read();
    return entries.filter(
      (entry): entry is Extract<AgentEntry, { type: "message" }> => entry.type === "message",
    );
  };

  const rememberSubmittedEntries = (
    messages: AgentMessage[],
    entries: Array<Extract<AgentEntry, { type: "message" }>>,
  ) => {
    if (messages.length !== entries.length) {
      return;
    }

    for (const [index, message] of messages.entries()) {
      submittedMessageEntries.set(message, [entries[index]]);
    }
  };

  const persistCurrentMessages = async (messages: AgentMessage[], turnId: string) => {
    const knownEntries: Array<Extract<AgentEntry, { type: "message" }>> = [];
    const freshMessages: AgentMessage[] = [];

    for (const message of messages) {
      const entries = submittedMessageEntries.get(message);
      if (entries) {
        knownEntries.push(...entries);
      } else {
        freshMessages.push(message);
      }
    }

    if (freshMessages.length === 0) {
      return knownEntries;
    }

    const transformed = await appendEntries(
      freshMessages.map((message) => createMessageEntry(message)),
      { turnId },
    );
    const freshEntries = transformed.filter(
      (entry): entry is Extract<AgentEntry, { type: "message" }> => entry.type === "message",
    );
    rememberSubmittedEntries(freshMessages, freshEntries);
    return [...knownEntries, ...freshEntries];
  };

  const buildBoundaryModelMessages = async (
    turnId: string,
    currentEntries: Array<Extract<AgentEntry, { type: "message" }>>,
    signal: AbortSignal,
  ) => {
    const persisted = await collectHistoryMessageEntries();
    const currentEntryIds = new Set(currentEntries.map((entry) => entry.id));
    const history = persisted
      .filter((entry) => !currentEntryIds.has(entry.id))
      .map((entry) => entry.data);
    const current = currentEntries.map((entry) => entry.data);

    return buildModelMessages({
      history,
      current,
      pluginHost,
      context: {
        runtime: { id },
        channel,
        state,
        turnId,
        signal,
      },
    });
  };

  const createTurnStream = (turnId: string): AsyncIterable<AgentInternalEvent> => {
    const queue = [...(turnEventBuffer.get(turnId) ?? [])];
    let done = queue.some(isTerminalTurnEvent);
    let resume: (() => void) | undefined;

    const cleanup = (listener: (event: AgentInternalEvent) => void) => {
      const listeners = turnStreams.get(turnId);
      listeners?.delete(listener);
      if (listeners?.size === 0) {
        turnStreams.delete(turnId);
      }
      turnEventBuffer.delete(turnId);
    };

    const push = (event: AgentInternalEvent) => {
      queue.push(event);
      if (isTerminalTurnEvent(event)) {
        done = true;
      }
      const notify = resume;
      resume = undefined;
      notify?.();
    };

    const listeners = turnStreams.get(turnId) ?? new Set<typeof push>();
    listeners.add(push);
    turnStreams.set(turnId, listeners);

    return {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            while (queue.length === 0) {
              if (done) {
                cleanup(push);
                return { done: true, value: undefined };
              }
              await new Promise<void>((resolve) => {
                resume = resolve;
              });
            }

            const value = queue.shift()!;
            if (done && queue.length === 0 && isTerminalTurnEvent(value)) {
              cleanup(push);
            }
            return { done: false, value };
          },
        };
      },
    };
  };

  const executeTurn = async (request: TurnRequest): Promise<TurnResult> => {
    const allMessages: AgentMessage[] = [];
    let usage: Partial<LanguageModelUsage> | undefined;
    let currentBatch = request.messages.splice(0, request.messages.length);
    const abortSignal = request.signal;

    try {
      await ensureInit();
      await emitInternal({ type: "turn.start", turnId: request.turnId });

      while (currentBatch.length > 0) {
        const currentEntries = await persistCurrentMessages(currentBatch, request.turnId);
        allMessages.push(...currentEntries.map((entry) => entry.data));

        const modelMessages = await buildBoundaryModelMessages(
          request.turnId,
          currentEntries,
          abortSignal,
        );

        let aborted = false;
        let persistedResponseMessageCount = 0;
        const response = streamText({
          model,
          system: await resolveSystemPrompt(request.turnId, abortSignal),
          messages: modelMessages,
          tools: toAiToolSet(await resolveTools(request.turnId, abortSignal)),
          stopWhen: terminalToolName
            ? [isLoopFinished(), hasToolCall(terminalToolName)]
            : isLoopFinished(),
          abortSignal,
          prepareStep: async ({ stepNumber }) => {
            if (stepNumber === 0) {
              return undefined;
            }

            const joined = await request.drainJoined();
            if (joined.length === 0) {
              return {
                messages: await buildBoundaryModelMessages(request.turnId, [], abortSignal),
              };
            }
            const joinedEntries = await persistCurrentMessages(joined, request.turnId);
            allMessages.push(...joinedEntries.map((entry) => entry.data));
            return {
              messages: await buildBoundaryModelMessages(
                request.turnId,
                joinedEntries,
                abortSignal,
              ),
            };
          },
          maxRetries: 0,
          onAbort() {
            aborted = true;
          },
          onStepFinish: async (step) => {
            usage = step.usage;
            const responseMessages = step.response.messages.slice(persistedResponseMessageCount);
            persistedResponseMessageCount = step.response.messages.length;
            const stepMessages: AgentMessage[] = responseMessages.map((message) =>
              message.role === "assistant"
                ? createAssistantMessage(message.content, {
                    providerOptions: message.providerOptions,
                    usage: step.usage,
                    finishReason: step.finishReason,
                  })
                : createToolMessage(message.content),
            );

            if (stepMessages.length > 0) {
              const stepEntries = await appendEntries(
                stepMessages.map((message) => createMessageEntry(message)),
                {
                  turnId: request.turnId,
                },
              );
              allMessages.push(
                ...stepEntries
                  .filter(
                    (entry): entry is Extract<AgentEntry, { type: "message" }> =>
                      entry.type === "message",
                  )
                  .map((entry) => entry.data),
              );
            }

            await emitInternal({
              type: "turn.step",
              turnId: request.turnId,
              step: step.stepNumber,
            });
          },
        });

        for await (const part of response.fullStream) {
          await channel.emit("stream", part);

          if (part.type === "text-delta") {
            const textPart = part as { text?: unknown; delta?: unknown };
            const delta = String(textPart.text ?? textPart.delta ?? "");
            await emitInternal({ type: "turn.delta", turnId: request.turnId, delta });
            continue;
          }
          if (part.type === "error") {
            throw part.error;
          }
        }

        if (aborted || abortSignal.aborted) {
          throw createAbortError();
        }

        currentBatch = await request.drainJoined();
      }

      await emitInternal({ type: "turn.done", turnId: request.turnId });
      const result: TurnResult = {
        turnId: request.turnId,
        status: "done",
        messages: allMessages,
        usage,
      };
      await pluginHost.helpers.onTurnFinish(result, {
        runtime: { id },
        channel,
        state,
        turnId: request.turnId,
      });
      return result;
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      const diagnostic = createDiagnostic(error);
      const result: TurnResult = {
        turnId: request.turnId,
        status: aborted ? "aborted" : "failed",
        messages: allMessages,
        error: diagnostic,
        usage,
      };
      await persistTerminalTurnEvent(
        aborted
          ? { type: "turn.aborted", turnId: request.turnId, reason: formatErrorCause(error) }
          : { type: "turn.failed", turnId: request.turnId, error: diagnostic },
      );
      await pluginHost.helpers.onTurnFinish(result, {
        runtime: { id },
        channel,
        state,
        turnId: request.turnId,
      });
      return result;
    }
  };

  const turnQueue = createTurnQueue({
    onRun: executeTurn,
  });

  const agent: Agent = {
    id,
    channel,
    storage,
    state,
    async init() {
      await ensureInit();
    },
    async stop() {
      await initPromise?.catch(() => undefined);
      if (!initialized) return;

      await pluginHost.stop();
      initialized = false;
      initPromise = undefined;
      await emitInternal({ type: "agent.stop" });
    },
    async append(message) {
      await this.init();
      await appendEntries([createMessageEntry(message)]);
    },
    send(message, options = {}) {
      const activeTurnId = turnQueue.activeTurnId;
      let persistence: Promise<void> | undefined;

      if (options.ifBusy === "join" && activeTurnId) {
        persistence = appendEntries([createMessageEntry(message)], { turnId: activeTurnId }).then(
          (entries) => {
            const messageEntries = entries.filter(
              (entry): entry is Extract<AgentEntry, { type: "message" }> =>
                entry.type === "message",
            );
            rememberSubmittedEntries([message], messageEntries);
          },
        );
      }

      const turnId = turnQueue.enqueue([message], options.ifBusy, persistence);
      if (turnId !== activeTurnId) {
        void emitInternal({ type: "turn.queued", turnId });
      }
      return turnId;
    },
    run(message, options = {}) {
      const turnId = this.send(message, options);
      return createTurnStream(turnId);
    },
    wait(options = {}) {
      return turnQueue.wait(options);
    },
    interrupt(reason) {
      return turnQueue.interrupt(reason);
    },
    setTools(nextTools) {
      tools = nextTools;
    },
    getModel() {
      return model;
    },
    setModel(nextModel) {
      model = nextModel;
    },
    async clear() {
      await storage.clear();
    },
    getActiveTurnId() {
      return turnQueue.activeTurnId;
    },
    isIdle() {
      return turnQueue.isIdle();
    },
  };

  return agent;
}
