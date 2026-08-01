export class AgentRuntimeError extends Error {
  declare public cause?: unknown;

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "AgentRuntimeError";
    this.cause = options.cause;
  }
}

export class AgentBusyError extends AgentRuntimeError {
  constructor() {
    super("Agent is busy");
    this.name = "AgentBusyError";
  }
}

export class ToolConflictError extends AgentRuntimeError {
  constructor(toolName: string) {
    super(`Tool conflict: ${toolName}`);
    this.name = "ToolConflictError";
  }
}

export function formatErrorCause(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}

export function classifyRuntimeError(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }

  return "UnknownError";
}
