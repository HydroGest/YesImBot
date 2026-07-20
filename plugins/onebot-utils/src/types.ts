export interface OneBotInternal {
  getForwardMsg(messageId: string): Promise<unknown>;
  setEssenceMsg(messageId: string): Promise<unknown>;
  _request?(action: string, params: Record<string, unknown>): Promise<unknown>;
}

export interface OneBotCapableBot {
  internal?: OneBotInternal;
}
