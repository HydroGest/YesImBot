import { readFileSync } from "fs";
import path from "path";
import { isEmpty } from "../../utils/string";

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ParameterSchema;
  };
}

export interface ParameterSchema {
  type: "object";
  properties: {
    [key: string]: {
      type: string;
      description: string;
    };
  };
  required: string[];
}

const schema = {
  status: {
    type: "enum",
    values: ["success", "skip", "function"],
    description: "Response status. `success` for sending a message, `skip` for skipping the message, `function` for waiting for the return value from a function. If the function has no return value, or the function can't run when the status is `function`, set the status to `success` or `skip`. In other words, you can also run functions if the status is `success` or `skip`.",
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
    description: "Message ID to reference. Don't fill this field if you send a private message. Don't abuse this",
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
    description: "Final response after checks. The response will be sent to the channel or user based on the `replyTo` field.",
  },
  functions: {
    type: "array",
    description: "Functions to execute. If you need to get the return value from a function, set `status` to `function`. You can also run functions when the `status` is `skip` or `success`, depending on your needs. If you use the `function` tag, only fill in the `status`, `logic` and `functions` field, don't fill in the other fields.",
  }
};

export const outputSchema = `You should generate output in JSON observing the schema provided. If the schema shows a type of integer or number, you must only show a integer for that field. A string should always be a valid string. If a value is unknown, leave it empty.
Only add data to the mostly appropriate field. Don't make up fields that aren't in the schema. If there isn't a value for a field, use null. Output should be in JSON.

Schema:
${JSON.stringify(schema, null, 2)}`;
