import type { ChannelScope } from "../channel/index.js";

export interface ChannelAllowRule {
  readonly platform: string;
  readonly channelId: string;
  readonly isDirect?: boolean;
}

export function matchesAllowedChannel(
  scope: ChannelScope,
  rules: readonly ChannelAllowRule[] | undefined,
): boolean {
  return (
    rules?.some(
      (rule) =>
        (rule.platform === "*" || rule.platform === scope.platform) &&
        (rule.channelId === "*" || rule.channelId === scope.channelId) &&
        (rule.isDirect === undefined || rule.isDirect === scope.isDirect),
    ) ?? false
  );
}
