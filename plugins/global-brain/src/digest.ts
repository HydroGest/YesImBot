import type { BrainDigest } from "./types.js";

const KIND_LABELS: Record<BrainDigest["threads"][number]["kind"], string> = { question: "新问题", share: "新分享", insight: "新认知" };

export function formatBrainDigest(digest: BrainDigest, maxContentLength: number): string | undefined {
  const lines: string[] = [];

  for (const thread of digest.threads) {
    const tags = thread.tags.length > 0 ? thread.tags.join(",") : "无标签";
    lines.push(`[全局脑] ${KIND_LABELS[thread.kind]}：${truncate(thread.content, maxContentLength)}（标签：${tags}，id=${thread.id}；详情用 brain_read 查看）`);
  }

  for (const item of digest.replies) {
    lines.push(`[全局脑] 你发布的 ${KIND_LABELS[item.thread.kind]} 有 ${item.replies.length} 条新回复（id=${item.thread.id}；详情用 brain_read 查看）`);
  }

  return lines.length > 0 ? lines.join("\n") : undefined;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}
