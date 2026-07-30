import type { OneBot } from "koishi-plugin-adapter-onebot";

export type ForwardPart =
  | string
  | { image: readonly [summary: string, file: string, size: string | null] }
  | { forward: string };

export type ForwardMessage = readonly [
  sender: string,
  time: string | null,
  content: readonly ForwardPart[],
];

export interface ForwardPage {
  messages: readonly ForwardMessage[];
  nextOffset?: number;
  tips?: string;
  overLimit?: true;
}

export interface ForwardFailure {
  error: string;
}

export type ForwardResult = ForwardPage | ForwardFailure;

export interface ForwardReaderConfig {
  parseImages: boolean;
  maxForwardPageChars: number;
}

export interface ForwardToolInput {
  forwardId: string;
  offset?: number;
  limit?: number;
}

export interface OneBotForwardNode {
  sender: OneBot.SenderInfo;
  time: OneBot.Message["time"];
  message: readonly OneBotForwardSegment[];
  raw_message?: OneBot.Payload["raw_message"];
}

export interface OneBotTextSegment {
  type: "text";
  data: {
    text: string;
  };
}

export interface OneBotImageSegment {
  type: "image";
  data: {
    summary: string;
    file: string;
    file_size?: string;
  };
}

export interface OneBotNestedForwardSegment {
  type: "forward";
  data: {
    id: string;
    content?: readonly OneBotForwardNode[];
  };
}

export interface OneBotRecordSegment {
  type: "record";
  data: object;
}

export interface OneBotVideoSegment {
  type: "video";
  data: object;
}

export interface OneBotFileSegment {
  type: "file";
  data: object;
}

export type OneBotForwardSegment =
  | OneBotTextSegment
  | OneBotImageSegment
  | OneBotNestedForwardSegment
  | OneBotRecordSegment
  | OneBotVideoSegment
  | OneBotFileSegment;
