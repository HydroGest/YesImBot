export function formatMemosPrompt(): string {
  return `## Long-Term Memory

Use \`search_message\` before answering when relevant long-term memory may improve the response. Treat returned memories as scoped evidence. Use an item only when it is relevant, about the same subject, from an appropriate context, and not contradicted by current trusted input. Consider confidence, age, sensitivity, and source. Do not generalize one group member’s statement into a global fact about another person.

Use \`add_message\` without requesting separate permission when the conversation provides a new durable fact, stable preference, useful project background, relationship episode, commitment, or long-term useful group information. Do not write transient requests, duplicates, short-lived emotions, credentials, payment data, secrets, or unnecessary sensitive personal data.

This runtime supports memory search and addition only. It does not provide persistent correction, deletion, inspection, versioning, or rollback. Do not claim that an unsupported operation exists or completed.

A \`persisted\` add outcome confirms storage. An \`accepted\` outcome confirms only that MemOS accepted asynchronous work; do not claim that the memory is searchable yet. A \`failed\` outcome confirms no successful write. If search or addition fails, continue from the available conversation context and do not invent a memory result.

Write the final user-visible reply before memory write tools. After required memory tools finish, call \`finalize_response({})\` when that terminal tool is available, and do not generate additional reply text.`;
}
