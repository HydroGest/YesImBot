import type { LinkCorrection, MessageLink, MessageTurn } from "./types.js";

export function applyCorrections(
  links: readonly MessageLink[],
  turns: readonly MessageTurn[],
  corrections: readonly LinkCorrection[],
): MessageLink[] {
  const byMessageId = new Map(turns.map((turn) => [turn.messageId, turn]));
  const removed = new Set<string>();
  const added: MessageLink[] = [];

  for (const correction of corrections) {
    const from = byMessageId.get(correction.from);
    if (!from) continue;
    const to = correction.to === null ? undefined : byMessageId.get(correction.to);
    if (correction.to !== null && !to) continue;
    const targetId = to?.id ?? null;
    const key = `${from.id}|${targetId ?? "null"}|${correction.kind}`;

    if (correction.action === "remove") {
      removed.add(key);
      if (correction.kind === "*") removed.add(`${from.id}|${targetId ?? "null"}|*`);
      continue;
    }

    added.push({
      from: from.id,
      to: targetId,
      kind: correction.kind === "*" ? "reply" : correction.kind,
      confidence: correction.confidence,
      evidence: ["manual", correction.id],
    });
  }

  return [
    ...links.filter(
      (link) =>
        !removed.has(`${link.from}|${link.to ?? "null"}|${link.kind}`) &&
        !removed.has(`${link.from}|${link.to ?? "null"}|*`),
    ),
    ...added,
  ];
}
