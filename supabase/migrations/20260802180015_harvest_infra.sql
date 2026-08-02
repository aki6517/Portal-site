-- 公演情報自動収集（harvest）の基盤:
--  1. harvest_items: 収集台帳。source×source_keyで冪等化し、再実行しても重複登録しない
--  2. venues: 甘棠館Show劇場の追加と、収集ソースの表記ゆれを吸収するaliases補強
-- 設計: docs/harvest/DESIGN.md

create table if not exists public.harvest_items (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_key text not null,
  event_id uuid references public.events(id) on delete set null,
  action text not null check (action in ('published', 'draft', 'skipped_duplicate', 'skipped_invalid', 'error')),
  payload jsonb,
  created_at timestamptz not null default now(),
  unique (source, source_key)
);

comment on table public.harvest_items is
  '外部ソースからの公演自動収集の台帳。service roleのみが読み書きする（RLS有効・ポリシーなし）';

alter table public.harvest_items enable row level security;

-- ---------------------------------------------------------------------------
-- venues: 甘棠館Show劇場を追加（中央区唐人町。劇団ショーマンシップ拠点・約84席）
-- area文字列は lib/data/calendar.ts の AREA_ORDER と完全一致させること
-- ---------------------------------------------------------------------------

insert into public.venues (name, city, area, sort_order, aliases, address, capacity, url)
select '甘棠館Show劇場', '福岡市', '福岡市その他', 75,
       array['甘棠館show劇場', '甘棠館ショー劇場', '甘棠館'],
       '福岡市中央区唐人町1-15-28', 84, 'https://plaza-kantoukan.jp/'
where not exists (select 1 from public.venues where name = '甘棠館Show劇場');

-- ---------------------------------------------------------------------------
-- aliases補強: FPAP/公式ソースの表記（ホール名を空白なしで連結する等）を吸収する。
-- normalize.tsのホール語分離は「空白区切りの末尾トークン」のみ対象のため、
-- 連結表記はaliasで受ける必要がある。
-- ---------------------------------------------------------------------------

update public.venues set aliases = (
  select array(select distinct unnest(aliases || array[
    '福岡市民ホール小ホール', '福岡市民ホール大ホール', '福岡市民ホール中ホール'
  ]))
) where name = '福岡市民ホール';

update public.venues set aliases = (
  select array(select distinct unnest(aliases || array[
    'J:COM北九州芸術劇場', 'JCOM北九州芸術劇場',
    'J:COM北九州芸術劇場 大劇場', 'J:COM北九州芸術劇場 中劇場', 'J:COM北九州芸術劇場 小劇場',
    '北九州芸術劇場大劇場', '北九州芸術劇場中劇場', '北九州芸術劇場小劇場'
  ]))
) where name = '北九州芸術劇場';
