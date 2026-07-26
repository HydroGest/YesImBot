import { isAbsolute, resolve } from "node:path";

export function resolveBasePath(basePath: string, ctxBaseDir: string): string {
  return isAbsolute(basePath) ? basePath : resolve(ctxBaseDir, basePath);
}
