import { join } from "node:path";

export interface ChannelScope {
  readonly platform: string;
  readonly selfId: string;
  readonly channelId: string;
}

interface ChannelEvent {
  readonly platform: string;
  readonly selfId: string;
  readonly channel?: { readonly id?: string };
}

export function channelKey(scope: ChannelScope): string {
  return `${scope.platform}:${scope.selfId}:${scope.channelId}`;
}

export function channelPath(basePath: string, scope: ChannelScope): string {
  return join(basePath, "sessions", `${channelFileName(scope)}.jsonl`);
}

export function sameChannel(left: ChannelScope, right: ChannelScope): boolean {
  return channelKey(left) === channelKey(right);
}

export function fromEvent(record: ChannelEvent): ChannelScope | null {
  if (!record.channel?.id) return null;
  return {
    platform: record.platform,
    selfId: record.selfId,
    channelId: record.channel.id,
  };
}

export function channelFileName(scope: ChannelScope): string {
  return `${scope.platform}-${scope.selfId}-${scope.channelId}`.replace(/[^a-zA-Z0-9._-]/g, "_");
}
