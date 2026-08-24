-- v1 tokens were scoped only to a Workspace. They cannot coexist with the
-- Conversation-scoped v2 corpus without reintroducing a cross-Conversation
-- posting-list side channel. Search is a reconstructible projection, so the
-- safe migration drops the opaque v1 corpus and rebuilds it empty.
DROP TRIGGER IF EXISTS message_search_document_insert;
DROP TRIGGER IF EXISTS message_search_document_update;
DROP TRIGGER IF EXISTS message_search_document_delete;
DROP TABLE IF EXISTS message_search;
DROP TABLE IF EXISTS message_search_document;

CREATE TABLE message_search_document (
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  token_algorithm TEXT NOT NULL
    CHECK (token_algorithm = 'hmac-sha256-conversation-v2'),
  opaque_tokens TEXT NOT NULL CHECK (length(opaque_tokens) > 0),
  last_cursor INTEGER NOT NULL CHECK (last_cursor >= 1),
  last_event_id TEXT NOT NULL,
  PRIMARY KEY (workspace_id, conversation_id, message_id),
  FOREIGN KEY (workspace_id, conversation_id, message_id)
    REFERENCES message_projection(workspace_id, conversation_id, message_id)
    ON DELETE CASCADE
) STRICT;

CREATE VIRTUAL TABLE message_search USING fts5(
  workspace_id UNINDEXED,
  conversation_id UNINDEXED,
  message_id UNINDEXED,
  token_algorithm UNINDEXED,
  opaque_tokens,
  tokenize = 'trigram case_sensitive 1'
);

CREATE TRIGGER message_search_document_insert
AFTER INSERT ON message_search_document
BEGIN
  INSERT INTO message_search (
    workspace_id,
    conversation_id,
    message_id,
    token_algorithm,
    opaque_tokens
  ) VALUES (
    new.workspace_id,
    new.conversation_id,
    new.message_id,
    new.token_algorithm,
    new.opaque_tokens
  );
END;

CREATE TRIGGER message_search_document_update
AFTER UPDATE OF token_algorithm, opaque_tokens ON message_search_document
BEGIN
  DELETE FROM message_search
  WHERE workspace_id = old.workspace_id
    AND conversation_id = old.conversation_id
    AND message_id = old.message_id;
  INSERT INTO message_search (
    workspace_id,
    conversation_id,
    message_id,
    token_algorithm,
    opaque_tokens
  ) VALUES (
    new.workspace_id,
    new.conversation_id,
    new.message_id,
    new.token_algorithm,
    new.opaque_tokens
  );
END;

CREATE TRIGGER message_search_document_delete
AFTER DELETE ON message_search_document
BEGIN
  DELETE FROM message_search
  WHERE workspace_id = old.workspace_id
    AND conversation_id = old.conversation_id
    AND message_id = old.message_id;
END;
