import type { AgentEntry } from "@yesimbot/agent-runtime";
import { isEvent } from "koishi-plugin-yesimbot";

import type { ProactiveEventKind } from "./types.js";

export function detectProactiveEvent(entries: readonly AgentEntry[]): ProactiveEventKind | undefined {
  for (const entry of entries) {
    if (entry.type !== "message" || !isEvent(entry.data)) continue;
    const kind = proactiveEventKind(entry.data.data.eventType);
    if (kind) return kind;
  }
  return undefined;
}

function proactiveEventKind(eventType: string): ProactiveEventKind | undefined {
  if (eventType.startsWith("global-brain")) return "global-brain";
  if (eventType === "schedule.due") return "schedule";
  return undefined;
}
