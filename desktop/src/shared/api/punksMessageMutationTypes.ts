export type MessageReplyTarget = {
  messageId: string;
  threadRootMessageId: string;
  threadDepth: number;
};

export type PostTextInput = {
  conversationId: string;
  content: string;
  topic?: string | null;
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
