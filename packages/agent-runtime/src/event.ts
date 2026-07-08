import { createRandomId } from "./id.js";
import type { AgentDiagnostic, AgentInternalEvent, AgentInternalEventInit } from "./types/event.js";

function formatDiagnosticCause(cause: unknown): string | undefined {
  if (cause === undefined) {
    return undefined;
  }

  if (cause instanceof Error) {
    return `${cause.name}: ${cause.message}`;
  }

  return String(cause);
}

export function createDiagnostic(error: unknown): AgentDiagnostic {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      cause: formatDiagnosticCause(error.cause),
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
  };
}

export function createInternalEvent<T extends AgentInternalEventInit>(
  event: T,
): AgentInternalEvent<T> {
  return {
    id: createRandomId(),
    timestamp: Date.now(),
    ...event,
  };
}
