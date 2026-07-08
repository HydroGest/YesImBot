import { posix } from "node:path";

export const DEFAULT_WORKSPACE_MOUNT = "/home/workspace";

export interface WorkspaceMountConfig {
  persistPaths?: Record<string, string>;
  readOnlyPaths?: Record<string, string>;
  overlayPaths?: Record<string, string>;
}

export interface NormalizedWorkspaceMountConfig {
  persistPaths: Record<string, string>;
  readOnlyPaths: Record<string, string>;
  overlayPaths: Record<string, string>;
}

export function normalizeVirtualMountPath(path: string): string {
  if (!path || path.trim().length === 0) {
    throw new Error("Mount point must not be empty");
  }
  if (!path.startsWith("/")) {
    throw new Error(`Mount point must be an absolute virtual path: ${path}`);
  }

  const segments = path.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Mount point must not contain . or .. segments: ${path}`);
  }

  const normalized = posix.normalize(path).replace(/\/+$/, "") || "/";
  if (normalized === "/") {
    throw new Error("Mount point / is not allowed");
  }

  return normalized;
}

function normalizeMap(paths: Record<string, string> | undefined): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [mountPoint, hostPath] of Object.entries(paths ?? {})) {
    const normalizedMount = normalizeVirtualMountPath(mountPoint);
    if (
      normalizedMount === DEFAULT_WORKSPACE_MOUNT ||
      normalizedMount.startsWith(`${DEFAULT_WORKSPACE_MOUNT}/`)
    ) {
      throw new Error(`${normalizedMount} is a reserved mount point`);
    }
    if (Object.hasOwn(normalized, normalizedMount)) {
      throw new Error(`Duplicate mount point ${normalizedMount} in the same mount map`);
    }
    normalized[normalizedMount] = hostPath;
  }

  return normalized;
}

export function assertValidMountConfig(
  config: WorkspaceMountConfig,
): NormalizedWorkspaceMountConfig {
  const normalized: NormalizedWorkspaceMountConfig = {
    persistPaths: normalizeMap(config.persistPaths),
    readOnlyPaths: normalizeMap(config.readOnlyPaths),
    overlayPaths: normalizeMap(config.overlayPaths),
  };

  const seen = new Map<string, string>();
  for (const [kind, paths] of Object.entries(normalized)) {
    for (const mountPoint of Object.keys(paths)) {
      const previous = seen.get(mountPoint);
      if (previous) {
        throw new Error(`Duplicate mount point ${mountPoint} in ${previous} and ${kind}`);
      }
      seen.set(mountPoint, kind);
    }
  }

  const mountPoints = [...seen.keys()].sort();
  for (let i = 0; i < mountPoints.length; i += 1) {
    for (let j = i + 1; j < mountPoints.length; j += 1) {
      const parent = mountPoints[i];
      const child = mountPoints[j];
      if (child.startsWith(`${parent}/`)) {
        throw new Error(`Nested mount point ${child} is not allowed under ${parent}`);
      }
    }
  }

  return normalized;
}
