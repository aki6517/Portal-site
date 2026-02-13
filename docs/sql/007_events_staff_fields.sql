-- Event staff fields for playwright / director.

DO $$
BEGIN
  IF to_regclass('public.events') IS NULL THEN
    RAISE EXCEPTION 'public.events が存在しません。先に docs/sql/001_init.sql を実行してください。';
  END IF;
END
$$;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS playwright TEXT,
  ADD COLUMN IF NOT EXISTS director TEXT;
