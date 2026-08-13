import type { CommonRequestOptions } from "@yesimbot/shared-model";
import type { Logger } from "koishi";
import type { ModelGroup, SwitchConfig } from "./config";
import type { ModelService } from "./service";
import type { ModelError } from "./types";
import { SwitchStrategy } from "./types";

export interface SelectedChatModel {
    fullName: string;
    options: CommonRequestOptions;
    vision: boolean;
}

interface ModelRuntimeState {
    failureCount: number;
    openUntil?: number;
    totalRequests: number;
    successRequests: number;
    averageLatency: number;
    weight: number;
    lastError?: ModelError;
}

export class ChatModelSwitcher {
    private readonly states = new Map<string, ModelRuntimeState>();
    private rrIndex = 0;

    constructor(
        private readonly logger: Logger,
        private readonly registry: ModelService,
        private readonly group: ModelGroup,
        private readonly switchConfig: SwitchConfig,
    ) {
        if (!group.models.length) {
            throw new Error(`模型组 "${group.name}" 为空`);
        }

        for (const fullName of group.models) {
            this.states.set(fullName, {
                failureCount: 0,
                totalRequests: 0,
                successRequests: 0,
                averageLatency: 0,
                weight: (this.switchConfig as any).modelWeights?.[fullName] ?? 1,
            });
        }
    }

    public getModels(): Array<{ fullName: string; vision: boolean }> {
        return this.group.models.map((fullName) => ({
            fullName,
            vision: this.registry.isVisionChatModel(fullName),
        }));
    }

    private isAvailable(fullName: string): boolean {
        if (!this.switchConfig.breaker.enabled)
            return true;

        const state = this.states.get(fullName);
        if (!state?.openUntil)
            return true;

        return Date.now() >= state.openUntil;
    }

    private pickCandidate(candidates: string[]): string | undefined {
        const available = candidates.filter((m) => this.isAvailable(m));
        const pool = available.length ? available : candidates;

        if (!pool.length)
            return undefined;

        switch (this.switchConfig.strategy) {
            case SwitchStrategy.RoundRobin: {
                const choice = pool[this.rrIndex % pool.length];
                this.rrIndex = (this.rrIndex + 1) % Math.max(1, pool.length);
                return choice;
            }
            case SwitchStrategy.Random: {
                return pool[Math.floor(Math.random() * pool.length)];
            }
            case SwitchStrategy.WeightedRandom: {
                const total = pool.reduce((sum, m) => sum + (this.states.get(m)?.weight ?? 1), 0);
                if (total <= 0)
                    return pool[0];

                let r = Math.random() * total;
                for (const m of pool) {
                    r -= this.states.get(m)?.weight ?? 1;
                    if (r <= 0)
                        return m;
                }
                return pool[pool.length - 1];
            }
            case SwitchStrategy.Failover:
            default: {
                // Pick highest success rate, then lowest avg latency.
                const scored = pool
                    .map((m) => {
                        const s = this.states.get(m);
                        const total = s?.totalRequests ?? 0;
                        const succ = s?.successRequests ?? 0;
                        const successRate = total > 0 ? succ / total : 1;
                        const latency = s?.averageLatency ?? 0;
                        return { m, successRate, latency };
                    })
                    .sort((a, b) => {
                        if (b.successRate !== a.successRate)
                            return b.successRate - a.successRate;
                        return a.latency - b.latency;
                    });
                return scored[0]?.m;
            }
        }
    }

    public getModel(): SelectedChatModel | null {
        const fullName = this.pickCandidate(this.group.models);
        if (!fullName)
            return null;

        const options = this.registry.getChatModel(fullName);
        if (!options)
            return null;

        return {
            fullName,
            options,
            vision: this.registry.isVisionChatModel(fullName),
        };
    }

    public recordResult(fullName: string, success: boolean, error: ModelError | undefined, latencyMs: number): void {
        const state = this.states.get(fullName);
        if (!state)
            return;

        state.totalRequests += 1;
        if (success)
            state.successRequests += 1;

        // EMA latency
        const alpha = 0.2;
        state.averageLatency
            = state.averageLatency === 0 ? latencyMs : state.averageLatency * (1 - alpha) + latencyMs * alpha;

        if (!success) {
            state.failureCount += 1;
            state.lastError = error;

            if (this.switchConfig.breaker.enabled) {
                const threshold = this.switchConfig.breaker.threshold ?? 5;
                const cooldown = this.switchConfig.breaker.cooldown ?? 60_000;

                if (state.failureCount >= threshold) {
                    state.openUntil = Date.now() + cooldown;
                    this.logger.warn(
                        `模型熔断: ${fullName} | cooldown=${cooldown}ms | last=${error?.message ?? "unknown"}`,
                    );
                }
            }
        } else {
            state.failureCount = 0;
            state.openUntil = undefined;
        }
    }
}
