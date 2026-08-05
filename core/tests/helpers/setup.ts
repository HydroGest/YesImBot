import { vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

export function stubLogger() {
  return { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
}
