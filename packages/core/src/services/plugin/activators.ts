import type { Activator } from "./types";

export function randomActivator(probability: number, priority?: number): Activator {
    return async () => {
        const allow = Math.random() < probability;
        return {
            allow,
            priority: allow ? (priority ?? 1) : 0,
            hints: allow ? [`Randomly activated (p=${probability})`] : [],
        };
    };
}

export function requireSession(reason?: string): Activator {
    return async ({ context }) => {
        const hasSession = !!context.session;
        return {
            allow: hasSession,
            hints: hasSession ? [] : [reason || "Requires active session"],
        };
    };
}

export function requirePlatform(platforms: string | string[], reason?: string): Activator {
    const platformList = Array.isArray(platforms) ? platforms : [platforms];
    return async ({ context }) => {
        const platform = context.session?.platform;
        const allowed = platform && platformList.includes(platform);
        return {
            allow: !!allowed,
            hints: allowed ? [] : [reason || `Requires platform: ${platformList.join(" or ")}`],
        };
    };
}
