-- The Bot catalogue is global and is routed exclusively to shard 0 by the
-- Queue consumer. D1 is reconstructible: it stores only allow-listed fields,
-- never the signed content or arbitrary Bot configuration.
CREATE TABLE bot_projection (
  bot_id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('published', 'suspended', 'withdrawn')
  ),
  config_contract_id TEXT NOT NULL CHECK (
    config_contract_id = 'punks://contracts/bot.config.empty@1'
  ),
  supported_action_contracts_json TEXT NOT NULL CHECK (
    json_valid(supported_action_contracts_json)
    AND json_type(supported_action_contracts_json) = 'array'
  ),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  last_cursor INTEGER NOT NULL CHECK (last_cursor >= 1),
  last_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  suspended_at TEXT,
  withdrawn_at TEXT,
  CHECK (
    (status = 'published' AND suspended_at IS NULL AND withdrawn_at IS NULL)
    OR (status = 'suspended' AND suspended_at IS NOT NULL AND withdrawn_at IS NULL)
    OR (status = 'withdrawn' AND suspended_at IS NULL AND withdrawn_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX bot_projection_catalogue
  ON bot_projection (status, updated_at DESC, bot_id);

CREATE VIRTUAL TABLE bot_search USING fts5(
  bot_id UNINDEXED,
  slug,
  name,
  description,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER bot_projection_search_insert
AFTER INSERT ON bot_projection
BEGIN
  INSERT INTO bot_search (bot_id, slug, name, description)
  VALUES (new.bot_id, new.slug, new.name, new.description);
END;

CREATE TRIGGER bot_projection_search_update
AFTER UPDATE OF slug, name, description ON bot_projection
BEGIN
  DELETE FROM bot_search WHERE bot_id = old.bot_id;
  INSERT INTO bot_search (bot_id, slug, name, description)
  VALUES (new.bot_id, new.slug, new.name, new.description);
END;

CREATE TRIGGER bot_projection_search_delete
AFTER DELETE ON bot_projection
BEGIN
  DELETE FROM bot_search WHERE bot_id = old.bot_id;
END;

CREATE TABLE bot_event_projection (
  bot_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  cursor INTEGER NOT NULL CHECK (cursor >= 1),
  kind INTEGER NOT NULL CHECK (kind IN (50300, 50301)),
  projected_at TEXT NOT NULL,
  PRIMARY KEY (bot_id, event_id),
  UNIQUE (bot_id, cursor)
) STRICT;

CREATE INDEX bot_event_projection_cursor
  ON bot_event_projection (bot_id, cursor);

-- Installation state and its normalized grants live on the Workspace shard.
-- Only the release-owned config contract and digest cross this boundary.
CREATE TABLE bot_installation_projection (
  workspace_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  config_contract_id TEXT NOT NULL CHECK (
    config_contract_id = 'punks://contracts/bot.config.empty@1'
  ),
  config_digest TEXT NOT NULL CHECK (
    length(config_digest) = 64 AND config_digest NOT GLOB '*[^0-9a-f]*'
  ),
  grant_count INTEGER NOT NULL CHECK (grant_count >= 0),
  open_admission_count INTEGER NOT NULL CHECK (open_admission_count >= 0),
  authority_generation INTEGER NOT NULL CHECK (authority_generation >= 1),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  last_cursor INTEGER NOT NULL CHECK (last_cursor >= 1),
  last_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (workspace_id, installation_id),
  UNIQUE (workspace_id, bot_id),
  CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX bot_installation_projection_workspace_status
  ON bot_installation_projection (
    workspace_id,
    status,
    updated_at DESC,
    installation_id
  );

CREATE TABLE bot_installation_grant_projection (
  workspace_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  capability TEXT NOT NULL CHECK (capability = 'messages.react'),
  resource_kind TEXT NOT NULL CHECK (resource_kind = 'conversation'),
  conversation_id TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  authority_generation INTEGER NOT NULL CHECK (authority_generation >= 1),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  last_cursor INTEGER NOT NULL CHECK (last_cursor >= 1),
  last_event_id TEXT NOT NULL,
  PRIMARY KEY (
    workspace_id,
    installation_id,
    capability,
    resource_kind,
    conversation_id
  )
) STRICT;

CREATE INDEX bot_installation_grant_enabled
  ON bot_installation_grant_projection (
    workspace_id,
    installation_id,
    enabled,
    conversation_id
  );

CREATE TABLE bot_installation_event_projection (
  workspace_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  cursor INTEGER NOT NULL CHECK (cursor >= 1),
  kind INTEGER NOT NULL CHECK (
    kind IN (50310, 50311, 50312, 50320, 50321)
  ),
  projected_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, installation_id, event_id),
  UNIQUE (workspace_id, installation_id, cursor)
) STRICT;

CREATE INDEX bot_installation_event_projection_cursor
  ON bot_installation_event_projection (
    workspace_id,
    installation_id,
    cursor
  );

-- This is a compact receipt/tombstone projection, not an action journal. The
-- action payload and every credential remain outside D1.
CREATE TABLE bot_action_admission_projection (
  workspace_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  admission_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  action_digest TEXT NOT NULL CHECK (
    length(action_digest) = 64 AND action_digest NOT GLOB '*[^0-9a-f]*'
  ),
  bot_id TEXT NOT NULL,
  action_contract TEXT NOT NULL CHECK (
    action_contract IN (
      'message.reaction-add@1',
      'message.reaction-remove@1',
      'message.reaction-toggle@1'
    )
  ),
  capability TEXT NOT NULL CHECK (capability = 'messages.react'),
  risk TEXT NOT NULL CHECK (risk IN ('routine', 'consequential', 'critical')),
  resource_kind TEXT NOT NULL CHECK (resource_kind = 'message'),
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('admitted', 'completed')),
  outcome TEXT CHECK (outcome IN ('succeeded', 'failed')),
  installation_cursor INTEGER NOT NULL CHECK (installation_cursor >= 1),
  authority_generation INTEGER NOT NULL CHECK (authority_generation >= 1),
  admitted_cursor INTEGER NOT NULL CHECK (admitted_cursor >= 1),
  completed_cursor INTEGER CHECK (completed_cursor >= admitted_cursor),
  admitted_at TEXT NOT NULL,
  completed_at TEXT,
  last_cursor INTEGER NOT NULL CHECK (last_cursor >= admitted_cursor),
  last_event_id TEXT NOT NULL,
  PRIMARY KEY (workspace_id, installation_id, admission_id),
  UNIQUE (workspace_id, installation_id, action_id),
  CHECK (
    (status = 'admitted' AND outcome IS NULL
      AND completed_cursor IS NULL AND completed_at IS NULL)
    OR (status = 'completed' AND outcome IS NOT NULL
      AND completed_cursor IS NOT NULL AND completed_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX bot_action_admission_projection_status
  ON bot_action_admission_projection (
    workspace_id,
    installation_id,
    status,
    admitted_cursor,
    admission_id
  );
