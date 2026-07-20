import { isAbsolute, join, resolve } from "node:path";

import {
  createChannelScopeId,
  createChannelScopePath,
  type ChannelScope,
  type ChannelScopeId,
} from "../channel.js";

export function resolveBasePath(basePath: string, ctxBaseDir: string): string {
  return isAbsolute(basePath) ? basePath : resolve(ctxBaseDir, basePath);
}

export function createChannelRuntimeKey(scope: ChannelScope): ChannelScopeId {
  return createChannelScopeId(scope);
}

export function createChannelSessionPath(basePath: string, scope: ChannelScope): string {
  return createChannelScopePath(
    basePath,
    createChannelScopeId(scope),
    "sessions",
    "messages.jsonl",
  );
}

export function createChannelAssetPath(
  basePath: string,
  scope: ChannelScope,
  hash?: string,
): string {
  const root = join(basePath, "assets", createChannelScopeId(scope));
  return hash ? join(root, hash) : root;
}
