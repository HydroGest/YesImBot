import type { AgentEntry, AgentPlugin, AgentStorage } from "@yesimbot/agent-runtime";
import { createEntry } from "@yesimbot/agent-runtime";
import type { LanguageModelUsage } from "ai";

import {
  DEFAULT_CHAR_TOKEN_RATIO,
  DEFAULT_CONTEXT_LENGTH,
  DEFAULT_MAX_FAILURES,
  DEFAULT_MIN_MESSAGES,
  DEFAULT_THRESHOLD,
  HARD_TRUNCATION_MESSAGE,
} from "./constants.js";
import { executeCompact } from "./execute.js";
import { filterEntriesForCompression } from "./filter.js";
import { transformCompactEntries } from "./transform.js";
import type { CompactPluginOptions } from "./types.js";

export function createCompactPlugin(options: CompactPluginOptions): AgentPlugin {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const charTokenRatio = options.charTokenRatio ?? DEFAULT_CHAR_TOKEN_RATIO;
  const minMessages = options.minMessages ?? DEFAULT_MIN_MESSAGES;
  const maxFailures = options.maxFailures ?? DEFAULT_MAX_FAILURES;
  const contextLength = options.contextLength ?? DEFAULT_CONTEXT_LENGTH;
  const logger = options.logger;

  let storage: AgentStorage<AgentEntry> | undefined;
  let compactFailures = 0;
  let compacting = false;

  const shouldTrigger = (usage: Partial<LanguageModelUsage> | undefined, entries: readonly AgentEntry[]): boolean => {
    const messagesSinceCompact = countMessagesSinceLastCompact(entries);
    if (messagesSinceCompact < minMessages) return false;

    if (usage?.inputTokens != null) {
      return usage.inputTokens >= contextLength * threshold;
    }

    const { previousSummary, entriesToCompress } = prepareCompactionInput(entries);
    const totalChars = previousSummary.length + filterEntriesForCompression(entriesToCompress).length;
    return totalChars >= contextLength * charTokenRatio * threshold;
  };

  const doCompact = async (activeStorage: AgentStorage<AgentEntry>, scheduleAppend = false): Promise<void> => {
    if (compacting) return;
    compacting = true;
    try {
      const entries = await activeStorage.read();
      const { previousSummary, entriesToCompress, lastEntryId } = prepareCompactionInput(entries);
      if (!lastEntryId) return;

      const conversation = filterEntriesForCompression(entriesToCompress);
      if (!conversation.trim()) return;

      const { name, content } = await options.persona();
      const model = options.model;
      if (!model) throw new Error("No compact model available");

      const summary = await executeCompact({
        model,
        persona: content,
        personaName: name,
        previousMemory: previousSummary,
        conversation,
      });

      const entry = createEntry("compact", { summary, lastEntryId });
      if (scheduleAppend && options.scheduleAppend) {
        await options.scheduleAppend(async () => {
          await activeStorage.append(entry);
        });
      } else {
        await activeStorage.append(entry);
      }
      compactFailures = 0;
    } catch (error) {
      compactFailures++;
      logger.warn("compact.failed", { error, failures: compactFailures });

      if (compactFailures >= maxFailures) {
        const entries = await activeStorage.read();
        const lastEntry = [...entries].reverse().find((entry) => entry.type === "message");
        if (lastEntry) {
          const hardTruncation = createEntry("compact", {
            summary: HARD_TRUNCATION_MESSAGE,
            lastEntryId: lastEntry.id,
          });
          if (scheduleAppend && options.scheduleAppend) {
            await options.scheduleAppend(async () => {
              await activeStorage.append(hardTruncation);
            });
          } else {
            await activeStorage.append(hardTruncation);
          }
        }
        compactFailures = 0;
        logger.warn("compact.hard_truncation");
      }
    } finally {
      compacting = false;
    }
  };

  options.onCompactStatus?.(() => compactFailures);

  options.onCompact?.(async () => {
    if (!storage) return;
    const entries = await storage.read();
    if (countMessagesSinceLastCompact(entries) < minMessages) return;
    await doCompact(storage);
  });

  return {
    name: "yesimbot-compact",
    enforce: "pre",
    init(runtime) {
      storage = (runtime as { storage?: AgentStorage<AgentEntry> }).storage;
    },
    transformEntries: transformCompactEntries,
    async onTurnFinish(result) {
      if (!storage) return;
      const entries = await storage.read();
      if (!shouldTrigger(result.usage, entries)) return;
      void doCompact(storage, true);
    },
  };
}

function countMessagesSinceLastCompact(entries: readonly AgentEntry[]): number {
  const lastCompactIndex = findLastCompactIndex(entries);
  const start = lastCompactIndex === -1 ? 0 : lastCompactIndex + 1;
  return entries.slice(start).filter((entry) => entry.type === "message").length;
}

function prepareCompactionInput(entries: readonly AgentEntry[]): {
  previousSummary: string;
  entriesToCompress: readonly AgentEntry[];
  lastEntryId: string | null;
} {
  const lastCompactIndex = findLastCompactIndex(entries);
  const previousSummary =
    lastCompactIndex !== -1 ? (entries[lastCompactIndex] as AgentEntry<"compact">).data.summary : "";
  const start = lastCompactIndex === -1 ? 0 : lastCompactIndex + 1;
  const entriesToCompress = entries.slice(start);
  const lastMessageEntry = [...entriesToCompress].reverse().find((entry) => entry.type === "message");

  return { previousSummary, entriesToCompress, lastEntryId: lastMessageEntry?.id ?? null };
}

function findLastCompactIndex(entries: readonly AgentEntry[]): number {
  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index].type === "compact") return index;
  }
  return -1;
}
