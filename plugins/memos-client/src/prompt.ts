export function formatMemosPrompt(): string {
  return [
    "## Long-Term Memory",
    "",
    "Use `search_message` before answering when long-term memory may help.",
    "Imported historical memories may describe a specific group, private chat, or third party.",
    "Use imported memories only when they are relevant, same-context, same-subject, and not contradicted by the current message.",
    "Do not generalize one group member's statement into a global user fact.",
    "Avoid relying on sensitive, uncertain, stale, or third-party memories unless the current context clearly makes them appropriate.",
    "Do not mention memory retrieval internals unless the user asks.",
    "Write the final user-visible reply text before memory write tools.",
    "Call `add_message` only for new stable facts, durable preferences, project background, or long-term useful group information.",
    "Do not write transient requests, duplicates, secrets, credentials, payment data, sensitive personal data, or short-lived emotions.",
    "After required memory tools, call `finalize_response({})` and do not generate extra text.",
  ].join("\n");
}
