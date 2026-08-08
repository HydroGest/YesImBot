export interface OneBotSenderInfo {
  readonly user_id: number | string;
  readonly nickname?: string;
  readonly card?: string;
}

export interface OneBotCQCode {
  readonly type: string;
  readonly data: Record<string, unknown>;
}

export interface OneBotForwardSendNode {
  readonly type: "node";
  readonly data: { readonly name: string; readonly uin: string; readonly content: readonly OneBotCQCode[]; readonly time: string };
}

export interface OneBotInternal {
  getForwardMsg(forwardId: string): Promise<unknown>;
  getImage(file: string): Promise<{ readonly url?: string } | undefined>;
  sendGroupForwardMsg(groupId: string | number, messages: readonly OneBotForwardSendNode[]): Promise<number | string>;
  sendPrivateForwardMsg(userId: string | number, messages: readonly OneBotForwardSendNode[]): Promise<number | string>;
  setEssenceMsg(messageId: string): Promise<unknown>;
  _request?(action: string, params: object): Promise<unknown>;
}
