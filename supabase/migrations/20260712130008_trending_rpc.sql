-- Trending events RPC: event_views_daily の直近N日集計をSQL側で行い、
-- 全行をJSに転送してから集計する現行ロジックを置き換える。
-- ファイル作成のみ（Phase 1ではDB適用しない）。適用はSupabase SQL Editorで
-- このファイルをそのまま実行するだけ（既存オブジェクトへの副作用なし）。
--
-- 注意（プランからの差分）: event_views_daily はRLSで service_role のみ
-- SELECT可能（docs/sql/001_init.sql「Service role can manage daily views」）。
-- このRPCを SECURITY INVOKER（デフォルト）のまま anon/authenticated から
-- 呼ぶと、RLSにより内部のSELECTが常に0行になり結果が空になる。
-- そのため SECURITY DEFINER + search_path固定を付与している。
-- 現状のコード（lib/data/events.ts）はこのRPCを service クライアントで
-- 呼んでおり、その運用のままなら SECURITY DEFINER は無くても動作するが、
-- 将来 anon から直接呼ぶ可能性に備えて安全側に倒した。

DO $$
BEGIN
  IF to_regclass('public.event_views_daily') IS NULL THEN
    RAISE EXCEPTION 'public.event_views_daily が存在しません。先に docs/sql/001_init.sql を実行してください。';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.trending_events(days int DEFAULT 30, max_rows int DEFAULT 20)
RETURNS TABLE(event_id uuid, total_views bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.event_id, SUM(v.views)::bigint
  FROM event_views_daily v
  JOIN events e ON e.id = v.event_id AND e.status = 'published'
  WHERE v.view_date >= (CURRENT_DATE - days)
  GROUP BY v.event_id
  ORDER BY 2 DESC
  LIMIT max_rows;
$$;
