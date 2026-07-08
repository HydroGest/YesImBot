export interface ForwardMessage {
  self_id: number;
  user_id: number;
  time: number;
  message_id: number;
  message_seq: number;
  real_id: number;
  real_seq: string;
  message_type: string;
  sender: Sender;
  raw_message: string;
  font: number;
  sub_type: string;
  message: Message[];
  message_format: string;
  post_type: string;
  group_id: number;
  group_name: string;
}

export interface OneBotInternal {
  getForwardMsg(messageId: string): Promise<ForwardMessage[] | unknown>;
  setEssenceMsg(messageId: string): Promise<unknown>;
  _request?(action: string, params: Record<string, unknown>): Promise<unknown>;
}

export interface OneBotCapableBot {
  internal?: OneBotInternal;
}

interface Message {
  type: string;
  data: Data;
}

interface Data {
  summary: string;
  file: string;
  sub_type: number;
  url: string;
  file_size: string;
}

interface Sender {
  user_id: number;
  nickname: string;
  card: string;
}
