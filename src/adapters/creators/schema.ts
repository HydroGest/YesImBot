interface SchemaNode {
  type: string;
  description: string;
}

const schema = {
  status: {
    type: "enum",
    values: ["success", "skip", "function"],
    description: "Response status, either 'success' or 'skip'.",
  },
  replyTo: {
    type: "string",
    description: "Channel/User ID for reply. If you want to send a private message to the user, must prefix with 'private:' followed by the user ID.",
  },
  nextReplyIn: {
    type: "integer",
    description: "Messages before next reply.",
  },
  quote: {
    type: "string",
    description: "Message ID to reference. Don't fill this field if you send a private message.",
  },
  logic: {
    type: "string",
    description: "Response logic explanation.",
  },
  reply: {
    type: "string",
    description: "Initial response draft.",
  },
  check: {
    type: "string",
    description: "A description of the checks performed to ensure the initial reply complies with the rules specified in the '消息生成条例'.",
  },
  finalReply: {
    type: "string",
    description: "Final response after checks.",
  },
  execute: {
    type: "array",
    description: "Functions to execute.",
  },
};

export const schemaPrompt = `You will be given a chat history along with a prompt and a schema. You should generate output in JSON observing the schema provided. If the schema shows a type of integer or number, you must only show a integer for that field. A string should always be a valid string. If a value is unknown, leave it empty.

Only add data to the mostly appropriate field. Don't make up fields that aren't in the schema. If there isn't a value for a field, use null. Output should be in JSON.

Schema:
${JSON.stringify(schema, null, 2)}`;
