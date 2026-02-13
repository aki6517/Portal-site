-- Multi-value event fields for category/date/reservation management.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS categories TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS schedule_times JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ticket_types JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reservation_links JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_events_categories_gin ON events USING GIN (categories);
