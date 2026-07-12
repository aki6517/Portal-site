-- venuesにエリア表示・表記ゆれ吸収用の列を追加し、福岡の実会場をシードする。
-- ADD COLUMN IF NOT EXISTS のみで既存データへの副作用なし（何度実行してもよい）。
-- venues.name にUNIQUE制約が無いため、新規行のシードはON CONFLICTではなく
-- WHERE NOT EXISTS で冪等化している（同名行を重複作成しない）。

DO $$
BEGIN
  IF to_regclass('public.venues') IS NULL THEN
    RAISE EXCEPTION 'public.venues が存在しません。先に docs/sql/001_init.sql を実行してください。';
  END IF;
END
$$;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS area TEXT,
  ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 100;

-- ---------------------------------------------------------------------------
-- 新規施設のシード（既存2行=ぽんプラザホール/西鉄ホールは下のUPDATEでarea/
-- sort_orderのみ付与する）。
-- エリア表示順序はSQLではなくコード側定数（lib/data/calendar.ts の
-- AREA_ORDER）で管理する。ここでのarea文字列はそれと完全一致させること。
-- ---------------------------------------------------------------------------

INSERT INTO public.venues (name, city, area, sort_order, aliases)
SELECT '博多座', '福岡市', '福岡市・天神博多', 10, '{}'
WHERE NOT EXISTS (SELECT 1 FROM public.venues WHERE name = '博多座');

INSERT INTO public.venues (name, city, area, sort_order, aliases)
SELECT 'キャナルシティ劇場', '福岡市', '福岡市・天神博多', 20, '{}'
WHERE NOT EXISTS (SELECT 1 FROM public.venues WHERE name = 'キャナルシティ劇場');

INSERT INTO public.venues (name, city, area, sort_order, aliases)
SELECT '福岡市民ホール', '福岡市', '福岡市・天神博多', 50, '{}'
WHERE NOT EXISTS (SELECT 1 FROM public.venues WHERE name = '福岡市民ホール');

INSERT INTO public.venues (name, city, area, sort_order, aliases)
SELECT 'ベイサイドライブホール', '福岡市', '福岡市・天神博多', 60,
       ARRAY['ベイサイドライブホール（ベイサイドプレイス博多）']
WHERE NOT EXISTS (SELECT 1 FROM public.venues WHERE name = 'ベイサイドライブホール');

INSERT INTO public.venues (name, city, area, sort_order, aliases)
SELECT '福岡市美術館', '福岡市', '福岡市その他', 70, '{}'
WHERE NOT EXISTS (SELECT 1 FROM public.venues WHERE name = '福岡市美術館');

INSERT INTO public.venues (name, city, area, sort_order, aliases)
SELECT '千早音楽・演劇練習場', '福岡市', '福岡市その他', 80, '{}'
WHERE NOT EXISTS (SELECT 1 FROM public.venues WHERE name = '千早音楽・演劇練習場');

INSERT INTO public.venues (name, city, area, sort_order, aliases)
SELECT '北九州芸術劇場', '北九州市', '北九州', 90, '{}'
WHERE NOT EXISTS (SELECT 1 FROM public.venues WHERE name = '北九州芸術劇場');

INSERT INTO public.venues (name, city, area, sort_order, aliases)
SELECT '宗像ユリックス', '宗像市', '福岡県その他', 100, '{}'
WHERE NOT EXISTS (SELECT 1 FROM public.venues WHERE name = '宗像ユリックス');

-- ---------------------------------------------------------------------------
-- 既存2行のarea/sort_order付与
-- ---------------------------------------------------------------------------

UPDATE public.venues SET area = '福岡市・天神博多', sort_order = 30 WHERE name = '西鉄ホール';
UPDATE public.venues SET area = '福岡市・天神博多', sort_order = 40 WHERE name = 'ぽんプラザホール';

-- ---------------------------------------------------------------------------
-- 既存eventsのvenue_idバックフィル（venue_id未設定の行のみ・venue前方一致）。
-- events.venue の表記（例:「福岡市民ホール 大ホール」「北九州芸術劇場 中劇場」）
-- は「施設名 + 空白 + ホール名」の形式のため、前方一致で施設単位にまとめて
-- 割り当てる（同じ施設の複数ホール表記が同じvenue_idに揃う）。
-- 対象は実データで確認済みの9施設・11表記ゆれ文字列（venuesテーブル既存の
-- 西鉄ホールは現時点でどのeventsからも参照されていないため対象外）。
-- ---------------------------------------------------------------------------

UPDATE public.events e
SET venue_id = v.id
FROM public.venues v
WHERE e.venue_id IS NULL AND v.name = '博多座' AND e.venue LIKE '博多座%';

UPDATE public.events e
SET venue_id = v.id
FROM public.venues v
WHERE e.venue_id IS NULL AND v.name = 'キャナルシティ劇場' AND e.venue LIKE 'キャナルシティ劇場%';

UPDATE public.events e
SET venue_id = v.id
FROM public.venues v
WHERE e.venue_id IS NULL AND v.name = '福岡市民ホール' AND e.venue LIKE '福岡市民ホール%';

UPDATE public.events e
SET venue_id = v.id
FROM public.venues v
WHERE e.venue_id IS NULL AND v.name = 'ぽんプラザホール' AND e.venue LIKE 'ぽんプラザホール%';

UPDATE public.events e
SET venue_id = v.id
FROM public.venues v
WHERE e.venue_id IS NULL AND v.name = '福岡市美術館' AND e.venue LIKE '福岡市美術館%';

UPDATE public.events e
SET venue_id = v.id
FROM public.venues v
WHERE e.venue_id IS NULL AND v.name = '北九州芸術劇場' AND e.venue LIKE '北九州芸術劇場%';

UPDATE public.events e
SET venue_id = v.id
FROM public.venues v
WHERE e.venue_id IS NULL AND v.name = '宗像ユリックス' AND e.venue LIKE '宗像ユリックス%';

UPDATE public.events e
SET venue_id = v.id
FROM public.venues v
WHERE e.venue_id IS NULL AND v.name = '千早音楽・演劇練習場' AND e.venue LIKE '千早音楽・演劇練習場%';

UPDATE public.events e
SET venue_id = v.id
FROM public.venues v
WHERE e.venue_id IS NULL AND v.name = 'ベイサイドライブホール' AND e.venue LIKE 'ベイサイドライブホール%';
