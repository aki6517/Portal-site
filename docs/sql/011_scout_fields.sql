-- 学生演劇収集パイプライン（Phase 5）向けの列追加。
-- AI（.claude/skills/portal-scout/SKILL.md）がWeb検索で収集した公演を
-- draftとしてSupabaseに登録するための下地。
-- ADD COLUMN IF NOT EXISTS のみで既存データへの副作用なし（何度実行してもよい）。
--
-- theaters.origin: 'self'（劇団自身が登録）/ 'scout'（AIが自動作成した未クレームの劇団）。
--   scout由来の劇団は本人がまだ関知していないため、将来的に劇団本人が
--   contact_emailを更新することでアカウントを引き継げる想定（引き継ぎ導線自体はPhase 5の
--   スコープ外・未実装）。
-- events.source_urls: スカウト時に参照した出典URL（複数可）。人間レビュー時の裏取りに使う。

DO $$
BEGIN
  IF to_regclass('public.theaters') IS NULL THEN
    RAISE EXCEPTION 'public.theaters が存在しません。先に docs/sql/001_init.sql を実行してください。';
  END IF;
  IF to_regclass('public.events') IS NULL THEN
    RAISE EXCEPTION 'public.events が存在しません。先に docs/sql/001_init.sql を実行してください。';
  END IF;
END
$$;

ALTER TABLE public.theaters
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'self' CHECK (origin IN ('self', 'scout'));

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS source_urls TEXT[] NOT NULL DEFAULT '{}';
