import type { CharacterCardV3 } from "@risuai/ccardlib";

import type { CBSContext } from "./cbs.js";
import { renderCBS } from "./cbs.js";

export function assembleInstructionExtension(card: CharacterCardV3, context: CBSContext): string {
  const systemPrompt = render(card.data.system_prompt, context);
  const exampleDialogues = formatExampleDialogues(render(card.data.mes_example, context));
  return [systemPrompt, exampleDialogues].filter((section) => section.length > 0).join("\n\n");
}

export function assembleCharacterDefinition(card: CharacterCardV3, context: CBSContext): string {
  const name = render(card.data.nickname ?? card.data.name, context);
  const description = render(card.data.description, context);
  const personality = render(card.data.personality, context);
  const scenario = render(card.data.scenario, context);

  return [
    name.length > 0 ? `Name: ${name}` : "",
    description,
    personality.length > 0 ? `Personality:\n${personality}` : "",
    scenario.length > 0 ? `Scenario:\n${scenario}` : "",
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");
}

export function assemblePostHistoryInstructions(card: CharacterCardV3, context: CBSContext): string {
  return render(card.data.post_history_instructions, context);
}

function render(value: string, context: CBSContext): string {
  return renderCBS(value, context).text.trim();
}

function formatExampleDialogues(example: string): string {
  const dialogues = example
    .split(/<START>/i)
    .map((dialogue) => dialogue.trim())
    .filter((dialogue) => dialogue.length > 0);
  if (dialogues.length === 0) return "";

  return [
    "<example_dialogues>",
    "These are style and behavior examples, not events from the current conversation.",
    ...dialogues.flatMap((dialogue) => ["<example_dialogue>", dialogue, "</example_dialogue>"]),
    "</example_dialogues>",
  ].join("\n");
}
