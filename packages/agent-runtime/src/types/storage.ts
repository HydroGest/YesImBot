import { Awaitable } from "./base.js";
import type { AgentEntry } from "./entry.js";

export interface AgentStorage<T = AgentEntry> {
  append: (...items: T[]) => Awaitable<void>;
  clear: () => Awaitable<void>;
  read: () => Awaitable<Readonly<T[]>>;
}
