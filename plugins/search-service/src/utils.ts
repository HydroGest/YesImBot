export function clampLimit(
  value: number | undefined,
  defaultLimit: number,
  maxLimit: number,
): number {
  const limit = value ?? defaultLimit;
  return Math.max(1, Math.min(limit, maxLimit));
}

export function compileBlacklist(patterns: readonly string[] | undefined): RegExp[] {
  if (!patterns?.length) return [];

  return patterns.map((pattern) => {
    try {
      return new RegExp(pattern);
    } catch (error) {
      throw new Error(`Invalid blacklist pattern "${pattern}": ${error}`);
    }
  });
}

export function isBlockedUrl(url: string, blacklist: readonly RegExp[]): boolean {
  return blacklist.some((pattern) => pattern.test(url));
}

export function filterBlockedResults<T extends { url: string }>(
  results: readonly T[],
  blacklist: readonly RegExp[],
): T[] {
  if (blacklist.length === 0) return [...results];
  return results.filter((result) => !isBlockedUrl(result.url, blacklist));
}

export function dedupeByUrl<T extends { url: string }>(results: readonly T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const result of results) {
    let key = result.url;
    try {
      key = new URL(result.url).href;
    } catch {
      // Keep the raw URL as the dedupe key when URL parsing fails.
    }

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }

  return deduped;
}

export function normalizeUrlList(
  urls: readonly string[],
  maxUrls: number,
): Array<{ url: string } | { url: string; error: string }> {
  const seen = new Set<string>();
  const results: Array<{ url: string } | { url: string; error: string }> = [];

  for (const raw of urls) {
    if (results.length >= maxUrls) break;

    const trimmed = raw.trim();
    if (!trimmed) continue;

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      results.push({ url: trimmed, error: "Invalid URL format" });
      continue;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      results.push({ url: trimmed, error: `Unsupported protocol: ${parsed.protocol}` });
      continue;
    }

    const normalized = parsed.href;
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    results.push({ url: normalized });
  }

  return results;
}
