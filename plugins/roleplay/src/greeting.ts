import type { CharacterCardV3 } from "@risuai/ccardlib";

export function selectGreeting(card: CharacterCardV3, useRandomGreeting: boolean, random = Math.random): string {
  const greetings = [card.data.first_mes, ...card.data.alternate_greetings].filter((greeting) => greeting.length > 0);
  if (!useRandomGreeting || greetings.length === 0) return card.data.first_mes;
  return greetings[Math.min(greetings.length - 1, Math.floor(random() * greetings.length))] ?? card.data.first_mes;
}
