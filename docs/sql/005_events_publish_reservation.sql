-- Add publish/reservation control fields to events.
-- Safe for re-run in existing environments.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS publish_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reservation_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reservation_label TEXT;

CREATE INDEX IF NOT EXISTS idx_events_publish_at ON events(publish_at);
CREATE INDEX IF NOT EXISTS idx_events_reservation_start_at ON events(reservation_start_at);
