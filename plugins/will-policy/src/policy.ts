import {
  defaultRoutingConfig,
  defaultWillingnessConfig,
  type PolicyRoutingConfig,
  type PolicyWillingnessConfig,
  type WillPolicyConfig,
} from "./types.js";

export interface ResolvedPolicy {
  readonly engine: "routing" | "willingness";
  readonly routing: PolicyRoutingConfig;
  readonly willingness: PolicyWillingnessConfig;
}

export function resolvePolicy(config: WillPolicyConfig): ResolvedPolicy {
  return {
    engine: config.engine,
    routing: { ...defaultRoutingConfig(), ...config.routing },
    willingness: { ...defaultWillingnessConfig(), ...config.willingness },
  };
}
