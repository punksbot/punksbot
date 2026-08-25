/** Authorized parent coordinates captured before one explicit reply intent. */
export type MessageReplyTarget = {
  /** Exact Message that will become the new reply's parent. */
  messageId: string;
  /** Authoritative root of the parent's Fil de discussion. */
  threadRootMessageId: string;
  /** Authoritative depth of the parent Message. */
  threadDepth: number;
};

export type PostTextInput = {
  conversationId: string;
  content: string;
  topic?: string | null;
  /** Closed ancestry evidence used to validate the reply acknowledgement. */
  replyTarget?: MessageReplyTarget;
};

export type EditMessageInput = {
  conversationId: string;
  messageId: string;
  content: string;
  topic?: string | null;
};

export type RetractMessageInput = {
  conversationId: string;
  messageId: string;
  reasonCode?: string | null;
  publicReason?: string | null;
};

export type RestoreMessageInput = {
  conversationId: string;
  messageId: string;
};

export type ReactionInput = {
  conversationId: string;
  messageId: string;
  reaction: string;
};
