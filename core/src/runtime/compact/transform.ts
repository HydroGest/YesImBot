import type { AgentEntry } from "@yesimbot/agent-runtime";
import { createEntry } from "@yesimbot/agent-runtime";

export function transformCompactEntries(entries: readonly AgentEntry[]): AgentEntry[] {
  const compactIndex = findLastCompactIndex(entries);
  if (compactIndex === -1) return [...entries];

  const compactEntry = entries[compactIndex] as AgentEntry<"compact">;
  const lastEntryId = compactEntry.data.lastEntryId;

  const summaryEntry = createEntry(
    "message",
    {
      id: compactEntry.id,
      timestamp: compactEntry.timestamp,
      role: "system",
      content: `<context_summary>\n${compactEntry.data.summary}\n</context_summary>`,
    },
    { id: compactEntry.id, timestamp: compactEntry.timestamp },
  );

  const lastSummarizedIndex = entries.findIndex((entry) => entry.id === lastEntryId);
  if (lastSummarizedIndex === -1) {
    return [summaryEntry, ...entries.slice(compactIndex + 1)];
  }

  return [summaryEntry, ...entries.slice(lastSummarizedIndex + 1, compactIndex), ...entries.slice(compactIndex + 1)];
}

function findLastCompactIndex(entries: readonly AgentEntry[]): number {
  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index].type === "compact") return index;
  }
  return -1;
}
