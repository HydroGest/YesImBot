import { generateText, type LanguageModel } from "ai";

import { COMPACT_SYSTEM_PROMPT, COMPACT_USER_PROMPT } from "./constants.js";

export interface ExecuteCompactOptions {
  model: LanguageModel;
  persona: string;
  personaName: string;
  previousMemory: string;
  conversation: string;
  signal?: AbortSignal;
}

export async function executeCompact(options: ExecuteCompactOptions): Promise<string> {
  const { text } = await generateText({
    model: options.model,
    system: COMPACT_SYSTEM_PROMPT(options.personaName),
    prompt: COMPACT_USER_PROMPT({
      persona: options.persona,
      previousMemory: options.previousMemory,
      conversation: options.conversation,
    }),
    abortSignal: options.signal,
  });

  const summary = text.trim();
  if (summary.length === 0) {
    throw new Error("Compaction produced an empty summary.");
  }

  return summary;
}
