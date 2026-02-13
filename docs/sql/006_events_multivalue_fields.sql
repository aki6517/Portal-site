-- Multi-value event fields for category/date/reservation management.

DO $$
BEGIN
  IF to_regclass('public.events') IS NULL THEN
    RAISE EXCEPTION 'public.events が存在しません。先に docs/sql/001_init.sql を実行してください。';
  END IF;
END
$$;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS categories TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS schedule_times JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ticket_types JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reservation_links JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_events_categories_gin ON public.events USING GIN (categories);
