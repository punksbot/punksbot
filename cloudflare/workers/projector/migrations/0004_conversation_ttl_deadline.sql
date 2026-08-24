ALTER TABLE conversation_projection ADD COLUMN ttl_deadline TEXT;

CREATE INDEX IF NOT EXISTS conversation_projection_ttl_deadline
  ON conversation_projection (status, ttl_deadline)
  WHERE status = 'active' AND ttl_deadline IS NOT NULL;
