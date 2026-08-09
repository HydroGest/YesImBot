export type TrustMode = "locked" | "full";
export type UserActorMode = "disabled" | "any";
export type InteractiveMode = "reject" | "ask";
export type CommandActor =
  | { kind: "agent" }
  | { kind: "user"; userId: string };

export interface CommandBridgeConfig {
  trustMode: TrustMode;
  allowCommands: string[];
  hardDeny: string[];
  agentAuthority: number;
  agentPermissions: string[];
  userActor: UserActorMode;
  crossChannel: boolean;
  timeoutMs: number;
  maxTranscriptChars: number;
}

export interface ExecuteCommandInput {
  command: string;
  actor?: CommandActor;
  interactive?: InteractiveMode;
  channelId?: string;
  guildId?: string;
}

export interface AnswerPromptInput {
  executionId: string;
  answer: string;
}

export interface AbortCommandInput {
  executionId: string;
}

export interface ListCommandsInput {
  filter?: string;
}

export interface CommandExecutionEvent {
  status: "done" | "awaiting_prompt";
  executionId: string;
  transcript: string;
  prompt?: string;
  returnValue?: string;
  error?: string;
}
