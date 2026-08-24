-- 0005 is already deployed. Keep authoritative Message snapshot progress
-- separate from later derived Fil de discussion deltas so out-of-order state
-- envelopes can still fill metadata without regressing the derived cursor.
ALTER TABLE message_projection
ADD COLUMN state_cursor INTEGER NOT NULL DEFAULT 1
CHECK (state_cursor >= 1);

ALTER TABLE message_projection
ADD COLUMN state_event_id TEXT NOT NULL DEFAULT '';

UPDATE message_projection
SET state_cursor = last_cursor,
    state_event_id = last_event_id;

-- Existing rows predate bounded metadata on thread deltas. NULL therefore
-- means “counter-only legacy delta”; every new schema-validated delta supplies
-- all three values.
ALTER TABLE message_thread_delta_projection
ADD COLUMN target_last_reply_at TEXT;

ALTER TABLE message_thread_delta_projection
ADD COLUMN target_revision INTEGER
CHECK (target_revision IS NULL OR target_revision >= 1);

ALTER TABLE message_thread_delta_projection
ADD COLUMN target_updated_at TEXT;
