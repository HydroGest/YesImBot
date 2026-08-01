import { CronExpressionParser } from "cron-parser";
import type { CronExpression } from "cron-parser";

import type { ScheduleCreateInput } from "./types.js";

export const SCHEDULE_TIME_ZONE = "Asia/Shanghai";

export const MIN_CRON_INTERVAL_MINUTES = 15;
export const MAX_TITLE_LENGTH = 120;
export const MAX_PROMPT_LENGTH = 2000;
export const MAX_ENABLED_SCHEDULES = 20;

const RFC_3339_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** The rule half of a schedule before validation: at most one of `at`/`cron` is expected. */
export type ScheduleRuleShape = { kind: "once" | "cron"; at?: string; cron?: string };

/** A validated rule: exactly one of `at` or `cron` is defined. */
export type ScheduleRule = { kind: "once"; at: string } | { kind: "cron"; cron: string };

function isFiveFieldCron(cron: string): boolean {
  return cron.trim().split(/\s+/).length === 5;
}

/**
 * Computes the next occurrence strictly after `after` for a five-field cron.
 * The expression is interpreted in the fixed Asia/Shanghai timezone.
 */
export function nextCronRunAt(cron: string, after: Date): string {
  const interval = CronExpressionParser.parse(cron, {
    currentDate: after,
    tz: SCHEDULE_TIME_ZONE,
    // cron-parser v5 defaults missing fields to a leading second field with
    // `strict: false`; we pre-validate the five-field shape ourselves.
    strict: false,
  });
  return interval.next().toDate().toISOString();
}

/** The next run instant for a rule after `after`: the once instant, or the next cron occurrence. */
export function nextRunAt(rule: ScheduleRule, after: Date): string {
  if (rule.kind === "once") return new Date(rule.at).toISOString();
  return nextCronRunAt(rule.cron, after);
}

/** Validates a full create input against the fixed title, prompt, and rule limits. */
export function validateCreate(input: ScheduleCreateInput, now: Date): void {
  if (input.title.length === 0) throw new Error("title must not be empty");
  if (input.title.length > MAX_TITLE_LENGTH) {
    throw new Error(`title must not exceed ${MAX_TITLE_LENGTH} characters`);
  }
  if (input.prompt.length === 0) throw new Error("prompt must not be empty");
  if (input.prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(`prompt must not exceed ${MAX_PROMPT_LENGTH} characters`);
  }
  validateRule(input, now);
}

/** Validates that exactly one canonical rule form is present and usable after `now`. */
export function validateRule(rule: ScheduleRuleShape, now: Date): asserts rule is ScheduleRule {
  if ((rule.at === undefined) === (rule.cron === undefined)) {
    throw new Error("schedule must provide exactly one of at or cron");
  }
  if (rule.at !== undefined) {
    if (rule.kind !== "once") throw new Error("at is only valid for a once schedule");
    if (!RFC_3339_INSTANT.test(rule.at)) throw new Error("at must be an RFC 3339 instant");
    const time = Date.parse(rule.at);
    if (Number.isNaN(time)) throw new Error("at must be an RFC 3339 instant");
    if (time <= now.getTime()) throw new Error("at must be in the future");
    return;
  }
  if (rule.kind !== "cron") throw new Error("cron is only valid for a recurring schedule");
  // The exactly-one guard above excludes the both-absent case, so cron is defined here.
  if (!isFiveFieldCron(rule.cron!)) {
    throw new Error("cron must have exactly five whitespace-separated fields");
  }
  verifyMinCronInterval(rule.cron!, now);
}

function verifyMinCronInterval(cron: string, now: Date): void {
  let interval: CronExpression;
  try {
    interval = CronExpressionParser.parse(cron, {
      currentDate: now,
      tz: SCHEDULE_TIME_ZONE,
      strict: false,
    });
  } catch {
    throw new Error("invalid cron expression");
  }
  const minimum = MIN_CRON_INTERVAL_MINUTES * 60_000;
  let previous: number | null = null;
  // A sub-15-minute density anywhere in the pattern must be rejected, so check
  // every consecutive gap over a generous horizon instead of a single pair.
  for (let i = 0; i < 200; i++) {
    let current: number;
    try {
      current = interval.next().toDate().getTime();
    } catch {
      throw new Error("invalid cron expression");
    }
    if (previous !== null && current - previous < minimum) {
      throw new Error(`cron interval must be at least ${MIN_CRON_INTERVAL_MINUTES} minutes`);
    }
    previous = current;
  }
}
