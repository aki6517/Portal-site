-- 再演時に「後継公演」を手動指定するためのsuperseded_by列を追加する。
-- superseded_byが設定された公演は、詳細ページのcanonicalが後継公演のURLへ切り替わり、
-- 「この公演の最新情報はこちら」バナーが表示される（app/events/[category]/[slug]/page.tsx）。
-- ADD COLUMN IF NOT EXISTS のみで既存データへの副作用なし（何度実行してもよい）。

DO $$
BEGIN
  IF to_regclass('public.events') IS NULL THEN
    RAISE EXCEPTION 'public.events が存在しません。先に docs/sql/001_init.sql を実行してください。';
  END IF;
END
$$;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES public.events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_superseded_by ON public.events(superseded_by);
